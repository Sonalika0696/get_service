import { Injectable } from '@nestjs/common';
import { generate, generateSecret, generateURI, verify } from 'otplib';
import { AppConfigService } from '../../config/config.service.js';

const CODE_PATTERN = /^\d{6}$/;

/**
 * Thin wrapper around otplib's functional TOTP API (RFC 6238, the standard
 * Google-Authenticator-compatible flavour: 6 digits, SHA-1, 30s step —
 * otplib's own defaults, unchanged here). Backs the mandatory 2FA path for
 * VENDOR/OPERATOR principals (DECISIONS_V2_SCOPE.md §7.2) —
 * OfficerAuthService is the only caller. Secrets are stored server-side
 * (User.totpSecret) exactly as otplib.generateSecret() returns them
 * (Base32) — never logged, never returned again once enrollment completes.
 */
@Injectable()
export class TotpService {
  constructor(private readonly config: AppConfigService) {}

  async generateSecret(): Promise<string> {
    return generateSecret();
  }

  /** otpauth:// provisioning URI for an authenticator app (Google Authenticator, Authy, ...) to scan/import. */
  async provisioningUri(secret: string, accountLabel: string): Promise<string> {
    return generateURI({ secret, label: accountLabel, issuer: this.config.env.TOTP_ISSUER, strategy: 'totp' });
  }

  /** Only used by tests that need a real, currently-valid code for a given secret — never used to bypass verification. */
  async generateCode(secret: string): Promise<string> {
    return generate({ secret, strategy: 'totp' });
  }

  /** Never throws on a malformed/absent code — just reports "not valid". */
  async verify(secret: string, token: string | undefined | null): Promise<boolean> {
    if (!token || !CODE_PATTERN.test(token)) return false;
    try {
      const result = await verify({ token, secret, strategy: 'totp' });
      return result.valid;
    } catch {
      return false;
    }
  }
}
