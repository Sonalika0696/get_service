-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "settlementAccountName" TEXT,
ADD COLUMN     "settlementAccountNumber" TEXT,
ADD COLUMN     "settlementIfsc" TEXT,
ADD COLUMN     "tradeLicenceNumber" TEXT,
ADD COLUMN     "tradeLicenceVerifiedAt" TIMESTAMP(3);

