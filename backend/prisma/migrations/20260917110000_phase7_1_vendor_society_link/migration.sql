-- Phase 7.1 (BACKEND_PLAN.md Phase 7 item 1; DECISIONS_V2_SCOPE.md §7.6):
-- split Vendor (global identity) from VendorSocietyLink (per-society
-- membership). Vendor.societyId is retired; every existing vendor<->society
-- relationship is preserved by copying it into a new VendorSocietyLink row
-- BEFORE the column is dropped, so no data is lost.
--
-- Ordering is deliberate and load-bearing:
--   1. create vendor_society_links (empty)
--   2. COPY every existing (vendor.id, vendor.societyId) pair into it —
--      one link per pre-existing vendor, since every vendor had exactly one
--      society before this migration
--   3. add the unique/index/FK constraints on the now-populated table
--   4. ONLY THEN drop vendors.societyId (and its FK/index)
--
-- Offer/Booking/VendorRating/VendorAccessRequest all key on vendorId
-- (unchanged by this migration) — they are untouched, so no money/history
-- is affected by this change.

-- CreateTable
CREATE TABLE "vendor_society_links" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_society_links_pkey" PRIMARY KEY ("id")
);

-- DataMigration: one VendorSocietyLink per existing vendor, preserving its
-- current societyId and using the vendor's own createdAt as the link's
-- createdAt (the vendor has "belonged" to that society since it was
-- created). Ids are generated with md5(random()||clock_timestamp()) rather
-- than Prisma's cuid() (a client-side algorithm, not available in raw SQL) —
-- collision-safe at this scale and never read back by application code as
-- anything but an opaque id.
INSERT INTO "vendor_society_links" ("id", "vendorId", "societyId", "createdAt")
SELECT
    md5(random()::text || clock_timestamp()::text || "id"),
    "id",
    "societyId",
    "createdAt"
FROM "vendors";

-- CreateIndex
CREATE INDEX "vendor_society_links_societyId_idx" ON "vendor_society_links"("societyId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_society_links_vendorId_societyId_key" ON "vendor_society_links"("vendorId", "societyId");

-- AddForeignKey
ALTER TABLE "vendor_society_links" ADD CONSTRAINT "vendor_society_links_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_society_links" ADD CONSTRAINT "vendor_society_links_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey (only now that every vendor's society membership is
-- preserved in vendor_society_links)
ALTER TABLE "vendors" DROP CONSTRAINT "vendors_societyId_fkey";

-- DropIndex
DROP INDEX "vendors_societyId_idx";

-- AlterTable
ALTER TABLE "vendors" DROP COLUMN "societyId";
