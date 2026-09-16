import { describe, expect, it } from 'vitest';
import { SmsService } from './sms.service.js';
import type { AppConfigService } from '../../config/config.service.js';

function makeService(smsEnabled: boolean): SmsService {
  const fakeConfig = { env: { SMS_ENABLED: smsEnabled } } as AppConfigService;
  return new SmsService(fakeConfig);
}

describe('SmsService (stub mode, SMS_ENABLED=false)', () => {
  it('send() never performs a real network call — returns a deterministic stub result', async () => {
    const service = makeService(false);
    const result = await service.send({ to: '+919999900001', body: 'Your verification code is 123456.' });
    expect(result.id).toMatch(/^sms_stub_[a-f0-9]{16}$/);
    expect(result.status).toBe('stub_logged');
  });

  it('two different messages get different stub ids', async () => {
    const service = makeService(false);
    const a = await service.send({ to: '+919999900001', body: 'code A' });
    const b = await service.send({ to: '+919999900002', body: 'code B' });
    expect(a.id).not.toBe(b.id);
  });
});

describe('SmsService — SMS_ENABLED=true has no real gateway in this phase', () => {
  it('throws rather than silently doing nothing or sending for real', async () => {
    const service = makeService(true);
    await expect(service.send({ to: '+919999900001', body: 'code' })).rejects.toThrow(/no real gateway/i);
  });
});
