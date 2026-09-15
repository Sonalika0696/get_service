import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RazorpayService } from './razorpay.service.js';
import type { AppConfigService } from '../../config/config.service.js';

const WEBHOOK_SECRET = 'test_webhook_secret';
const KEY_SECRET = 'test_key_secret';

function makeService(overrides: Partial<AppConfigService['env']> = {}): RazorpayService {
  const fakeConfig = {
    env: {
      RAZORPAY_ENABLED: false,
      RAZORPAY_KEY_ID: 'rzp_test_stub',
      RAZORPAY_KEY_SECRET: KEY_SECRET,
      RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
      ...overrides,
    },
  } as AppConfigService;
  return new RazorpayService(fakeConfig);
}

describe('RazorpayService (stub mode, RAZORPAY_ENABLED=false)', () => {
  it('createOrder returns a deterministic stub order derived from the receipt, with no network call', async () => {
    const service = makeService();
    const order = await service.createOrder({ amount: 150000, receipt: 'receipt-1' });
    expect(order.id).toMatch(/^order_stub_[a-f0-9]{16}$/);
    expect(order.amount).toBe(150000);
    expect(order.currency).toBe('INR');
    expect(order.status).toBe('created');

    // Same receipt -> same stub id (deterministic).
    const again = await service.createOrder({ amount: 999, receipt: 'receipt-1' });
    expect(again.id).toBe(order.id);

    // Different receipt -> different stub id.
    const other = await service.createOrder({ amount: 150000, receipt: 'receipt-2' });
    expect(other.id).not.toBe(order.id);
  });

  it('refund returns a deterministic-shaped stub refund', async () => {
    const service = makeService();
    const refund = await service.refund({ paymentId: 'pay_stub_abc', amount: 50000 });
    expect(refund.id).toMatch(/^rfnd_stub_[a-f0-9]{16}$/);
    expect(refund.paymentId).toBe('pay_stub_abc');
    expect(refund.amount).toBe(50000);
    expect(refund.status).toBe('processed');
  });
});

describe('RazorpayService.verifyWebhookSignature — always real HMAC-SHA256, in both stub and real mode', () => {
  function sign(body: string, secret = WEBHOOK_SECRET): string {
    return createHmac('sha256', secret).update(body).digest('hex');
  }

  it('accepts a correctly signed body', () => {
    const service = makeService();
    const body = JSON.stringify({ event: 'payment.captured' });
    expect(service.verifyWebhookSignature(body, sign(body))).toBe(true);
  });

  it('accepts a correctly signed Buffer body (raw bytes, as Express would hand it over)', () => {
    const service = makeService();
    const body = JSON.stringify({ event: 'payment.captured' });
    expect(service.verifyWebhookSignature(Buffer.from(body), sign(body))).toBe(true);
  });

  it('rejects a tampered body signed with the right secret', () => {
    const service = makeService();
    const body = JSON.stringify({ event: 'payment.captured' });
    const sig = sign(body);
    const tampered = JSON.stringify({ event: 'payment.captured', amount: 999999 });
    expect(service.verifyWebhookSignature(tampered, sig)).toBe(false);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const service = makeService();
    const body = JSON.stringify({ event: 'x' });
    expect(service.verifyWebhookSignature(body, sign(body, 'wrong_secret'))).toBe(false);
  });

  it('never throws on a malformed/missing signature — just returns false', () => {
    const service = makeService();
    const body = JSON.stringify({ event: 'x' });
    expect(service.verifyWebhookSignature(body, undefined)).toBe(false);
    expect(service.verifyWebhookSignature(body, null)).toBe(false);
    expect(service.verifyWebhookSignature(body, '')).toBe(false);
    expect(service.verifyWebhookSignature(body, 'not-hex-!!!')).toBe(false);
    expect(service.verifyWebhookSignature(body, 'ab')).toBe(false); // valid hex, wrong length
  });

  it('behaves identically whether RAZORPAY_ENABLED is true or false', () => {
    const disabled = makeService({ RAZORPAY_ENABLED: false });
    const enabled = makeService({ RAZORPAY_ENABLED: true });
    const body = JSON.stringify({ event: 'refund.processed' });
    const sig = sign(body);
    expect(disabled.verifyWebhookSignature(body, sig)).toBe(true);
    expect(enabled.verifyWebhookSignature(body, sig)).toBe(true);
  });
});

describe('RazorpayService.verifyCheckoutSignature', () => {
  it('accepts a correctly signed orderId|paymentId pair using the key secret', () => {
    const service = makeService();
    const sig = createHmac('sha256', KEY_SECRET).update('order_abc|pay_xyz').digest('hex');
    expect(service.verifyCheckoutSignature('order_abc', 'pay_xyz', sig)).toBe(true);
  });

  it('rejects a mismatched pair', () => {
    const service = makeService();
    const sig = createHmac('sha256', KEY_SECRET).update('order_abc|pay_xyz').digest('hex');
    expect(service.verifyCheckoutSignature('order_abc', 'pay_other', sig)).toBe(false);
  });

  it('never throws on malformed input', () => {
    const service = makeService();
    expect(service.verifyCheckoutSignature('order_abc', 'pay_xyz', undefined)).toBe(false);
    expect(service.verifyCheckoutSignature('order_abc', 'pay_xyz', 'zz')).toBe(false);
  });
});
