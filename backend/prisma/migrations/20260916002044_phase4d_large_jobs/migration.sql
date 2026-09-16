-- AlterEnum
ALTER TYPE "AccountKind" ADD VALUE 'RETENTION';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "commissionTaken" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retentionAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "retentionReleaseAt" TIMESTAMP(3),
ADD COLUMN     "retentionReleasedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "milestoneTemplate" JSONB,
ADD COLUMN     "retentionDays" INTEGER,
ADD COLUMN     "retentionPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tier" "JobCardTier" NOT NULL DEFAULT 'SMALL';

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "pct" DECIMAL(5,2) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(14,2),
    "paidAt" TIMESTAMP(3),
    "razorpayPayoutRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_authorisations" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "kind" "PayoutAuthKind" NOT NULL,
    "authoriserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_authorisations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestones_bookingId_idx" ON "milestones"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "milestones_bookingId_sequence_key" ON "milestones"("bookingId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_authorisations_milestoneId_kind_key" ON "milestone_authorisations"("milestoneId", "kind");

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_authorisations" ADD CONSTRAINT "milestone_authorisations_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
