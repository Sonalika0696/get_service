import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { POCKET_KINDS, type PocketKind } from '../pocket-kinds.js';

/**
 * Body of POST /bank-statements/lines/:id/allocate — the ONLY input that
 * ever causes this module to post to the ledger (see
 * BankStatementsService.allocate's doc comment).
 *
 * `flatId` is optional: when omitted, the line's own `matchedFlatId` (set by
 * ingestCsv's substring match, or still null when unmatched) is used as-is —
 * a treasurer allocating an UNMATCHED line without supplying `flatId` is
 * doing a deliberate society-level allocation (e.g. an interest credit or a
 * refund with no single flat to attribute), not an error. When `flatId` IS
 * supplied, it always overrides whatever `matchedFlatId` currently holds
 * (the treasurer's explicit say-so beats the substring guess) and is
 * persisted back onto the line.
 */
export class AllocateBankStatementLineDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  flatId?: string;

  @IsIn(POCKET_KINDS)
  pocketKind!: PocketKind;
}
