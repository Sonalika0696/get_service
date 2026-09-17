import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RazorpayService } from '../../infra/razorpay/razorpay.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { IdempotencyService } from '../ledger/idempotency.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { AccountKind, CommitmentStatus, MaintenanceChargeStatus, RatificationStatus, PaymentStatus } from '../../generated/prisma/enums.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PaymentModel } from '../../generated/prisma/models.js';
import type { CreateOrderDto } from './dto/create-order.dto.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

/**
 * Phase 9.2 — captured inside applyCapture's transaction (when the branch
 * fires) and pushed AFTER handleWebhook's transaction commits, exactly like
 * ServiceRequestsService's PendingServiceRequestNotification pattern: the
 * DB write and the best-effort push are never in the same unit of work.
 */
interface PendingBillPaidPush {
  residentId: string;
  chargeId: string;
  amount: string;
  status: MaintenanceChargeStatus;
}

export interface CreateOrderResult {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
}

export interface CreateOrderForLinkInput {
  societyId: string;
  residentId: string;
  /** Major units (rupees) — see rupeesToPaise's doc comment for the conversion boundary. */
  amount: number | Prisma.Decimal;
  purpose?: string;
  /** e.g. 'Commitment' — a loose pointer, same pattern as LedgerEntry.linkedEntityType. */
  linkedEntityType: string;
  linkedEntityId: string;
  idempotencyKey: string;
}

export interface RefundInitiatedResult {
  refundId: string;
  status: string;
  note: string;
}

/**
 * Work to run AFTER the webhook transaction has committed — a realtime push,
 * a notification. Always best-effort: PaymentsService catches and logs any
 * error, so a failure can never make an already-committed capture look failed.
 */
export type PaymentPostCommitAction = () => Promise<void>;

/**
 * How a domain module takes part in payment capture/refund without editing
 * PaymentsService. A Payment whose `linkedEntityType` matches a registered
 * handler credits (on capture) or debits (on refund) `pocketKind` instead of
 * the default BULK_BUY escrow, and the matching hook runs INSIDE the webhook
 * transaction, after the ledger posting, so the domain row advances
 * atomically with the money. A hook may return a post-commit action.
 *
 * Register from the owning module's `onModuleInit`, e.g.
 *   payments.registerLinkHandler('EventRegistration', {
 *     pocketKind: AccountKind.EVENTS,
 *     onCaptured: (tx, id, rupees) => this.markPaid(tx, id, rupees),
 *   });
 *
 * Hooks MUST be idempotent-safe: guard every update with a status/where
 * clause (see advanceMaintenanceCharge). The payment-level CAPTURED/REFUNDED
 * guard already stops a duplicate event from reaching the hook in practice.
 */
export interface PaymentLinkHandler {
  /**
   * The pocket this entity type's money lands in. Either a constant, or a
   * resolver evaluated inside the webhook tx for entity-dependent routing
   * (e.g. a utility FlatBill → ELECTRICITY or WATER by its cycle's utility).
   */
  pocketKind: AccountKind | ((tx: Prisma.TransactionClient, linkedEntityId: string, payment: PaymentModel) => Promise<AccountKind>);
  onCaptured?: (tx: Prisma.TransactionClient, linkedEntityId: string, amountRupees: number, payment: PaymentModel) => Promise<PaymentPostCommitAction | void>;
  onRefunded?: (tx: Prisma.TransactionClient, linkedEntityId: string, amountRupees: number, payment: PaymentModel) => Promise<PaymentPostCommitAction | void>;
}

/** Amount conversion helper — our schema stores rupees; Razorpay speaks paise. Kept in one place so the x100/÷100 boundary is never duplicated/inconsistent. */
function rupeesToPaise(rupees: number | Prisma.Decimal): number {
  const value = typeof rupees === 'number' ? rupees : Number(rupees.toString());
  return Math.round(value * 100);
}

