import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema.js';

const validConfig = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/society_fintech',
};

describe('validateEnv', () => {
  it('applies defaults when optional vars are omitted', () => {
    const env = validateEnv(validConfig);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.API_CORS_ORIGIN).toBe('http://localhost:3000');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SESSION_COOKIE_NAME).toBe('sid');
    expect(env.SESSION_TTL_DAYS).toBe(30);
    expect(env.SMTP_HOST).toBe('localhost');
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.API_BASE_URL).toBe('http://localhost:4000');
    expect(env.GSTIN_API_ENABLED).toBe(false);
    expect(env.GSTIN_API_URL).toBe('https://gstinapi.in/api/v1/gstin');
    expect(env.GSTIN_API_KEY).toBe('');
    expect(env.RAZORPAY_ENABLED).toBe(false);
    expect(env.RAZORPAY_KEY_ID).toBe('rzp_test_stub');
    expect(env.RAZORPAY_KEY_SECRET).toBe('stub_secret');
    expect(env.RAZORPAY_WEBHOOK_SECRET).toBe('stub_webhook_secret');
    expect(env.THROTTLE_ENABLED).toBe(true);
  });

  it('coerces RAZORPAY_ENABLED from "true"/"1" and leaves anything else falsy', () => {
    expect(validateEnv({ ...validConfig, RAZORPAY_ENABLED: 'true' }).RAZORPAY_ENABLED).toBe(true);
    expect(validateEnv({ ...validConfig, RAZORPAY_ENABLED: '1' }).RAZORPAY_ENABLED).toBe(true);
    expect(validateEnv({ ...validConfig, RAZORPAY_ENABLED: 'false' }).RAZORPAY_ENABLED).toBe(false);
    expect(validateEnv({ ...validConfig, RAZORPAY_ENABLED: 'nonsense' }).RAZORPAY_ENABLED).toBe(false);
  });

  it('coerces GSTIN_API_ENABLED from "true"/"1" and leaves anything else falsy', () => {
    expect(validateEnv({ ...validConfig, GSTIN_API_ENABLED: 'true' }).GSTIN_API_ENABLED).toBe(true);
    expect(validateEnv({ ...validConfig, GSTIN_API_ENABLED: '1' }).GSTIN_API_ENABLED).toBe(true);
    expect(validateEnv({ ...validConfig, GSTIN_API_ENABLED: 'false' }).GSTIN_API_ENABLED).toBe(false);
    expect(validateEnv({ ...validConfig, GSTIN_API_ENABLED: 'nonsense' }).GSTIN_API_ENABLED).toBe(false);
  });

  it('coerces THROTTLE_ENABLED from "true"/"1" and leaves anything else falsy', () => {
    expect(validateEnv({ ...validConfig, THROTTLE_ENABLED: 'true' }).THROTTLE_ENABLED).toBe(true);
    expect(validateEnv({ ...validConfig, THROTTLE_ENABLED: '1' }).THROTTLE_ENABLED).toBe(true);
    expect(validateEnv({ ...validConfig, THROTTLE_ENABLED: 'false' }).THROTTLE_ENABLED).toBe(false);
    expect(validateEnv({ ...validConfig, THROTTLE_ENABLED: 'nonsense' }).THROTTLE_ENABLED).toBe(false);
  });

  it('coerces API_PORT from a string', () => {
    const env = validateEnv({ ...validConfig, API_PORT: '5000' });
    expect(env.API_PORT).toBe(5000);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('throws when NODE_ENV is not one of the allowed values', () => {
    expect(() => validateEnv({ ...validConfig, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('throws when API_CORS_ORIGIN is not a valid URL', () => {
    expect(() => validateEnv({ ...validConfig, API_CORS_ORIGIN: 'not-a-url' })).toThrow(/API_CORS_ORIGIN/);
  });
});
