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
