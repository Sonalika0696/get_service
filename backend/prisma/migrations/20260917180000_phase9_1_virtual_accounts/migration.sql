-- CreateEnum
CREATE TYPE "VirtualAccountStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountKind" ADD VALUE 'MAINTENANCE';
ALTER TYPE "AccountKind" ADD VALUE 'ELECTRICITY';
ALTER TYPE "AccountKind" ADD VALUE 'WATER';
ALTER TYPE "AccountKind" ADD VALUE 'EVENTS';
ALTER TYPE "AccountKind" ADD VALUE 'WELFARE';
ALTER TYPE "AccountKind" ADD VALUE 'SINKING';
ALTER TYPE "AccountKind" ADD VALUE 'CORPUS';

-- CreateTable
CREATE TABLE "virtual_accounts" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "VirtualAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "virtual_accounts_flatId_key" ON "virtual_accounts"("flatId");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_accounts_code_key" ON "virtual_accounts"("code");

-- CreateIndex
CREATE INDEX "virtual_accounts_societyId_idx" ON "virtual_accounts"("societyId");

-- AddForeignKey
ALTER TABLE "virtual_accounts" ADD CONSTRAINT "virtual_accounts_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_accounts" ADD CONSTRAINT "virtual_accounts_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

