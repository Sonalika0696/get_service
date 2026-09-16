import { describe, expect, it } from 'vitest';
import { TotpService } from './totp.service.js';
import type { AppConfigService } from '../../config/config.service.js';

function makeService(): TotpService {
  const fakeConfig = { env: { TOTP_ISSUER: 'GateX Test' } } as AppConfigService;
  return new TotpService(fakeConfig);
}

describe('TotpService (otplib, RFC 6238)', () => {
  it('generates a secret and a real current code that verify() accepts', async () => {
    const service = makeService();
    const secret = await service.generateSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThan(0);

    const code = await service.generateCode(secret);
    expect(code).toMatch(/^\d{6}$/);
    expect(await service.verify(secret, code)).toBe(true);
  });

  it('rejects a wrong code', async () => {
    const service = makeService();
    const secret = await service.generateSecret();
    const code = await service.generateCode(secret);
    const wrong = code === '000000' ? '111111' : '000000';
    expect(await service.verify(secret, wrong)).toBe(false);
  });

  it('rejects an absent/malformed code without throwing', async () => {
    const service = makeService();
    const secret = await service.generateSecret();
    expect(await service.verify(secret, undefined)).toBe(false);
    expect(await service.verify(secret, null)).toBe(false);
    expect(await service.verify(secret, 'abc')).toBe(false);
    expect(await service.verify(secret, '12345')).toBe(false);
  });

  it('a code generated for one secret does not verify against a different secret', async () => {
    const service = makeService();
    const secretA = await service.generateSecret();
    const secretB = await service.generateSecret();
    const codeForA = await service.generateCode(secretA);
    expect(await service.verify(secretB, codeForA)).toBe(false);
  });

  it('provisioningUri returns an otpauth:// URI carrying the issuer and secret', async () => {
    const service = makeService();
    const secret = await service.generateSecret();
    const uri = await service.provisioningUri(secret, 'vendor@example.com');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(encodeURIComponent('GateX Test'));
    expect(uri).toContain(secret);
  });
});
