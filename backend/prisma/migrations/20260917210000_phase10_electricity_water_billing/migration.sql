-- Phase 10 — Electricity & water billing (BACKEND_PLAN.md Phase 10, M5/M6).
-- Fully additive: new enums, new tables, one new nullable column on flats.
-- No destructive operations, so no guard block is required.

-- CreateEnum
CREATE TYPE "Utility" AS ENUM ('ELECTRICITY', 'WATER');
CREATE TYPE "MeterKind" AS ENUM ('FLAT', 'COMMON', 'BULK');
CREATE TYPE "MeterStatus" AS ENUM ('ACTIVE', 'RETIRED', 'FLAGGED');
CREATE TYPE "ReadingSource" AS ENUM ('MANUAL', 'CSV');
CREATE TYPE "BillingStage" AS ENUM ('OPEN', 'READINGS_CLOSED', 'VALIDATED', 'COMPUTED', 'APPORTIONED', 'RECONCILED', 'PUBLISHED', 'SETTLED');
CREATE TYPE "BillingCycleStatus" AS ENUM ('RUNNING', 'HALTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "FlatBillStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'WAIVED');
CREATE TYPE "BillBasis" AS ENUM ('METERED', 'FALLBACK');
CREATE TYPE "WaterSourceKind" AS ENUM ('MUNICIPAL', 'TANKER', 'BOREWELL');
CREATE TYPE "MeterAnomalyKind" AS ENUM ('NEGATIVE_CONSUMPTION', 'STALLED', 'ROLLOVER', 'OUT_OF_BOUNDS');

-- AlterTable
ALTER TABLE "flats" ADD COLUMN "carpetAreaSqft" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "meters" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "flatId" TEXT,
    "utility" "Utility" NOT NULL,
    "kind" "MeterKind" NOT NULL,
    "serial" TEXT NOT NULL,
    "multiplier" DECIMAL(10,4) NOT NULL DEFAULT 1,
    "consumerNumber" TEXT,
    "status" "MeterStatus" NOT NULL DEFAULT 'ACTIVE',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "readings" (
    "id" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "value" DECIMAL(14,3) NOT NULL,
    "consumption" DECIMAL(14,3),
    "billingCycleId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedById" TEXT NOT NULL,
    "source" "ReadingSource" NOT NULL DEFAULT 'MANUAL',
    "reversesReadingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_schedules" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "utility" "Utility" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "slabs" JSONB NOT NULL DEFAULT '[]',
    "fixedCharges" JSONB NOT NULL DEFAULT '{}',
    "dutyCess" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "tariff_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_cycles" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "utility" "Utility" NOT NULL,
    "period" TEXT NOT NULL,
    "stage" "BillingStage" NOT NULL DEFAULT 'OPEN',
    "status" "BillingCycleStatus" NOT NULL DEFAULT 'RUNNING',
    "tariffScheduleId" TEXT,
    "bulkInvoiceAmount" DECIMAL(14,2),
    "bulkConsumption" DECIMAL(14,3),
    "variance" DECIMAL(14,2),
    "haltedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flat_bills" (
    "id" TEXT NOT NULL,
    "billingCycleId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "consumption" DECIMAL(14,3),
    "amount" DECIMAL(12,2) NOT NULL,
    "basis" "BillBasis" NOT NULL DEFAULT 'METERED',
    "computationTrace" JSONB NOT NULL DEFAULT '{}',
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "FlatBillStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flat_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "water_sources" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "billingCycleId" TEXT,
    "kind" "WaterSourceKind" NOT NULL,
    "kilolitres" DECIMAL(14,3) NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "period" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "water_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_reading_anomalies" (
    "id" TEXT NOT NULL,
    "billingCycleId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "kind" "MeterAnomalyKind" NOT NULL,
    "detail" TEXT NOT NULL,
    "readingId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_reading_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meters_societyId_serial_key" ON "meters"("societyId", "serial");
CREATE INDEX "meters_societyId_utility_idx" ON "meters"("societyId", "utility");
CREATE INDEX "meters_flatId_idx" ON "meters"("flatId");

CREATE INDEX "readings_meterId_capturedAt_idx" ON "readings"("meterId", "capturedAt");
CREATE INDEX "readings_billingCycleId_idx" ON "readings"("billingCycleId");

CREATE INDEX "tariff_schedules_societyId_utility_effectiveFrom_idx" ON "tariff_schedules"("societyId", "utility", "effectiveFrom");

CREATE UNIQUE INDEX "billing_cycles_societyId_utility_period_key" ON "billing_cycles"("societyId", "utility", "period");
CREATE INDEX "billing_cycles_societyId_status_idx" ON "billing_cycles"("societyId", "status");

CREATE UNIQUE INDEX "flat_bills_billingCycleId_flatId_key" ON "flat_bills"("billingCycleId", "flatId");
CREATE INDEX "flat_bills_societyId_status_idx" ON "flat_bills"("societyId", "status");
CREATE INDEX "flat_bills_flatId_idx" ON "flat_bills"("flatId");

CREATE INDEX "water_sources_societyId_period_idx" ON "water_sources"("societyId", "period");
CREATE INDEX "water_sources_billingCycleId_idx" ON "water_sources"("billingCycleId");

CREATE INDEX "meter_reading_anomalies_billingCycleId_idx" ON "meter_reading_anomalies"("billingCycleId");
CREATE INDEX "meter_reading_anomalies_meterId_idx" ON "meter_reading_anomalies"("meterId");

-- AddForeignKey
ALTER TABLE "meters" ADD CONSTRAINT "meters_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meters" ADD CONSTRAINT "meters_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "readings" ADD CONSTRAINT "readings_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "meters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "readings" ADD CONSTRAINT "readings_billingCycleId_fkey" FOREIGN KEY ("billingCycleId") REFERENCES "billing_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "readings" ADD CONSTRAINT "readings_reversesReadingId_fkey" FOREIGN KEY ("reversesReadingId") REFERENCES "readings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tariff_schedules" ADD CONSTRAINT "tariff_schedules_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_cycles" ADD CONSTRAINT "billing_cycles_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_cycles" ADD CONSTRAINT "billing_cycles_tariffScheduleId_fkey" FOREIGN KEY ("tariffScheduleId") REFERENCES "tariff_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "flat_bills" ADD CONSTRAINT "flat_bills_billingCycleId_fkey" FOREIGN KEY ("billingCycleId") REFERENCES "billing_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "flat_bills" ADD CONSTRAINT "flat_bills_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "flat_bills" ADD CONSTRAINT "flat_bills_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "water_sources" ADD CONSTRAINT "water_sources_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "water_sources" ADD CONSTRAINT "water_sources_billingCycleId_fkey" FOREIGN KEY ("billingCycleId") REFERENCES "billing_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "meter_reading_anomalies" ADD CONSTRAINT "meter_reading_anomalies_billingCycleId_fkey" FOREIGN KEY ("billingCycleId") REFERENCES "billing_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meter_reading_anomalies" ADD CONSTRAINT "meter_reading_anomalies_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "meters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
