-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED', 'COMPLETED', 'SETTLED');

-- CreateEnum
CREATE TYPE "EventSurplusPolicy" AS ENUM ('WELFARE_FUND', 'PRO_RATA_REFUND');

-- CreateEnum
CREATE TYPE "EventRegistrationStatus" AS ENUM ('CONFIRMED', 'WAITLISTED', 'WITHDRAWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventSettlementStatus" AS ENUM ('PENDING', 'EXECUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChargeSheetStatus" AS ENUM ('SUBMITTED', 'ACKNOWLEDGED', 'DISPUTED', 'RESOLVED', 'SETTLED');

-- CreateEnum
CREATE TYPE "ChargeLineVariance" AS ENUM ('IN_CARD', 'ABOVE_CARD_RATE', 'NOT_ON_CARD');

-- CreateEnum
CREATE TYPE "ChargeSheetAckDecision" AS ENUM ('ACKNOWLEDGED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "DisputeCategory" AS ENUM ('OUT_OF_CARD_CHARGE', 'RATE_ABOVE_CARD', 'WORK_NOT_DONE', 'QUALITY', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeTriagePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UPHELD', 'PARTIALLY_UPHELD', 'REJECTED');

-- CreateEnum
CREATE TYPE "FixedDepositStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'MATURED', 'WITHDRAWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FixedDepositAction" AS ENUM ('PLACE', 'WITHDRAW');

-- CreateEnum
CREATE TYPE "HealthCampStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CampRegistrationStatus" AS ENUM ('REGISTERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DonationMode" AS ENUM ('INTERNAL_WELFARE', 'EXTERNAL_PASS_THROUGH');

-- CreateEnum
CREATE TYPE "DonationCampaignStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "DonationContributionStatus" AS ENUM ('PENDING', 'RECEIVED', 'RECORDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WelfareDisbursementStatus" AS ENUM ('PENDING', 'EXECUTED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountKind" ADD VALUE 'FIXED_DEPOSIT';
ALTER TYPE "AccountKind" ADD VALUE 'INTEREST_INCOME';

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT NOT NULL,
    "venue" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "registrationOpensAt" TIMESTAMP(3) NOT NULL,
    "registrationClosesAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER,
    "minRegistrations" INTEGER,
    "chargePerFlat" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "concessions" JSONB,
    "refundOnCancelPct" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "refundOnWithdrawalPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "withdrawalDeadline" TIMESTAMP(3),
    "surplusPolicy" "EventSurplusPolicy" NOT NULL DEFAULT 'WELFARE_FUND',
    "status" "EventStatus" NOT NULL DEFAULT 'OPEN',
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_registrations" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "status" "EventRegistrationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "waitlistPosition" INTEGER,
    "concessionCode" TEXT,
    "amountDue" DECIMAL(10,2) NOT NULL,
    "paidAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "refundedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paymentId" TEXT,
    "promotedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_expenses" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "vendorId" TEXT,
    "payeeName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "invoiceRef" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_settlements" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "totalCollected" DECIMAL(14,2) NOT NULL,
    "totalRefunded" DECIMAL(14,2) NOT NULL,
    "totalExpenses" DECIMAL(14,2) NOT NULL,
    "surplus" DECIMAL(14,2) NOT NULL,
    "surplusPolicy" "EventSurplusPolicy" NOT NULL,
    "status" "EventSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_settlement_authorisations" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "authoriserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_settlement_authorisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_sheets" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "frozenPricingCardId" TEXT,
    "status" "ChargeSheetStatus" NOT NULL DEFAULT 'SUBMITTED',
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "cardTotal" DECIMAL(14,2) NOT NULL,
    "varianceAmount" DECIMAL(14,2) NOT NULL,
    "hasVariance" BOOLEAN NOT NULL DEFAULT false,
    "holdbackAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vendorNote" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charge_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_sheet_lines" (
    "id" TEXT NOT NULL,
    "chargeSheetId" TEXT NOT NULL,
    "pricingLineId" TEXT,
    "label" TEXT NOT NULL,
    "basis" "PricingBasis" NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "cardRate" DECIMAL(10,2),
    "variance" "ChargeLineVariance" NOT NULL,
    "varianceAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "charge_sheet_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_sheet_acknowledgements" (
    "id" TEXT NOT NULL,
    "chargeSheetId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "decision" "ChargeSheetAckDecision" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "charge_sheet_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "chargeSheetId" TEXT NOT NULL,
    "chargeSheetLineId" TEXT,
    "flatId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "category" "DisputeCategory" NOT NULL,
    "reason" TEXT NOT NULL,
    "disputedAmount" DECIMAL(14,2) NOT NULL,
    "triagePriority" "DisputeTriagePriority" NOT NULL,
    "triageReason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "awardedAmount" DECIMAL(14,2),
    "resolution" TEXT,
    "adjudicatedById" TEXT,
    "adjudicatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_deposits" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL,
    "ratePct" DECIMAL(5,2) NOT NULL,
    "tenorDays" INTEGER NOT NULL,
    "status" "FixedDepositStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedBySweep" BOOLEAN NOT NULL DEFAULT false,
    "initiatedById" TEXT NOT NULL,
    "placedAt" TIMESTAMP(3),
    "maturesAt" TIMESTAMP(3),
    "maturityAmount" DECIMAL(14,2),
    "interestEarned" DECIMAL(14,2),
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "renewedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_deposit_authorisations" (
    "id" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "action" "FixedDepositAction" NOT NULL,
    "authoriserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_deposit_authorisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_camps" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "venue" TEXT,
    "campDate" TIMESTAMP(3) NOT NULL,
    "registrationClosesAt" TIMESTAMP(3) NOT NULL,
    "chargePerRegistration" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "HealthCampStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_camps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_camp_slots" (
    "id" TEXT NOT NULL,
    "campId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,

    CONSTRAINT "health_camp_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "camp_registrations" (
    "id" TEXT NOT NULL,
    "campId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "attendeeName" TEXT NOT NULL,
    "status" "CampRegistrationStatus" NOT NULL DEFAULT 'REGISTERED',
    "amountDue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "camp_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donation_campaigns" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "mode" "DonationMode" NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "targetAmount" DECIMAL(14,2),
    "recipientOrgName" TEXT,
    "recipientOrgUrl" TEXT,
    "recipientIssues80G" BOOLEAN NOT NULL DEFAULT false,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3),
    "status" "DonationCampaignStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "donation_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donation_contributions" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "status" "DonationContributionStatus" NOT NULL DEFAULT 'PENDING',
    "paymentId" TEXT,
    "externalReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "donation_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "welfare_disbursements" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "campaignId" TEXT,
    "payeeName" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "WelfareDisbursementStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "welfare_disbursements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "welfare_disbursement_authorisations" (
    "id" TEXT NOT NULL,
    "disbursementId" TEXT NOT NULL,
    "authoriserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "welfare_disbursement_authorisations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "events_societyId_status_idx" ON "events"("societyId", "status");

-- CreateIndex
CREATE INDEX "events_startsAt_idx" ON "events"("startsAt");

-- CreateIndex
CREATE INDEX "event_registrations_eventId_status_idx" ON "event_registrations"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "event_registrations_eventId_flatId_key" ON "event_registrations"("eventId", "flatId");

-- CreateIndex
CREATE INDEX "event_expenses_eventId_idx" ON "event_expenses"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "event_settlements_eventId_key" ON "event_settlements"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "event_settlement_authorisations_settlementId_authoriserId_key" ON "event_settlement_authorisations"("settlementId", "authoriserId");

-- CreateIndex
CREATE UNIQUE INDEX "charge_sheets_bookingId_key" ON "charge_sheets"("bookingId");

-- CreateIndex
CREATE INDEX "charge_sheets_societyId_status_idx" ON "charge_sheets"("societyId", "status");

-- CreateIndex
CREATE INDEX "charge_sheets_vendorId_idx" ON "charge_sheets"("vendorId");

-- CreateIndex
CREATE INDEX "charge_sheet_lines_chargeSheetId_idx" ON "charge_sheet_lines"("chargeSheetId");

-- CreateIndex
CREATE UNIQUE INDEX "charge_sheet_acknowledgements_chargeSheetId_flatId_key" ON "charge_sheet_acknowledgements"("chargeSheetId", "flatId");

-- CreateIndex
CREATE INDEX "disputes_societyId_status_idx" ON "disputes"("societyId", "status");

-- CreateIndex
CREATE INDEX "disputes_chargeSheetId_idx" ON "disputes"("chargeSheetId");

-- CreateIndex
CREATE INDEX "fixed_deposits_societyId_status_idx" ON "fixed_deposits"("societyId", "status");

-- CreateIndex
CREATE INDEX "fixed_deposits_maturesAt_idx" ON "fixed_deposits"("maturesAt");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_deposit_authorisations_depositId_action_authoriserId_key" ON "fixed_deposit_authorisations"("depositId", "action", "authoriserId");

-- CreateIndex
CREATE INDEX "health_camps_societyId_status_idx" ON "health_camps"("societyId", "status");

-- CreateIndex
CREATE INDEX "health_camp_slots_campId_idx" ON "health_camp_slots"("campId");

-- CreateIndex
CREATE INDEX "camp_registrations_slotId_idx" ON "camp_registrations"("slotId");

-- CreateIndex
CREATE UNIQUE INDEX "camp_registrations_campId_flatId_attendeeName_key" ON "camp_registrations"("campId", "flatId", "attendeeName");

-- CreateIndex
CREATE INDEX "donation_campaigns_societyId_status_idx" ON "donation_campaigns"("societyId", "status");

-- CreateIndex
CREATE INDEX "donation_contributions_campaignId_status_idx" ON "donation_contributions"("campaignId", "status");

-- CreateIndex
CREATE INDEX "welfare_disbursements_societyId_status_idx" ON "welfare_disbursements"("societyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "welfare_disbursement_authorisations_disbursementId_authoris_key" ON "welfare_disbursement_authorisations"("disbursementId", "authoriserId");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_expenses" ADD CONSTRAINT "event_expenses_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_settlements" ADD CONSTRAINT "event_settlements_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_settlement_authorisations" ADD CONSTRAINT "event_settlement_authorisations_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "event_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_sheets" ADD CONSTRAINT "charge_sheets_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_sheets" ADD CONSTRAINT "charge_sheets_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_sheet_lines" ADD CONSTRAINT "charge_sheet_lines_chargeSheetId_fkey" FOREIGN KEY ("chargeSheetId") REFERENCES "charge_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_sheet_acknowledgements" ADD CONSTRAINT "charge_sheet_acknowledgements_chargeSheetId_fkey" FOREIGN KEY ("chargeSheetId") REFERENCES "charge_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_sheet_acknowledgements" ADD CONSTRAINT "charge_sheet_acknowledgements_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_chargeSheetId_fkey" FOREIGN KEY ("chargeSheetId") REFERENCES "charge_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_chargeSheetLineId_fkey" FOREIGN KEY ("chargeSheetLineId") REFERENCES "charge_sheet_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_deposits" ADD CONSTRAINT "fixed_deposits_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_deposit_authorisations" ADD CONSTRAINT "fixed_deposit_authorisations_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "fixed_deposits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_camps" ADD CONSTRAINT "health_camps_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_camp_slots" ADD CONSTRAINT "health_camp_slots_campId_fkey" FOREIGN KEY ("campId") REFERENCES "health_camps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camp_registrations" ADD CONSTRAINT "camp_registrations_campId_fkey" FOREIGN KEY ("campId") REFERENCES "health_camps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camp_registrations" ADD CONSTRAINT "camp_registrations_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "health_camp_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camp_registrations" ADD CONSTRAINT "camp_registrations_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donation_campaigns" ADD CONSTRAINT "donation_campaigns_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donation_contributions" ADD CONSTRAINT "donation_contributions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "donation_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donation_contributions" ADD CONSTRAINT "donation_contributions_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "welfare_disbursements" ADD CONSTRAINT "welfare_disbursements_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "welfare_disbursements" ADD CONSTRAINT "welfare_disbursements_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "donation_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "welfare_disbursement_authorisations" ADD CONSTRAINT "welfare_disbursement_authorisations_disbursementId_fkey" FOREIGN KEY ("disbursementId") REFERENCES "welfare_disbursements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

