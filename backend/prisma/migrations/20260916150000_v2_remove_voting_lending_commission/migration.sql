-- V2.0 scope revision (DECISIONS_V2_SCOPE.md §2, §6.4; SDD invariants I2, I8).
-- Removes resident voting, the lending/voucher account kinds, and platform
-- commission.
--
-- Hand-edited from `prisma migrate diff` output in two ways:
--   1. Guards: this migration refuses to run, with an explicit message,
--      rather than silently destroy financial history or voting records.
--      The ledger is append-only; a schema migration must never be the thing
--      that deletes entries from it.
--   2. Booking."commissionTaken" is RENAMED to "retentionSetAside", not
--      dropped and re-added. The flag still marks the once-only retention
--      set-aside on LARGE bookings; resetting it to false would make the next
--      milestone authorisation set retention aside a second time.

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  blocked_entries  integer;
  blocked_balances integer;
  voting_polls     integer;
  vote_rows        integer;
  commission_rows  integer;
BEGIN
  SELECT count(*) INTO blocked_entries
  FROM "ledger_entries" le
  JOIN "accounts" a ON a."id" IN (le."debitAccountId", le."creditAccountId")
  WHERE a."kind"::text IN ('VOUCHER', 'LENDING_SIM', 'COMMISSION_SINK');

  SELECT count(*) INTO blocked_balances
  FROM "accounts"
  WHERE "kind"::text IN ('VOUCHER', 'LENDING_SIM', 'COMMISSION_SINK') AND "balance" <> 0;

  IF blocked_entries > 0 OR blocked_balances > 0 THEN
    RAISE EXCEPTION 'V2.0 migration refused: % ledger entries and % non-zero balances reference VOUCHER/LENDING_SIM/COMMISSION_SINK accounts. The ledger is append-only; reverse or migrate these postings deliberately before removing the account kinds.', blocked_entries, blocked_balances;
  END IF;

  SELECT count(*) INTO commission_rows FROM "payouts" WHERE "commission" <> 0;
  IF commission_rows > 0 THEN
    RAISE EXCEPTION 'V2.0 migration refused: % payouts recorded a non-zero platform commission. Preserve that history deliberately before dropping payouts.commission.', commission_rows;
  END IF;

  SELECT count(*) INTO voting_polls FROM "polls" WHERE "pollType"::text IN ('ADVISORY', 'BINDING') OR "status"::text IN ('PASSED', 'FAILED');
  SELECT count(*) INTO vote_rows FROM "votes";
  IF voting_polls > 0 OR vote_rows > 0 THEN
    RAISE EXCEPTION 'V2.0 migration refused: % voting polls and % votes exist. Resident voting is withdrawn (SDD invariant I8); archive or delete these deliberately first.', voting_polls, vote_rows;
  END IF;
END $$;

-- Removed-kind accounts that never held money (zero balance, no entries —
-- guaranteed by the guard above) are safe to delete before the enum cast.
DELETE FROM "accounts" WHERE "kind"::text IN ('VOUCHER', 'LENDING_SIM', 'COMMISSION_SINK');

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- AlterEnum
BEGIN;
CREATE TYPE "AccountKind_new" AS ENUM ('SOCIETY_MASTER', 'BULK_BUY', 'DISPUTE', 'EXTERNAL', 'VENDOR', 'RETENTION');
ALTER TABLE "accounts" ALTER COLUMN "kind" TYPE "AccountKind_new" USING ("kind"::text::"AccountKind_new");
ALTER TYPE "AccountKind" RENAME TO "AccountKind_old";
ALTER TYPE "AccountKind_new" RENAME TO "AccountKind";
DROP TYPE "public"."AccountKind_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PollStatus_new" AS ENUM ('OPEN', 'FIRED', 'EXPIRED', 'CLOSED', 'CANCELLED');
ALTER TABLE "public"."polls" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "polls" ALTER COLUMN "status" TYPE "PollStatus_new" USING ("status"::text::"PollStatus_new");
ALTER TYPE "PollStatus" RENAME TO "PollStatus_old";
ALTER TYPE "PollStatus_new" RENAME TO "PollStatus";
DROP TYPE "public"."PollStatus_old";
ALTER TABLE "polls" ALTER COLUMN "status" SET DEFAULT 'OPEN';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PollType_new" AS ENUM ('EVENT', 'BULK_BUY_RESIDENT');
ALTER TABLE "polls" ALTER COLUMN "pollType" TYPE "PollType_new" USING ("pollType"::text::"PollType_new");
ALTER TYPE "PollType" RENAME TO "PollType_old";
ALTER TYPE "PollType_new" RENAME TO "PollType";
DROP TYPE "public"."PollType_old";
COMMIT;

-- ---------------------------------------------------------------------------
-- Tables and columns
-- ---------------------------------------------------------------------------

-- DropForeignKey
ALTER TABLE "votes" DROP CONSTRAINT "votes_pollId_fkey";

-- RenameColumn (preserves the once-only retention set-aside flag)
ALTER TABLE "bookings" RENAME COLUMN "commissionTaken" TO "retentionSetAside";

-- AlterTable
ALTER TABLE "flats" DROP COLUMN "ownershipShare";

-- AlterTable
ALTER TABLE "payouts" DROP COLUMN "commission",
DROP COLUMN "vendorNet";

-- AlterTable
ALTER TABLE "polls" DROP COLUMN "passingPct",
DROP COLUMN "quorumPct",
DROP COLUMN "resolvedAt",
DROP COLUMN "weightMode";

-- DropTable
DROP TABLE "votes";

-- DropEnum
DROP TYPE "PollWeightMode";

-- DropEnum
DROP TYPE "VoteChoice";
