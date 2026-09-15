import { z } from 'zod';

/**
 * Phase 0 + Phase 1 (auth, notifications) env surface. Later phases
 * (Razorpay, simulation) extend this schema when their modules land — see
 * .env.example for the full, phase-annotated list of vars the app will
 * eventually read.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_CORS_ORIGIN: z.url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.url(),

  SESSION_COOKIE_NAME: z.string().min(1).default('sid'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  SMTP_HOST: z.string().min(1).default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().min(1).default('no-reply@societyfintech.local'),

  /** Used to build absolute links inside emails (company-email verification). */
  API_BASE_URL: z.url().default('http://localhost:4000'),

  // --- Phase 2 (vendor marketplace) ---
  /**
   * Off by default — dev and all automated tests run GstinApiService
   * against a deterministic offline stub instead of a real network call
   * (see src/infra/gstinapi/gstinapi.service.ts). Accepts "true"/"1" as
   * truthy, anything else (including unset) is false.
   */
  GSTIN_API_ENABLED: z.preprocess((value) => value === 'true' || value === '1', z.boolean()).default(false),
  GSTIN_API_URL: z.url().default('https://gstinapi.in/api/v1/gstin'),
  GSTIN_API_KEY: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
