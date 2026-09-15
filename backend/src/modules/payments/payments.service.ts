import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RazorpayService } from '../../infra/razorpay/razorpay.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { IdempotencyService } from '../ledger/idempotency.service.js';
import { AccountKind, PaymentStatus } from '../../generated/prisma/enums.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PaymentModel } from '../../generated/prisma/models.js';
import type { CreateOrderDto } from './dto/create-order.dto.js';

export interface CreateOrderResult {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
}

export interface RefundInitiatedResult {
  refundId: string;
  status: string;
  note: string;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
  ) {}

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
  async refund(societyId: string, id: string): Promise<RefundInitiatedResult> {
    const payment = await this.get(societyId, id);
    if (payment.status !== PaymentStatus.CAPTURED || !payment.paymentId) {
      throw new BadRequestException(`Payment ${id} is not in a refundable state (status=${payment.status})`);
    }

    const refund = await this.razorpay.refund({ paymentId: payment.paymentId, amount: rupeesToPaise(payment.amount) });

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

    const { body } = await this.idempotency.runOnce<{ received: boolean }>('razorpay:webhook', eventId, null, async (tx) => {
      await tx.webhookEvent.create({
        data: { eventId, type: rawEvent.event ?? 'unknown', payload: rawEvent as unknown as Prisma.InputJsonValue },
      });

      switch (rawEvent.event) {
        case 'payment.captured':
        case 'order.paid':
          await this.applyCapture(tx, rawEvent);
          break;
        case 'refund.processed':
          await this.applyRefund(tx, rawEvent);
          break;
        default:
          this.logger.log(`Ignoring unhandled Razorpay webhook event type: ${rawEvent.event ?? 'unknown'}`);
      }

      return { status: 200, body: { received: true } };
    });
    return body;
  }

  private async applyCapture(tx: Prisma.TransactionClient, rawEvent: RazorpayWebhookEvent): Promise<void> {
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
    // BULK_BUY a second time for money that only moved once. Whichever of
    // the two capture-type events arrives first does the work; the other is
    // a verified no-op, regardless of arrival order.
    if (payment.status === PaymentStatus.CAPTURED) {
      this.logger.log(`Ignoring duplicate capture event for already-captured Payment ${payment.id} (order ${orderId}) — no second ledger entry posted.`);
      return;
    }

    const amountRupees = amountPaise / 100;

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.CAPTURED, paymentId: razorpayPaymentId },
    });

    await this.ledger.post(
      {
        societyId: payment.societyId,
        debitKind: AccountKind.EXTERNAL,
        creditKind: AccountKind.BULK_BUY,
        amount: amountRupees,
        reasonCode: 'PAYMENT_CAPTURED',
        linkedEntityType: 'Payment',
        linkedEntityId: payment.id,
      },
      tx,
    );
  }

  private async applyRefund(tx: Prisma.TransactionClient, rawEvent: RazorpayWebhookEvent): Promise<void> {
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
      return;
    }

    const amountRupees = amountPaise / 100;

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.REFUNDED },
    });

    await this.ledger.post(
      {
        societyId: payment.societyId,
        debitKind: AccountKind.BULK_BUY,
        creditKind: AccountKind.EXTERNAL,
        amount: amountRupees,
        reasonCode: 'PAYMENT_REFUNDED',
        linkedEntityType: 'Payment',
        linkedEntityId: payment.id,
      },
      tx,
    );
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
