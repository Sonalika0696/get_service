import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service.js';

export interface SendSmsInput {
  to: string;
  body: string;
}

export interface SmsSendResult {
  id: string;
  status: string;
}

/**
 * Feature-flagged exactly like RazorpayService (see
 * src/infra/razorpay/razorpay.service.ts's doc comment) and GstinApiService:
 * SMS_ENABLED=false (the default — dev and every automated test) routes
 * every send() through a deterministic, offline, in-memory stub that logs
 * the message instead of transmitting it, so the phone-OTP resident login
 * path (Phase 6.2) runs with no network, no real SMS gateway account, and
 * no cost — a hard project constraint (see the task's "no real external
 * side-effects" rule, mirroring RAZORPAY_ENABLED's).
 *
 * Unlike RazorpayService, there is deliberately NO real-gateway code path
 * in this phase: flipping SMS_ENABLED on throws rather than silently doing
 * nothing (or, worse, someone wiring in a real provider under time
 * pressure). Wiring an actual SMS gateway (Twilio, MSG91, ...) is out of
 * Phase 6.2's scope.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: AppConfigService) {}

  async send(input: SendSmsInput): Promise<SmsSendResult> {
    if (!this.config.env.SMS_ENABLED) {
      return this.stubSend(input);
    }
    throw new Error('SMS_ENABLED=true has no real gateway wired up in Phase 6.2 — keep it false.');
  }

  private stubSend(input: SendSmsInput): SmsSendResult {
    this.logger.debug(`[SMS STUB] to=${input.to} body="${input.body}"`);
    const id = `sms_stub_${createHash('sha256').update(`${input.to}:${input.body}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16)}`;
    return { id, status: 'stub_logged' };
  }
}
