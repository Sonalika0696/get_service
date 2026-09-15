import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service.js';

const REQUEST_TIMEOUT_MS = 5000;
const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

export interface CreateOrderInput {
  /** Paise (smallest INR unit) — Razorpay's own convention. Callers (PaymentsService) convert from our own rupee-denominated Payment.amount before calling this. */
  amount: number;
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrder {
  id: string;
  /** Paise — Razorpay's own convention, unlike Payment.amount in our schema which is rupees. */
  amount: number;
  currency: string;
  status: string;
}

export interface RefundInput {
  paymentId: string;
  /** Paise — see CreateOrderInput's doc comment for the convention. */
  amount: number;
}

export interface RazorpayRefund {
  id: string;
  paymentId: string;
  amount: number;
  status: string;
}

export interface PayoutInput {
  vendorId: string;
  /** Paise — see CreateOrderInput's doc comment for the convention. */
  amount: number;
}

export interface RazorpayPayout {
  id: string;
  vendorId: string;
  amount: number;
  status: string;
}

/**
 * Thin client for the Razorpay Orders/Payments/Refunds APIs, feature-flagged
 * exactly like GstinApiService (see src/infra/gstinapi/gstinapi.service.ts):
 * RAZORPAY_ENABLED=false (the default — dev and every automated test) routes
 * every money-movement call to a deterministic, offline, in-memory stub, so
 * the whole payments module runs with no network and no real Razorpay
 * account. Flipping the flag + supplying real sandbox keys swaps in the
 * genuine HTTPS calls with no other code changes.
 *
 * Money-unit convention: this class's public API speaks the SAME units as
 * Razorpay itself — paise (the smallest INR unit) — for createOrder's and
 * refund's `amount` inputs and for the RazorpayOrder/RazorpayRefund it
 * returns. The rupees<->paise conversion (x100 / /100) happens at the call
 * sites in PaymentsService, the only place that also deals with our own
 * `Payment.amount` column (stored in major units/rupees). Keeping this
 * boundary here means RazorpayService's behavior matches Razorpay's real API
 * docs exactly, with no unit surprises if RAZORPAY_ENABLED is flipped on.
 *
 * verifyWebhookSignature is the one exception to "stub when disabled": it is
 * ALWAYS a real HMAC-SHA256 computation, in both modes. Faking money capture
 * is fine for a sandbox integration; faking the one security check that
 * proves a webhook actually came from Razorpay would defeat the point of
 * building it at all.
 */
@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);

  constructor(private readonly config: AppConfigService) {}

  /** The public key id the frontend Checkout script needs — safe to expose to clients (unlike the key secret). */
  get keyId(): string {
    return this.config.env.RAZORPAY_KEY_ID;
  }

  async createOrder(input: CreateOrderInput): Promise<RazorpayOrder> {
    const amountPaise = Math.round(input.amount);
    const currency = input.currency ?? 'INR';

    if (!this.config.env.RAZORPAY_ENABLED) {
      return this.stubCreateOrder(input.receipt, amountPaise, currency);
    }

    try {
      return await this.fetchWithOneRetry<RazorpayOrder>('/orders', {
        amount: amountPaise,
        currency,
        receipt: input.receipt,
        notes: input.notes ?? {},
      });
    } catch (error) {
      this.logger.warn(`Razorpay createOrder failed for receipt ${input.receipt}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async refund(input: RefundInput): Promise<RazorpayRefund> {
    const amountPaise = Math.round(input.amount);

    if (!this.config.env.RAZORPAY_ENABLED) {
      return this.stubRefund(input.paymentId, amountPaise);
    }

    try {
      const raw = await this.fetchWithOneRetry<{ id: string; payment_id: string; amount: number; status: string }>(`/payments/${input.paymentId}/refund`, {
        amount: amountPaise,
      });
      return { id: raw.id, paymentId: raw.payment_id, amount: raw.amount, status: raw.status };
    } catch (error) {
      this.logger.warn(`Razorpay refund failed for payment ${input.paymentId}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * ALWAYS stubbed — deliberately NOT gated on RAZORPAY_ENABLED, unlike
   * createOrder/refund above. Phase 4C (bulk-buy vendor payouts) has a hard
   * project constraint: no real money ever moves and no real RazorpayX
   * (payout) API is ever called, even if RAZORPAY_ENABLED were somehow
   * flipped on for sandbox order/webhook testing. A real vendor payout
   * integration is explicitly out of scope; this only produces a
   * deterministic fake reference id so BulkBuyService has something to
   * stamp on Payout.razorpayPayoutRef. The actual money movement for a
   * payout is recorded entirely in the internal ledger (see
   * bulk-buy.service.ts's authorisePayout).
   */
  async payout(input: PayoutInput): Promise<RazorpayPayout> {
    return this.stubPayout(input.vendorId, Math.round(input.amount));
  }

  private stubPayout(vendorId: string, amountPaise: number): RazorpayPayout {
    const shortHash = createHash('sha256').update(`${vendorId}:${amountPaise}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16);
    return { id: `payout_stub_${shortHash}`, vendorId, amount: amountPaise, status: 'processed' };
  }

  /**
   * ALWAYS real (see class doc comment) — HMAC-SHA256(rawBody,
   * RAZORPAY_WEBHOOK_SECRET) hex, timing-safe compared to the signature
   * Razorpay sent in the `x-razorpay-signature` header. Never throws: a
   * malformed/absent signature or an unexpected error is just "not valid".
   */
  verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined | null): boolean {
    if (!signature) return false;
    try {
      const expected = createHmac('sha256', this.config.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
      const expectedBuf = Buffer.from(expected, 'hex');
      const actualBuf = Buffer.from(signature, 'hex');
      if (expectedBuf.length !== actualBuf.length) return false;
      return timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  /** Real HMAC-SHA256(orderId + '|' + paymentId, RAZORPAY_KEY_SECRET) — the standard Razorpay Checkout post-payment signature check. Not exercised by the webhook flow but included for completeness/frontend integration. */
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string | undefined | null): boolean {
    if (!signature) return false;
    try {
      const expected = createHmac('sha256', this.config.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
      const expectedBuf = Buffer.from(expected, 'hex');
      const actualBuf = Buffer.from(signature, 'hex');
      if (expectedBuf.length !== actualBuf.length) return false;
      return timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  private stubCreateOrder(receipt: string, amountPaise: number, currency: string): RazorpayOrder {
    const shortHash = createHash('sha256').update(receipt).digest('hex').slice(0, 16);
    return { id: `order_stub_${shortHash}`, amount: amountPaise, currency, status: 'created' };
  }

  private stubRefund(paymentId: string, amountPaise: number): RazorpayRefund {
    const shortHash = createHash('sha256').update(`${paymentId}:${amountPaise}:${Date.now()}`).digest('hex').slice(0, 16);
    return { id: `rfnd_stub_${shortHash}`, paymentId, amount: amountPaise, status: 'processed' };
  }

  private async fetchWithOneRetry<T>(path: string, body: unknown): Promise<T> {
    try {
      return await this.fetchOnce<T>(path, body);
    } catch (firstError) {
      this.logger.warn(`Razorpay ${path} attempt 1 failed, retrying once: ${firstError instanceof Error ? firstError.message : String(firstError)}`);
      return await this.fetchOnce<T>(path, body);
    }
  }

  private async fetchOnce<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const basicAuth = Buffer.from(`${this.config.env.RAZORPAY_KEY_ID}:${this.config.env.RAZORPAY_KEY_SECRET}`).toString('base64');
      const res = await fetch(`${RAZORPAY_API_BASE}${path}`, {
        method: 'POST',
        headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Razorpay API responded ${res.status}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