/**
 * Phase 4B payments orchestration on top of the Phase 4A ledger:
 *  - createOrder: resident-initiated, idempotent, no money has moved yet
 *    (no ledger entry) — just a Razorpay order + a CREATED Payment row.
 *  - handleWebhook: the SOLE ledger-writer. Razorpay's signed server-to-
 *    server callback is what actually moves money in/out of escrow;
 *    everything here runs inside IdempotencyService.runOnce keyed on the
 *    Razorpay event id, so a redelivered webhook posts nothing twice.
 *  - refund: a treasurer-initiated request to Razorpay's Refunds API. Does
 *    NOT touch the ledger itself — the reversal is posted when the
 *    corresponding `refund.processed` webhook arrives, keeping the webhook
 *    the single source of truth for every money movement.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly linkHandlers = new Map<string, PaymentLinkHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly realtime: RealtimeService,
  ) {
    // Phase 9.2's maintenance routing, now expressed through the same
    // registry every later module uses. Behaviour is unchanged: credits
    // MAINTENANCE, advances/reverts the charge in-tx, pushes bill.paid post-commit.
    this.registerLinkHandler('MaintenanceCharge', {
      pocketKind: AccountKind.MAINTENANCE,
      onCaptured: async (tx, chargeId, amountRupees) => {
        const pending = await this.advanceMaintenanceCharge(tx, chargeId, amountRupees);
        return pending ? () => this.pushBillPaid(pending) : undefined;
      },
      onRefunded: (tx, chargeId, amountRupees) => this.revertMaintenanceCharge(tx, chargeId, amountRupees),
    });
  }

  /**
   * Registers how Payments linked to `linkedEntityType` are routed — see
   * PaymentLinkHandler. Throws on a duplicate registration: two modules
   * silently fighting over one entity type would misroute money.
   */
  registerLinkHandler(linkedEntityType: string, handler: PaymentLinkHandler): void {
    if (this.linkHandlers.has(linkedEntityType)) {
      throw new Error(`A payment link handler for "${linkedEntityType}" is already registered`);
    }
    this.linkHandlers.set(linkedEntityType, handler);
  }

  /** The registered handler for this payment, if its linkedEntityType has one and the link is complete. */
  private handlerFor(payment: PaymentModel): PaymentLinkHandler | null {
    if (!payment.linkedEntityType || !payment.linkedEntityId) return null;
    return this.linkHandlers.get(payment.linkedEntityType) ?? null;
  }

  /** The pocket a payment posts against: its handler's (constant or resolved in-tx), else the default BULK_BUY escrow. */
  private async pocketFor(tx: Prisma.TransactionClient, handler: PaymentLinkHandler | null, payment: PaymentModel): Promise<AccountKind> {
    if (!handler) return AccountKind.BULK_BUY;
    return typeof handler.pocketKind === 'function' ? handler.pocketKind(tx, payment.linkedEntityId as string, payment) : handler.pocketKind;
  }

  async createOrder(societyId: string, residentId: string, idempotencyKey: string, dto: CreateOrderDto): Promise<CreateOrderResult> {
    const { body } = await this.idempotency.runOnce<CreateOrderResult>('payments:create-order', idempotencyKey, societyId, async (tx) => {
      const receipt = `${societyId}:${idempotencyKey}`;
      const order = await this.razorpay.createOrder({
        amount: rupeesToPaise(dto.amount),
        currency: 'INR',
        receipt,
        notes: dto.purpose ? { purpose: dto.purpose } : undefined,
      });

      await tx.payment.create({
        data: {
          societyId,
          residentId,
          orderId: order.id,
          amount: dto.amount,
          currency: order.currency,
          status: PaymentStatus.CREATED,
          purpose: dto.purpose,
        },
      });

      return {
        status: 201,
        body: { orderId: order.id, amount: dto.amount, currency: order.currency, keyId: this.razorpay.keyId },
      };
    });
    return body;
  }

  /**
   * Phase 4C's entry point into escrow-in: creates the same
   * Razorpay-order-then-CREATED-Payment pair as createOrder, but
   * (a) is keyed by a caller-supplied linkedEntityType/linkedEntityId
   * (a Commitment, in bulk-buy's case) rather than being resident-initiated
   * over HTTP, and (b) optionally joins the caller's own transaction — see
   * IdempotencyService.runOnce's tx-optional contract — so BulkBuyService
   * can create a Booking + JobCards + one escrow order per Commitment
   * atomically when an Offer auto-fires. Still posts nothing to the ledger:
   * that only happens when the resulting order's payment.captured webhook
   * arrives (applyCapture below), exactly like createOrder's own contract.
   */
  async createOrderForLink(input: CreateOrderForLinkInput, tx?: Prisma.TransactionClient): Promise<PaymentModel> {
    const { body } = await this.idempotency.runOnce<PaymentModel>(
      'payments:create-order-for-link',
      input.idempotencyKey,
      input.societyId,
      async (innerTx) => {
        const receipt = `${input.societyId}:${input.idempotencyKey}`;
        const order = await this.razorpay.createOrder({
          amount: rupeesToPaise(input.amount),
          currency: 'INR',
          receipt,
          notes: input.purpose ? { purpose: input.purpose } : undefined,
        });

        const payment = await innerTx.payment.create({
          data: {
            societyId: input.societyId,
            residentId: input.residentId,
            orderId: order.id,
            amount: input.amount,
            currency: order.currency,
            status: PaymentStatus.CREATED,
            purpose: input.purpose,
            linkedEntityType: input.linkedEntityType,
            linkedEntityId: input.linkedEntityId,
          },
        });

        return { status: 201, body: payment };
      },
      tx,
    );
    return body;
  }

  async get(societyId: string, id: string): Promise<PaymentModel> {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment || payment.societyId !== societyId) {
      throw new NotFoundException('Payment not found');
    }
    return payment;
  }

  /**
   * Treasurer-initiated refund request. Only a CAPTURED payment can be
   * refunded. Calls the Razorpay Refunds API (real or stub, per
   * RAZORPAY_ENABLED) but deliberately posts nothing to the ledger — see
   * class doc comment.
   */
  async refund(societyId: string, id: string, amountRupees?: number | Prisma.Decimal): Promise<RefundInitiatedResult> {
    const payment = await this.get(societyId, id);
    if (payment.status !== PaymentStatus.CAPTURED || !payment.paymentId) {
      throw new BadRequestException(`Payment ${id} is not in a refundable state (status=${payment.status})`);
    }

    // Optional partial amount, for fixed-at-creation refund policies (e.g. an
    // event's 50% withdrawal refund). Still ONE refund per Payment in v1: the
    // refund.processed webhook reverses exactly the refunded amount, and the
    // payment then becomes REFUNDED, so a second refund is rejected above.
    let refundAmount: number | Prisma.Decimal = payment.amount;
    if (amountRupees !== undefined) {
      const requested = new Decimal(amountRupees.toString());
      if (requested.lessThanOrEqualTo(0) || requested.greaterThan(payment.amount)) {
        throw new BadRequestException(`Refund amount must be greater than 0 and at most the captured amount (${payment.amount.toString()})`);
      }
      refundAmount = requested;
    }

    const refund = await this.razorpay.refund({ paymentId: payment.paymentId, amount: rupeesToPaise(refundAmount) });

    return {
      refundId: refund.id,
      status: 'refund_initiated',
      note: 'Ledger reversal and Payment.status=REFUNDED are posted when the refund.processed webhook is received, not by this call.',
    };
  }

  /**
   * The sole ledger-writer for payments. `rawEvent` is the already-verified
   * (signature-checked by the caller) Razorpay webhook payload. Wrapped in
   * IdempotencyService.runOnce keyed on the event's own id, so a
   * redelivered webhook is a no-op: it returns the stored { received: true }
   * without touching WebhookEvent, Payment, or LedgerEntry a second time.
   */
  async handleWebhook(rawEvent: RazorpayWebhookEvent): Promise<{ received: boolean }> {
    const eventId = rawEvent.id;
    if (!eventId || typeof eventId !== 'string') {
      throw new BadRequestException('Webhook payload missing event id');
    }

    // Filled inside the tx below by a link handler's hook — see
    // PaymentPostCommitAction. Stays empty on a replayed event
    // (idempotency.runOnce skips running `fn` entirely) or a plain BULK_BUY
    // capture, so nothing is pushed by accident.
    let postCommit: PaymentPostCommitAction | null = null;

    const { body } = await this.idempotency.runOnce<{ received: boolean }>('razorpay:webhook', eventId, null, async (tx) => {
      await tx.webhookEvent.create({
        data: { eventId, type: rawEvent.event ?? 'unknown', payload: rawEvent as unknown as Prisma.InputJsonValue },
      });

      switch (rawEvent.event) {
        case 'payment.captured':
        case 'order.paid':
          postCommit = await this.applyCapture(tx, rawEvent);
          break;
        case 'refund.processed':
          postCommit = await this.applyRefund(tx, rawEvent);
          break;
        default:
          this.logger.log(`Ignoring unhandled Razorpay webhook event type: ${rawEvent.event ?? 'unknown'}`);
      }

      return { status: 200, body: { received: true } };
    });

    // Post-commit, best-effort — the capture (and any domain advance its
    // handler made) is already durably committed by this point; this is a
    // pure convenience on top of it, never a precondition.
    if (postCommit) {
      try {
        await (postCommit as PaymentPostCommitAction)();
      } catch (error) {
        this.logger.error(`Post-commit payment action failed for webhook event ${eventId} (state change already committed)`, error instanceof Error ? error.stack : String(error));
      }
    }

    return body;
  }

  /**
   * Routes on `payment.linkedEntityType` through the link-handler registry
   * (see PaymentLinkHandler). A payment with a registered handler credits
   * that handler's pocket and runs its onCaptured hook in this SAME tx. Every
   * other payment (unlinked, or `'Commitment'` — bulk-buy's own) is
   * UNTOUCHED: still credits BULK_BUY exactly as before.
   */
  private async applyCapture(tx: Prisma.TransactionClient, rawEvent: RazorpayWebhookEvent): Promise<PaymentPostCommitAction | null> {
    const paymentEntity = rawEvent.payload?.payment?.entity;
    const orderId = paymentEntity?.order_id;
    const razorpayPaymentId = paymentEntity?.id;
    const amountPaise = paymentEntity?.amount;
    if (!orderId || !razorpayPaymentId || typeof amountPaise !== 'number') {
      throw new BadRequestException('payment.captured webhook missing payment.entity.order_id/id/amount');
    }

    const payment = await tx.payment.findUnique({ where: { orderId } });
    if (!payment) {
      throw new NotFoundException(`No Payment found for Razorpay order ${orderId}`);
    }

    // Payment-level idempotency guard, DISTINCT from the event-level guard in
    // handleWebhook: Razorpay commonly delivers both `payment.captured` AND
    // `order.paid` for the same capture, as two events with two different
    // ids, so IdempotencyService.runOnce (keyed on event.id) does not catch
    // this pair — without this check the second event would credit
    // BULK_BUY/MAINTENANCE a second time for money that only moved once.
    // Whichever of the two capture-type events arrives first does the work;
    // the other is a verified no-op, regardless of arrival order.
    if (payment.status === PaymentStatus.CAPTURED) {
      this.logger.log(`Ignoring duplicate capture event for already-captured Payment ${payment.id} (order ${orderId}) — no second ledger entry posted.`);
      return null;
    }

    const amountRupees = amountPaise / 100;
    const handler = this.handlerFor(payment);

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.CAPTURED, paymentId: razorpayPaymentId },
    });

    await this.ledger.post(
      {
        societyId: payment.societyId,
        debitKind: AccountKind.EXTERNAL,
        creditKind: await this.pocketFor(tx, handler, payment),
        amount: amountRupees,
        reasonCode: 'PAYMENT_CAPTURED',
        linkedEntityType: 'Payment',
        linkedEntityId: payment.id,
      },
      tx,
    );

    // Phase 4C hook: a Commitment becomes FUNDED reactively, the moment its
    // linked Payment is captured — this is the ONLY place Commitment.status
    // ever flips to FUNDED (BulkBuyService never sets it directly). Kept
    // minimal and guarded: updateMany + a PENDING-only where clause is a
    // silent no-op for every non-bulk-buy Payment (no Commitment row to
    // match) and can't clobber a Commitment that's already FUNDED or was
    // CANCELLED out from under it. UNCHANGED from pre-Phase-9.2 — a
    // handler-routed payment never matches this where clause.
    if (payment.linkedEntityType === 'Commitment' && payment.linkedEntityId) {
      await tx.commitment.updateMany({
        where: { id: payment.linkedEntityId, status: CommitmentStatus.PENDING },
        data: { status: CommitmentStatus.FUNDED },
      });
    }

    if (handler?.onCaptured) {
      return (await handler.onCaptured(tx, payment.linkedEntityId as string, amountRupees, payment)) ?? null;
    }
    return null;
  }

  /**
   * PENDING/PARTIAL -> PARTIAL/PAID hook, mirrored on the Commitment->FUNDED
   * hook's guarded-updateMany style above: `paidAmount` is incremented by
   * this capture's amount, and status flips to PAID once
   * `paidAmount >= amount + lateFeeAccrued`, else PARTIAL. The updateMany's
   * `status: { in: [PENDING, PARTIAL] }` guard means a charge that's
   * somehow already PAID/WAIVED is left untouched (defense in depth on top
   * of the payment-level CAPTURED guard above, which is what actually
   * prevents a double-apply in practice). Returns a push descriptor for the
   * caller's post-commit `bill.paid` emit, or null if there's nothing to
   * push (missing charge row, or the guard didn't match).
   */
  private async advanceMaintenanceCharge(tx: Prisma.TransactionClient, chargeId: string, amountRupees: number): Promise<PendingBillPaidPush | null> {
    const charge = await tx.maintenanceCharge.findUnique({ where: { id: chargeId } });
    if (!charge) {
      this.logger.warn(`payment.captured linked to missing MaintenanceCharge ${chargeId} — MAINTENANCE ledger already credited, but no charge row to advance`);
      return null;
    }

    const newPaidAmount = charge.paidAmount.plus(amountRupees);
    const totalDue = charge.amount.plus(charge.lateFeeAccrued);
    const newStatus = newPaidAmount.greaterThanOrEqualTo(totalDue) ? MaintenanceChargeStatus.PAID : MaintenanceChargeStatus.PARTIAL;

    const result = await tx.maintenanceCharge.updateMany({
      where: { id: chargeId, status: { in: [MaintenanceChargeStatus.PENDING, MaintenanceChargeStatus.PARTIAL] } },
      data: { paidAmount: newPaidAmount, status: newStatus },
    });
    if (result.count === 0) {
      this.logger.warn(`MaintenanceCharge ${chargeId} was not PENDING/PARTIAL when its payment captured — paidAmount/status not advanced (status=${charge.status})`);
      return null;
    }

    const occupancy = await tx.occupancy.findFirst({
      where: { flatId: charge.flatId, tenureEndedAt: null, ratificationStatus: RatificationStatus.RATIFIED },
      orderBy: { tenureStartedAt: 'asc' },
      select: { userId: true },
    });
    if (!occupancy) {
      this.logger.warn(`No ratified resident found for flat ${charge.flatId} — bill.paid not pushed for charge ${chargeId}`);
      return null;
    }

    return { residentId: occupancy.userId, chargeId, amount: newPaidAmount.toString(), status: newStatus };
  }

  /** Post-commit, best-effort `bill.paid` push — see PendingBillPaidPush's doc comment for why this never runs inside the webhook's own tx. */
  private async pushBillPaid(pending: PendingBillPaidPush): Promise<void> {
    try {
      await this.realtime.emitToUser(pending.residentId, 'bill.paid', {
        chargeId: pending.chargeId,
        amount: pending.amount,
        status: pending.status,
        kind: 'MAINTENANCE',
      });
    } catch (error) {
      this.logger.error(`Post-commit bill.paid push failed for charge ${pending.chargeId} (payment already captured)`, error instanceof Error ? error.stack : String(error));
    }
  }

  /**
   * Symmetric to applyCapture: a payment with a registered handler reverses
   * that handler's pocket and runs its onRefunded hook in this SAME tx.
   * Every other payment is UNTOUCHED — still reverses BULK_BUY as before.
   */
  private async applyRefund(tx: Prisma.TransactionClient, rawEvent: RazorpayWebhookEvent): Promise<PaymentPostCommitAction | null> {
    const refundEntity = rawEvent.payload?.refund?.entity;
    const razorpayPaymentId = refundEntity?.payment_id;
    const amountPaise = refundEntity?.amount;
    if (!razorpayPaymentId || typeof amountPaise !== 'number') {
      throw new BadRequestException('refund.processed webhook missing refund.entity.payment_id/amount');
    }

    const payment = await tx.payment.findUnique({ where: { paymentId: razorpayPaymentId } });
    if (!payment) {
      throw new NotFoundException(`No Payment found for Razorpay payment ${razorpayPaymentId}`);
    }

    // Same payment-level idempotency guard as applyCapture, for the same
    // reason (a duplicate refund.processed delivery under a different event
    // id must not reverse the ledger twice). v1 only supports one full
    // refund per Payment — there's no partial/multiple-refund model yet, so
    // "already REFUNDED" is unconditionally a no-op. Partial/multiple
    // refunds against a single Payment are future (post-4B) work.
    if (payment.status === PaymentStatus.REFUNDED) {
      this.logger.log(`Ignoring duplicate refund event for already-refunded Payment ${payment.id} (razorpay payment ${razorpayPaymentId}) — no second ledger entry posted.`);
      return null;
    }

    const amountRupees = amountPaise / 100;
    const handler = this.handlerFor(payment);

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.REFUNDED },
    });

    await this.ledger.post(
      {
        societyId: payment.societyId,
        debitKind: await this.pocketFor(tx, handler, payment),
        creditKind: AccountKind.EXTERNAL,
        amount: amountRupees,
        reasonCode: 'PAYMENT_REFUNDED',
        linkedEntityType: 'Payment',
        linkedEntityId: payment.id,
      },
      tx,
    );

    if (handler?.onRefunded) {
      return (await handler.onRefunded(tx, payment.linkedEntityId as string, amountRupees, payment)) ?? null;
    }
    return null;
  }

  /** Symmetric reversal of advanceMaintenanceCharge — decrements paidAmount (floored at 0) and steps status back down; never re-marks PAID. */
  private async revertMaintenanceCharge(tx: Prisma.TransactionClient, chargeId: string, amountRupees: number): Promise<void> {
    const charge = await tx.maintenanceCharge.findUnique({ where: { id: chargeId } });
    if (!charge) {
      this.logger.warn(`refund.processed linked to missing MaintenanceCharge ${chargeId} — MAINTENANCE ledger already reversed, but no charge row to revert`);
      return;
    }

    const totalDue = charge.amount.plus(charge.lateFeeAccrued);
    const newPaidAmount = Decimal.max(0, charge.paidAmount.minus(amountRupees));
    const newStatus = newPaidAmount.lessThanOrEqualTo(0) ? MaintenanceChargeStatus.PENDING : newPaidAmount.lessThan(totalDue) ? MaintenanceChargeStatus.PARTIAL : charge.status;

    const result = await tx.maintenanceCharge.updateMany({
      where: { id: chargeId, status: { in: [MaintenanceChargeStatus.PARTIAL, MaintenanceChargeStatus.PAID] } },
      data: { paidAmount: newPaidAmount, status: newStatus },
    });
    if (result.count === 0) {
      this.logger.warn(`MaintenanceCharge ${chargeId} was not PARTIAL/PAID when its payment refunded — paidAmount/status not reverted (status=${charge.status})`);
    }
  }
}

/** Minimal shape we rely on from a Razorpay webhook payload — real payloads carry a lot more, but this is all PaymentsService reads. */
export interface RazorpayWebhookEvent {
  id: string;
  event: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; amount?: number; status?: string } };
    refund?: { entity?: { id?: string; payment_id?: string; amount?: number; status?: string } };
  };
}
