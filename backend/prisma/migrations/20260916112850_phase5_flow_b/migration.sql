-- CreateEnum
CREATE TYPE "OfferRecurrence" AS ENUM ('NONE', 'WEEKLY');

-- AlterTable
ALTER TABLE "commitments" ADD COLUMN     "pollId" TEXT,
ALTER COLUMN "offerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "recurring" "OfferRecurrence" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "polls" ADD COLUMN     "taggedVendorId" TEXT,
ADD COLUMN     "vendorConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "vendorConfirmedMinimum" INTEGER,
ADD COLUMN     "vendorDeclinedAt" TIMESTAMP(3),
ADD COLUMN     "vendorDiscountLadder" JSONB,
ADD COLUMN     "vendorUnitPrice" DECIMAL(14,2);

-- CreateIndex
CREATE INDEX "commitments_pollId_idx" ON "commitments"("pollId");

-- CreateIndex
CREATE UNIQUE INDEX "commitments_pollId_residentId_key" ON "commitments"("pollId", "residentId");

-- CreateIndex
CREATE INDEX "polls_taggedVendorId_idx" ON "polls"("taggedVendorId");

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_taggedVendorId_fkey" FOREIGN KEY ("taggedVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
