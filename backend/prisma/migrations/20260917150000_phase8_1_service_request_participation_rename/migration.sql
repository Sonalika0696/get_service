-- Phase 8.1 (BACKEND_PLAN.md Phase 8 item 1): rename the Poll pooling
-- primitive to ServiceRequest/Participation. This is a MONEY-CONNECTED
-- table (Commitment.pollId funds escrow via Flow B) — hand-edited from
-- `prisma migrate diff` output, which proposed a destructive
-- drop-everything-and-recreate script, into pure RENAMEs so every existing
-- Poll/PollCommitment/Commitment row survives with the same id and the same
-- FK graph. No enum VALUES change (only the enum TYPE names), no data is
-- dropped, and Commitment/Booking rows sourced from a fired Flow B poll keep
-- pointing at the exact same (renamed) ServiceRequest row.
--
-- The one genuinely new thing here is Participation.flatId (Phase 8 keys
-- participation by flat): added nullable, backfilled from the resident's
-- occupancy as of their join time (falling back to ANY occupancy of theirs
-- if none covers that exact instant), then guarded and made NOT NULL —
-- refusing to run rather than guessing if any row is unresolvable, matching
-- this repo's established migration ethos (see
-- 20260916150000_v2_remove_voting_lending_commission).

-- ---------------------------------------------------------------------------
-- 1. Rename tables (polls -> service_requests, poll_commitments -> participations)
--    plus their primary-key constraints and non-FK indexes, so the DB's
--    naming converges on exactly what `prisma migrate diff` generates for
--    the new schema from scratch (required for `prisma migrate status` to
--    report no drift afterwards).
-- ---------------------------------------------------------------------------
ALTER TABLE "polls" RENAME TO "service_requests";
ALTER TABLE "service_requests" RENAME CONSTRAINT "polls_pkey" TO "service_requests_pkey";
ALTER INDEX "polls_societyId_status_idx" RENAME TO "service_requests_societyId_status_idx";
ALTER INDEX "polls_closesAt_idx" RENAME TO "service_requests_closesAt_idx";
ALTER INDEX "polls_taggedVendorId_idx" RENAME TO "service_requests_taggedVendorId_idx";

ALTER TABLE "poll_commitments" RENAME TO "participations";
ALTER TABLE "participations" RENAME CONSTRAINT "poll_commitments_pkey" TO "participations_pkey";

-- ---------------------------------------------------------------------------
-- 2. Rename the FK columns that pointed at "polls" (Commitment.pollId and
--    PollCommitment/Participation's own pollId) to serviceRequestId, plus
--    their indexes/constraints.
-- ---------------------------------------------------------------------------
ALTER TABLE "participations" RENAME COLUMN "pollId" TO "serviceRequestId";
ALTER INDEX "poll_commitments_pollId_residentId_key" RENAME TO "participations_serviceRequestId_residentId_key";
ALTER TABLE "participations" RENAME CONSTRAINT "poll_commitments_pollId_fkey" TO "participations_serviceRequestId_fkey";
ALTER TABLE "participations" RENAME CONSTRAINT "poll_commitments_residentId_fkey" TO "participations_residentId_fkey";

ALTER TABLE "commitments" RENAME COLUMN "pollId" TO "serviceRequestId";
ALTER INDEX "commitments_pollId_idx" RENAME TO "commitments_serviceRequestId_idx";
ALTER INDEX "commitments_pollId_residentId_key" RENAME TO "commitments_serviceRequestId_residentId_key";
ALTER TABLE "commitments" RENAME CONSTRAINT "commitments_pollId_fkey" TO "commitments_serviceRequestId_fkey";

-- Renamed here (after the above) so the constraint attaches under its
-- new-convention name on "service_requests" rather than "polls".
ALTER TABLE "service_requests" RENAME CONSTRAINT "polls_societyId_fkey" TO "service_requests_societyId_fkey";
ALTER TABLE "service_requests" RENAME CONSTRAINT "polls_creatorId_fkey" TO "service_requests_creatorId_fkey";
ALTER TABLE "service_requests" RENAME CONSTRAINT "polls_taggedVendorId_fkey" TO "service_requests_taggedVendorId_fkey";

-- ---------------------------------------------------------------------------
-- 3. Rename the enum TYPES. Values are byte-for-byte identical
--    (OPEN/FIRED/EXPIRED/CLOSED/CANCELLED and EVENT/BULK_BUY_RESIDENT) —
--    a plain `ALTER TYPE ... RENAME TO ...` preserves the type's OID, so
--    every column/row using it (service_requests.status/pollType) is
--    unaffected; no USING-cast dance needed since (unlike the V2.0 scope
--    migration) no VALUE is being added or removed here.
-- ---------------------------------------------------------------------------
ALTER TYPE "PollType" RENAME TO "ServiceRequestType";
ALTER TYPE "PollStatus" RENAME TO "ServiceRequestStatus";

-- ---------------------------------------------------------------------------
-- 4. Participation.flatId — new in Phase 8.1 (additive only). Added
--    nullable, backfilled, guarded, then locked to NOT NULL + FK.
-- ---------------------------------------------------------------------------
ALTER TABLE "participations" ADD COLUMN "flatId" TEXT;

-- Primary backfill: the resident's occupancy that was active (by tenure) at
-- the instant they joined — the historically-correct flat for that
-- Participation row.
UPDATE "participations" p
SET "flatId" = (
  SELECT o."flatId"
  FROM "occupancies" o
  WHERE o."userId" = p."residentId"
    AND o."tenureStartedAt" <= p."createdAt"
    AND (o."tenureEndedAt" IS NULL OR o."tenureEndedAt" >= p."createdAt")
  ORDER BY o."tenureStartedAt" ASC
  LIMIT 1
)
WHERE p."flatId" IS NULL;

-- Fallback: a resident whose occupancy history doesn't cover their join
-- instant (e.g. tenure dates edited after the fact) gets their earliest
-- occupancy of any kind, rather than being left unresolved.
UPDATE "participations" p
SET "flatId" = (
  SELECT o."flatId"
  FROM "occupancies" o
  WHERE o."userId" = p."residentId"
  ORDER BY o."tenureStartedAt" ASC
  LIMIT 1
)
WHERE p."flatId" IS NULL;

-- Guard: refuse rather than guess if a resident has zero occupancies ever
-- (so their Participation row has no possible flat to backfill).
DO $$
DECLARE
  orphaned_participations integer;
BEGIN
  SELECT count(*) INTO orphaned_participations FROM "participations" WHERE "flatId" IS NULL;
  IF orphaned_participations > 0 THEN
    RAISE EXCEPTION 'Phase 8.1 migration refused: % participation row(s) have no resolvable flatId (the joining resident has zero occupancies, ever). Backfill or remove these rows deliberately before requiring flatId.', orphaned_participations;
  END IF;
END $$;

ALTER TABLE "participations" ALTER COLUMN "flatId" SET NOT NULL;
ALTER TABLE "participations" ADD CONSTRAINT "participations_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Booking.sourceType is a loose, unFK'd pointer (see Booking's schema.prisma
--    doc comment) — existing Flow B rows recorded 'POLL'; the code that
--    writes it now writes 'SERVICE_REQUEST', so update history to match.
-- ---------------------------------------------------------------------------
UPDATE "bookings" SET "sourceType" = 'SERVICE_REQUEST' WHERE "sourceType" = 'POLL';
