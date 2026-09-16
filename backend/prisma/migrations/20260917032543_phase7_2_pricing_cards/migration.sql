-- CreateEnum
CREATE TYPE "PricingCardStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "PricingBasis" AS ENUM ('PER_VISIT', 'PER_HOUR', 'PER_UNIT', 'PERCENTAGE');

-- CreateTable
CREATE TABLE "pricing_cards" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "gstRatePct" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "status" "PricingCardStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_lines" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "basis" "PricingBasis" NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "minimum" DECIMAL(10,2),
    "conditions" TEXT,

    CONSTRAINT "pricing_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pricing_cards_vendorId_category_idx" ON "pricing_cards"("vendorId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_cards_vendorId_category_version_key" ON "pricing_cards"("vendorId", "category", "version");

-- CreateIndex
CREATE INDEX "pricing_lines_cardId_idx" ON "pricing_lines"("cardId");

-- AddForeignKey
ALTER TABLE "pricing_cards" ADD CONSTRAINT "pricing_cards_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_lines" ADD CONSTRAINT "pricing_lines_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "pricing_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

