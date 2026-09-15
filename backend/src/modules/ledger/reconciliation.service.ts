import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AccountKind } from '../../generated/prisma/enums.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

export interface ReconciliationReport {
  date: string;
  ledgerEntryCount: number;
  /**
   * The day's net change to the EXTERNAL account's own balance — the
   * PSP/bank boundary (see schema.prisma's Ledger doc comment). Debiting
   * EXTERNAL (money entering the closed set) makes this more negative;
   * crediting it (money leaving) makes this more positive — same sign
   * convention as every other account's balance.
   */
  ledgerNetExternal: string;
  /** Always empty in Phase 4A — there's no PSP settlement feed to compare against yet. */
  settlementRows: never[];
  matched: never[];
  unmatched: never[];
  note: string;
}

/**
 * STUB — Phase 4A has no Razorpay/PSP integration yet, so there is nothing
 * to reconcile the ledger *against*. This exists so the shape of the report
 * (and the TREASURER-only route) is settled now; Phase 4B wires in a real
 * settlement-file/API source and fills in settlementRows/matched/unmatched.
 * No network calls happen here.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async run(societyId: string, date?: string): Promise<ReconciliationReport> {
    const day = date ? new Date(date) : this.clock.now();
    if (Number.isNaN(day.getTime())) {
      throw new BadRequestException('date must be a valid date (e.g. YYYY-MM-DD)');
    }

    const startOfDay = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const externalAccount = await this.prisma.account.findUnique({ where: { societyId_kind: { societyId, kind: AccountKind.EXTERNAL } } });

    const entries = await this.prisma.ledgerEntry.findMany({
      where: { societyId, ts: { gte: startOfDay, lt: endOfDay } },
      select: { debitAccountId: true, creditAccountId: true, amount: true },
    });

    let ledgerNetExternal = new Decimal(0);
    if (externalAccount) {
      for (const entry of entries) {
        if (entry.creditAccountId === externalAccount.id) ledgerNetExternal = ledgerNetExternal.plus(entry.amount);
        if (entry.debitAccountId === externalAccount.id) ledgerNetExternal = ledgerNetExternal.minus(entry.amount);
      }
    }

    return {
      date: startOfDay.toISOString().slice(0, 10),
      ledgerEntryCount: entries.length,
      ledgerNetExternal: ledgerNetExternal.toString(),
      settlementRows: [],
      matched: [],
      unmatched: [],
      note: 'stub — no PSP settlement source until Phase 4B',
    };
  }
}
