-- CreateEnum
CREATE TYPE "SocietyStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RatificationStatus" AS ENUM ('PENDING', 'RATIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DelegationScope" AS ENUM ('SERVICE_REQUESTS', 'EVENT_OPT_IN', 'JOB_BLOG_POSTING', 'VENDOR_DIRECTORY_ACCESS');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('CONTACT_INFO');

-- AlterTable
ALTER TABLE "societies" ADD COLUMN     "status" "SocietyStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "occupancies" ADD COLUMN     "ratificationDecidedAt" TIMESTAMP(3),
ADD COLUMN     "ratificationNote" TEXT,
ADD COLUMN     "ratificationStatus" "RatificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "ratifiedByUserId" TEXT;

-- CreateTable
CREATE TABLE "delegations" (
    "id" TEXT NOT NULL,
    "occupancyId" TEXT NOT NULL,
    "delegateUserId" TEXT NOT NULL,
    "scope" "DelegationScope" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "granteeUserId" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delegations_delegateUserId_idx" ON "delegations"("delegateUserId");

-- CreateIndex
CREATE UNIQUE INDEX "delegations_occupancyId_delegateUserId_scope_key" ON "delegations"("occupancyId", "delegateUserId", "scope");

-- CreateIndex
CREATE INDEX "consent_grants_granteeUserId_idx" ON "consent_grants"("granteeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "consent_grants_userId_granteeUserId_purpose_key" ON "consent_grants"("userId", "granteeUserId", "purpose");

-- CreateIndex
CREATE INDEX "occupancies_ratificationStatus_idx" ON "occupancies"("ratificationStatus");

-- AddForeignKey
ALTER TABLE "occupancies" ADD CONSTRAINT "occupancies_ratifiedByUserId_fkey" FOREIGN KEY ("ratifiedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_occupancyId_fkey" FOREIGN KEY ("occupancyId") REFERENCES "occupancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_delegateUserId_fkey" FOREIGN KEY ("delegateUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_grants" ADD CONSTRAINT "consent_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_grants" ADD CONSTRAINT "consent_grants_granteeUserId_fkey" FOREIGN KEY ("granteeUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

