/**
 * Query params of GET /water-sources. Plain interface, not a class-validator
 * DTO — like TariffModule's ListTariffsQuery, read individually via
 * `@Query('x')` in the controller and validated by hand (see that file's
 * doc comment for why: whitelist/forbidNonWhitelisted on the global
 * ValidationPipe makes whole-object `@Query()` binding awkward for optional
 * filters).
 */
export interface ListWaterSourcesQuery {
  /** 'YYYY-MM'. */
  period?: string;
  billingCycleId?: string;
}
