-- Phase 6.2 identity (BACKEND_PLAN.md Phase 6; DECISIONS_V2_SCOPE.md §7).
-- Purely additive: one new enum, six new nullable-or-defaulted columns on
-- "users", one new unique index, one new FK. No existing column is altered
-- or dropped and no row is rewritten in a way that could lose data, so this
-- carries none of the destructive-guard machinery the previous
-- (20260916150000_v2_remove_voting_lending_commission) migration needed.
--
-- "principalKind" defaults to RESIDENT so every pre-6.2 row (and Prisma's
-- NOT NULL requirement) is satisfied with no backfill step. VENDOR/OPERATOR
-- rows are provisioned directly (see OfficerAuthService) with an explicit
-- principalKind and their own passwordHash/totpSecret/totpEnabledAt instead.

-- CreateEnum
CREATE TYPE "PrincipalKind" AS ENUM ('RESIDENT', 'VENDOR', 'OPERATOR');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "principalKind" "PrincipalKind" NOT NULL DEFAULT 'RESIDENT',
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpSecret" TEXT,
ADD COLUMN     "vendorId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_vendorId_key" ON "users"("vendorId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

