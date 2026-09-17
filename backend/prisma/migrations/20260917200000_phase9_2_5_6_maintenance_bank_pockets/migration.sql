-- CreateEnum
CREATE TYPE "MaintenanceChargeStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "InstalmentPlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BankStatementLineStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'ALLOCATED', 'IGNORED');

-- CreateEnum
CREATE TYPE "PocketTransferStatus" AS ENUM ('PENDING', 'EXECUTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "maintenance_charges" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "lateFeeAccrued" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "MaintenanceChargeStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instalment_plans" (
    "id" TEXT NOT NULL,
    "maintenanceChargeId" TEXT NOT NULL,
    "instalments" INTEGER NOT NULL,
    "instalmentAmount" DECIMAL(10,2) NOT NULL,
    "status" "InstalmentPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instalment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "valueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "narration" TEXT NOT NULL,
    "reference" TEXT,
    "matchedFlatId" TEXT,
    "status" "BankStatementLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "allocatedById" TEXT,
    "allocatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pocket_transfers" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "fromKind" "AccountKind" NOT NULL,
    "toKind" "AccountKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "note" TEXT,
    "status" "PocketTransferStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pocket_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pocket_transfer_authorisations" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "authoriserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pocket_transfer_authorisations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_charges_societyId_idx" ON "maintenance_charges"("societyId");

-- CreateIndex
CREATE INDEX "maintenance_charges_status_idx" ON "maintenance_charges"("status");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_charges_flatId_period_key" ON "maintenance_charges"("flatId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "instalment_plans_maintenanceChargeId_key" ON "instalment_plans"("maintenanceChargeId");

-- CreateIndex
CREATE INDEX "bank_statement_lines_societyId_idx" ON "bank_statement_lines"("societyId");

-- CreateIndex
CREATE INDEX "bank_statement_lines_status_idx" ON "bank_statement_lines"("status");

-- CreateIndex
CREATE INDEX "pocket_transfers_societyId_idx" ON "pocket_transfers"("societyId");

-- CreateIndex
CREATE UNIQUE INDEX "pocket_transfer_authorisations_transferId_authoriserId_key" ON "pocket_transfer_authorisations"("transferId", "authoriserId");

-- AddForeignKey
ALTER TABLE "maintenance_charges" ADD CONSTRAINT "maintenance_charges_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_charges" ADD CONSTRAINT "maintenance_charges_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instalment_plans" ADD CONSTRAINT "instalment_plans_maintenanceChargeId_fkey" FOREIGN KEY ("maintenanceChargeId") REFERENCES "maintenance_charges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_matchedFlatId_fkey" FOREIGN KEY ("matchedFlatId") REFERENCES "flats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pocket_transfers" ADD CONSTRAINT "pocket_transfers_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pocket_transfer_authorisations" ADD CONSTRAINT "pocket_transfer_authorisations_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "pocket_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

