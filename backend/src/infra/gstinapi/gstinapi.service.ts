import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service.js';

export type GstinStatus = 'Active' | 'Inactive' | 'Unknown';

export interface GstinLookupResult {
  status: GstinStatus;
  raw?: unknown;
}

const LOOKUP_TIMEOUT_MS = 5000;

/**
 * Deterministic offline stub used whenever GSTIN_API_ENABLED is false (the
 * default — dev and all automated tests). No network call is made, which is
 * what lets the vendor-approval e2e prove the tier flip without a live API
 * key.
 *
 * Rule: a syntactically well-formed GSTIN (exactly 15 characters, the real
 * GSTIN length) is treated as Active, *unless* it starts with "00" — a
 * deliberately cheap, deterministic way for a test to exercise the "stays
 * UNVERIFIED" path offline. Anything empty or the wrong length is Unknown.
 */
export function stubLookup(gstin: string): GstinLookupResult {
  if (!gstin || gstin.length !== 15) {
    return { status: 'Unknown' };
  }
  if (gstin.startsWith('00')) {
    return { status: 'Inactive' };
  }
  return { status: 'Active' };
}

function extractStatus(raw: unknown): GstinStatus {
  if (raw && typeof raw === 'object' && 'status' in raw) {
    const value = (raw as { status?: unknown }).status;
    if (value === 'Active' || value === 'Inactive') return value;
  }
  return 'Unknown';
}

/**
 * Thin client for an external GSTIN (GST registration number) lookup API.
 * Used by VendorsService during vendor approval to decide whether a
 * vendor's self-declared GSTIN is Active before promoting its verification
 * tier from UNVERIFIED to SOCIETY_ATTESTED.
 *
 * `lookup` never throws — a failed or disabled external check is non-fatal;
 * the caller just leaves the vendor's tier where it was.
 */
@Injectable()
export class GstinApiService {
  private readonly logger = new Logger(GstinApiService.name);

  constructor(private readonly config: AppConfigService) {}

  async lookup(gstin: string): Promise<GstinLookupResult> {
    if (!this.config.env.GSTIN_API_ENABLED) {
      return stubLookup(gstin);
    }

    try {
      return await this.fetchWithOneRetry(gstin);
    } catch (error) {
      this.logger.warn(`GSTIN lookup failed for ${gstin}: ${error instanceof Error ? error.message : String(error)}`);
      return { status: 'Unknown' };
    }
  }

  private async fetchWithOneRetry(gstin: string): Promise<GstinLookupResult> {
    try {
      return await this.fetchOnce(gstin);
    } catch (firstError) {
      this.logger.warn(
        `GSTIN lookup attempt 1 failed for ${gstin}, retrying once: ${firstError instanceof Error ? firstError.message : String(firstError)}`,
      );
      return await this.fetchOnce(gstin);
    }
  }

  private async fetchOnce(gstin: string): Promise<GstinLookupResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.config.env.GSTIN_API_URL}/${encodeURIComponent(gstin)}`, {
        headers: this.config.env.GSTIN_API_KEY ? { Authorization: `Bearer ${this.config.env.GSTIN_API_KEY}` } : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`GSTIN API responded ${res.status}`);
      }
      const raw = (await res.json()) as unknown;
      return { status: extractStatus(raw), raw };
    } finally {
      clearTimeout(timer);
    }
  }
}
