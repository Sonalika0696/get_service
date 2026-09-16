import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service.js';

describe('PasswordService (argon2)', () => {
  it('hashes a password and verifies the same password against the hash', async () => {
    const service = new PasswordService();
    const hash = await service.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2/);
    expect(await service.verify(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const service = new PasswordService();
    const hash = await service.hash('correct horse battery staple');
    expect(await service.verify(hash, 'wrong password')).toBe(false);
  });

  it('never throws on a malformed hash — reports "does not match" instead', async () => {
    const service = new PasswordService();
    await expect(service.verify('not-a-real-argon2-hash', 'anything')).resolves.toBe(false);
  });

  it('never stores the raw password — the hash differs from the input and is salted (two hashes of the same password differ)', async () => {
    const service = new PasswordService();
    const a = await service.hash('same password');
    const b = await service.hash('same password');
    expect(a).not.toBe('same password');
    expect(a).not.toBe(b);
  });
});
