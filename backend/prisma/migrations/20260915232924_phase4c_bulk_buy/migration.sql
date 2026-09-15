-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OPEN', 'FIRED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('PENDING', 'FUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobCardStatus" AS ENUM ('PENDING', 'SIGNED_OFF', 'DISPUTED');

-- CreateEnum
CREATE TYPE "JobCardTier" AS ENUM ('SMALL', 'LARGE');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'AUTHORISED', 'PAID');

-- CreateEnum
CREATE TYPE "PayoutAuthKind" AS ENUM ('SYSTEM', 'TREASURER');

-- AlterEnum
ALTER TYPE "AccountKind" ADD VALUE 'VENDOR';

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discountLadder" JSONB NOT NULL,
    "minCommitments" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'OPEN',
    "appliedDiscountPct" DECIMAL(5,2),
    "firedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commitments" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "status" "CommitmentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'ACTIVE',
    "tier" "JobCardTier" NOT NULL DEFAULT 'SMALL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_cards" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "appliedDiscountPct" DECIMAL(5,2) NOT NULL,
    "status" "JobCardStatus" NOT NULL DEFAULT 'PENDING',
    "tier" "JobCardTier" NOT NULL DEFAULT 'SMALL',
    "signedOffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "commission" DECIMAL(14,2) NOT NULL,
    "vendorNet" DECIMAL(14,2) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "razorpayPayoutRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_authorisations" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "kind" "PayoutAuthKind" NOT NULL,
    "authoriserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_authorisations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offers_societyId_status_idx" ON "offers"("societyId", "status");

-- CreateIndex
CREATE INDEX "commitments_offerId_idx" ON "commitments"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "commitments_offerId_residentId_key" ON "commitments"("offerId", "residentId");

-- CreateIndex
CREATE INDEX "bookings_societyId_idx" ON "bookings"("societyId");

-- CreateIndex
CREATE INDEX "job_cards_bookingId_idx" ON "job_cards"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "job_cards_commitmentId_key" ON "job_cards"("commitmentId");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_bookingId_key" ON "payouts"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "payout_authorisations_payoutId_kind_key" ON "payout_authorisations"("payoutId", "kind");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_authorisations" ADD CONSTRAINT "payout_authorisations_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
