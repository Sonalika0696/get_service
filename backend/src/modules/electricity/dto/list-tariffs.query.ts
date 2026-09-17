import type { Utility } from '../../../generated/prisma/enums.js';

/**
 * Query params of GET /tariffs and GET /tariffs/current. Plain interfaces,
 * not class-validator DTOs — like BankStatementsService's
 * ListBankStatementLinesParams, query params here are read individually via
 * `@Query('x')` in the controller (whitelist/forbidNonWhitelisted on the
 * global ValidationPipe makes whole-object `@Query()` binding awkward for
 * optional filters) and validated by hand before being passed down.
 */
export interface ListTariffsQuery {
  utility?: Utility;
}

/** Query params of GET /tariffs/current — both required. */
export interface CurrentTariffQuery {
  utility: Utility;
  /** 'YYYY-MM'. */
  period: string;
}
