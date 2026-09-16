-- Phase 6.4 (BACKEND_PLAN.md Phase 6.4, M14) — approval-ladder rework.
--
-- PayoutAuthorisation/MilestoneAuthorisation move from a `kind` (SYSTEM |
-- TREASURER) discriminator with `@@unique([payoutId, kind])` to a
-- DISTINCT-AUTHORISER model keyed `@@unique([payoutId, authoriserId])` (resp.
-- milestoneId) — see schema.prisma's doc comments on both models. The old
-- SYSTEM row (authoriserId always NULL, one per Payout/Milestone) no longer
-- represents anything countable under the new N-officer ladder, so this
-- migration deletes any such row before making authoriserId NOT NULL. This
-- IS destructive to those specific rows (never to a real TREASURER/officer
-- row, which always had authoriserId set) — deliberate, and safe: a SYSTEM
-- row was never anything but an internal bookkeeping marker for the
-- automated rule-check, never itself money-moving, and every Payout/
-- Milestone that has already been PAID keeps its PAID status and its real
-- ledger postings untouched (this migration only touches the
-- *Authorisation tables, never Payout/Milestone/LedgerEntry).

-- DropIndex
DROP INDEX "milestone_authorisations_milestoneId_kind_key";

-- DropIndex
DROP INDEX "payout_authorisations_payoutId_kind_key";

-- Data safety: remove the old automated SYSTEM marker rows (authoriserId
-- IS NULL) before authoriserId is made NOT NULL below. A row with
-- authoriserId set (every real officer authorisation, on any environment,
-- past or present) is never touched by this DELETE.
DELETE FROM "milestone_authorisations" WHERE "authoriserId" IS NULL;
DELETE FROM "payout_authorisations" WHERE "authoriserId" IS NULL;

-- AlterTable
ALTER TABLE "milestone_authorisations" DROP COLUMN "kind",
ALTER COLUMN "authoriserId" SET NOT NULL;

-- AlterTable
ALTER TABLE "payout_authorisations" DROP COLUMN "kind",
ALTER COLUMN "authoriserId" SET NOT NULL;

-- DropEnum
DROP TYPE "PayoutAuthKind";

-- CreateIndex
CREATE UNIQUE INDEX "milestone_authorisations_milestoneId_authoriserId_key" ON "milestone_authorisations"("milestoneId", "authoriserId");

-- CreateIndex
CREATE UNIQUE INDEX "payout_authorisations_payoutId_authoriserId_key" ON "payout_authorisations"("payoutId", "authoriserId");
