import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { BbpsFetchInput, BbpsUtility, PresentedBill } from './bbps.types.js';

/**
 * Module-local feature flag. Deliberately NOT read from AppConfigService —
 * this lane isn't allowed to add a new env var (env.schema.ts is owned by
 * another lane). A later phase wires this to AppConfigService + a real BBPS
 * (Bharat Bill Payment System) gateway; until then it's always false and
 * every call below routes to the deterministic offline stub.
 */
const BBPS_ENABLED = false;

const DUE_DATE_OFFSET_DAYS = 20;

const BILLER_NAMES: Record<BbpsUtility, string> = {
  ELECTRICITY: 'State Electricity Distribution Co.',
  WATER: 'Municipal Water Supply Board',
};

/** Smallest plausible monthly bill, in paise (Rs 500.00). */
const MIN_AMOUNT_PAISE = 50_000;
/** Width of the plausible monthly bill range, in paise (~Rs 9,000.00). */
const AMOUNT_RANGE_PAISE = 900_000;

/** yyyy-mm anchor for "same input -> same output within a period" determinism below. */
function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function periodStartDate(period: string): Date {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4, 6));
  return new Date(Date.UTC(year, month - 1, 1));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Deterministic offline stub used whenever BBPS_ENABLED is false (always,
 * for now — see the constant above). No network call is made: the "bill" is
 * derived entirely from the consumer number, the utility, and the current
 * billing period (yyyy-mm), so repeated calls within the same period for the
 * same input return byte-identical results and automated tests stay stable.
 *
 * amountPaise and billNumber are both taken from a SHA-256 digest of
 * `consumerNumber:utility:period` — different consumer numbers (or a new
 * period) hash differently and therefore produce a different bill, while the
 * same triple always reproduces the same one.
 */
export function stubFetchBill(input: BbpsFetchInput): PresentedBill {
  const period = currentPeriod();
  const digest = createHash('sha256').update(`${input.consumerNumber}:${input.utility}:${period}`).digest();

  const amountOffset = digest.readUInt32BE(0) % AMOUNT_RANGE_PAISE;
  const amountPaise = MIN_AMOUNT_PAISE + amountOffset;

  const billNumber = `BBPS-${period}-${digest.toString('hex').slice(0, 10).toUpperCase()}`;

  const billDate = periodStartDate(period);
  const dueDate = addDays(billDate, DUE_DATE_OFFSET_DAYS);

  return {
    consumerNumber: input.consumerNumber,
    utility: input.utility,
    billNumber,
    amountPaise,
    dueDate: toIsoDate(dueDate),
    billDate: toIsoDate(billDate),
    billerName: BILLER_NAMES[input.utility],
  };
}

/**
 * Thin client for a BBPS (Bharat Bill Payment System) biller-fetch
 * integration, feature-flagged exactly like RazorpayService/GstinApiService
 * (see src/infra/razorpay/razorpay.service.ts and
 * src/infra/gstinapi/gstinapi.service.ts): BBPS_ENABLED=false (always, for
 * now) routes every fetch to a deterministic, offline, in-memory stub, so
 * Configuration A (individually-metered) societies can be developed and
 * tested with no network and no real BBPS biller-aggregator account.
 * Flipping the module-local flag + wiring a real gateway swaps in genuine
 * BBPS calls with no other code changes.
 *
 * Scope: Configuration A flats have their own licensee (electricity/water
 * board) connection identified by `consumerNumber`. This service only
 * PRESENTS the licensee's bill — it never computes one. Bill computation and
 * apportionment for sub-metered Configuration B societies is a separate,
 * unrelated lane (internal ledger logic, not BBPS).
 *
 * Invariant I3: any money owed to a third party (here, the electricity/water
 * board) MUST route through an authorised payment rail — BBPS is that rail.
 * Direct collect-and-remit (the platform receiving resident funds and itself
 * forwarding them to the board outside BBPS) is never an allowed shape, in
 * either stub or real mode.
 */
@Injectable()
export class BbpsService {
  private readonly logger = new Logger(BbpsService.name);

  async fetchBill(input: BbpsFetchInput): Promise<PresentedBill> {
    if (!BBPS_ENABLED) {
      return stubFetchBill(input);
    }

    // A later phase wires this branch to a real BBPS-routed biller-fetch
    // call (see the class doc comment). Until then BBPS_ENABLED is always
    // false, so this branch is unreachable in practice.
    this.logger.warn(`BBPS is enabled but no live gateway is wired yet; falling back to stub for ${input.consumerNumber}`);
    return stubFetchBill(input);
  }
}
