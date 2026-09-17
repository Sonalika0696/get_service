import { describe, expect, it, vi } from 'vitest';
import { PaymentsService, type RazorpayWebhookEvent } from './payments.service.js';
import { AccountKind, PaymentStatus } from '../../generated/prisma/enums.js';

/**
 * Contract tests for the payment link-handler registry — the extension point
 * every money-collecting module (maintenance, events, camps, donations,
 * utility bills) uses instead of editing PaymentsService. Collaborators are
 * faked: this pins routing and ordering, while the real ledger/DB behaviour
 * stays covered by payments/maintenance/bulk-buy e2e.
 */

interface FakePayment {
  id: string;
  societyId: string;
  orderId: string;
  paymentId: string | null;
  status: PaymentStatus;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
}

function build(payment: FakePayment) {
  const order: string[] = [];
  const posts: { debitKind: AccountKind; creditKind: AccountKind; amount: number }[] = [];
  const tx = {
    webhookEvent: { create: vi.fn(async () => ({})) },
    payment: {
      findUnique: vi.fn(async () => payment),
      update: vi.fn(async ({ data }: { data: Partial<FakePayment> }) => Object.assign(payment, data)),
    },
    commitment: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  const ledger = {
    post: vi.fn(async (input: { debitKind: AccountKind; creditKind: AccountKind; amount: number }) => {
      order.push('ledger.post');
      posts.push(input);
    }),
  };
  const idempotency = {
    runOnce: vi.fn(async (_scope: string, _key: string, _sid: unknown, fn: (t: typeof tx) => Promise<{ status: number; body: unknown }>) => {
      const result = await fn(tx);
      order.push('tx.commit');
      return result;
    }),
  };
  const service = new PaymentsService({} as never, {} as never, ledger as never, idempotency as never, { emitToUser: vi.fn() } as never);
  return { service, tx, posts, order };
}

const capture = (orderId: string): RazorpayWebhookEvent => ({
  id: `evt_${orderId}`,
  event: 'payment.captured',
  payload: { payment: { entity: { id: `pay_${orderId}`, order_id: orderId, amount: 150000 } } },
});

const refund = (paymentId: string): RazorpayWebhookEvent => ({
  id: `evt_rf_${paymentId}`,
  event: 'refund.processed',
  payload: { refund: { entity: { id: 'rfnd_1', payment_id: paymentId, amount: 150000 } } },
});

function payment(overrides: Partial<FakePayment> = {}): FakePayment {
  return { id: 'p1', societyId: 's1', orderId: 'order_1', paymentId: null, status: PaymentStatus.CREATED, linkedEntityType: null, linkedEntityId: null, ...overrides };
}

describe('PaymentsService link-handler registry', () => {
  it('rejects a duplicate registration for the same entity type, including the built-in MaintenanceCharge', () => {
    const { service } = build(payment());
    expect(() => service.registerLinkHandler('MaintenanceCharge', { pocketKind: AccountKind.MAINTENANCE })).toThrow(/already registered/);
    service.registerLinkHandler('EventRegistration', { pocketKind: AccountKind.EVENTS });
    expect(() => service.registerLinkHandler('EventRegistration', { pocketKind: AccountKind.EVENTS })).toThrow(/already registered/);
  });

  it('still credits BULK_BUY for an unregistered or unlinked payment (pre-registry behaviour unchanged)', async () => {
    const unlinked = build(payment());
    await unlinked.service.handleWebhook(capture('order_1'));
    expect(unlinked.posts).toEqual([expect.objectContaining({ debitKind: AccountKind.EXTERNAL, creditKind: AccountKind.BULK_BUY, amount: 1500 })]);

    const commitment = build(payment({ linkedEntityType: 'Commitment', linkedEntityId: 'c1' }));
    await commitment.service.handleWebhook(capture('order_1'));
    expect(commitment.posts[0].creditKind).toBe(AccountKind.BULK_BUY);
    expect(commitment.tx.commitment.updateMany).toHaveBeenCalledTimes(1);
  });

  it('routes a registered entity to its constant pocket and runs onCaptured inside the tx, before commit', async () => {
    const { service, posts, order, tx } = build(payment({ linkedEntityType: 'EventRegistration', linkedEntityId: 'reg_1' }));
    const onCaptured = vi.fn(async (_tx: unknown, id: string, rupees: number) => {
      order.push(`onCaptured:${id}:${rupees}`);
    });
    service.registerLinkHandler('EventRegistration', { pocketKind: AccountKind.EVENTS, onCaptured });

    await service.handleWebhook(capture('order_1'));

    expect(posts).toEqual([expect.objectContaining({ creditKind: AccountKind.EVENTS, amount: 1500 })]);
    expect(onCaptured).toHaveBeenCalledWith(tx, 'reg_1', 1500, expect.objectContaining({ id: 'p1' }));
    expect(order).toEqual(['ledger.post', 'onCaptured:reg_1:1500', 'tx.commit']);
    expect(tx.commitment.updateMany).not.toHaveBeenCalled();
  });

  it('resolves an entity-dependent pocket in-tx (utility bills: ELECTRICITY vs WATER)', async () => {
    const { service, posts, tx } = build(payment({ linkedEntityType: 'FlatBill', linkedEntityId: 'bill_water' }));
    const resolver = vi.fn(async (_tx: unknown, id: string) => (id === 'bill_water' ? AccountKind.WATER : AccountKind.ELECTRICITY));
    service.registerLinkHandler('FlatBill', { pocketKind: resolver });

    await service.handleWebhook(capture('order_1'));

    expect(resolver).toHaveBeenCalledWith(tx, 'bill_water', expect.objectContaining({ id: 'p1' }));
    expect(posts[0].creditKind).toBe(AccountKind.WATER);
  });

  it('runs a returned post-commit action only after the tx commits, and swallows its failure', async () => {
    const { service, order } = build(payment({ linkedEntityType: 'EventRegistration', linkedEntityId: 'reg_1' }));
    service.registerLinkHandler('EventRegistration', {
      pocketKind: AccountKind.EVENTS,
      onCaptured: async () => async () => {
        order.push('postCommit');
        throw new Error('push outage');
      },
    });

    await expect(service.handleWebhook(capture('order_1'))).resolves.toEqual({ received: true });
    expect(order).toEqual(['ledger.post', 'tx.commit', 'postCommit']);
  });

  it('reverses the same resolved pocket on refund and runs onRefunded', async () => {
    const { service, posts } = build(payment({ status: PaymentStatus.CAPTURED, paymentId: 'pay_1', linkedEntityType: 'DonationContribution', linkedEntityId: 'don_1' }));
    const onRefunded = vi.fn(async () => undefined);
    service.registerLinkHandler('DonationContribution', { pocketKind: AccountKind.WELFARE, onRefunded });

    await service.handleWebhook(refund('pay_1'));

    expect(posts).toEqual([expect.objectContaining({ debitKind: AccountKind.WELFARE, creditKind: AccountKind.EXTERNAL, amount: 1500 })]);
    expect(onRefunded).toHaveBeenCalledWith(expect.anything(), 'don_1', 1500, expect.objectContaining({ id: 'p1' }));
  });

  it('never reaches the hook or posts twice for an already-captured payment', async () => {
    const { service, posts } = build(payment({ status: PaymentStatus.CAPTURED, linkedEntityType: 'EventRegistration', linkedEntityId: 'reg_1' }));
    const onCaptured = vi.fn(async () => undefined);
    service.registerLinkHandler('EventRegistration', { pocketKind: AccountKind.EVENTS, onCaptured });

    await service.handleWebhook(capture('order_1'));

    expect(posts).toHaveLength(0);
    expect(onCaptured).not.toHaveBeenCalled();
  });
});
