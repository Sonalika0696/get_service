-- CreateEnum
CREATE TYPE "VerificationTier" AS ENUM ('UNVERIFIED', 'SOCIETY_ATTESTED', 'PLATFORM_AUDITED');

-- CreateEnum
CREATE TYPE "RatingSource" AS ENUM ('RESIDENT', 'COMMITTEE');

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radiusKm" DECIMAL(6,2),
    "verificationTier" "VerificationTier" NOT NULL DEFAULT 'UNVERIFIED',
    "gstin" TEXT,
    "gstinVerifiedAt" TIMESTAMP(3),
    "ratingAvg" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_categories" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "vendor_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_ratings" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "jobCardId" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "source" "RatingSource" NOT NULL DEFAULT 'RESIDENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_access_requests" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendors_societyId_idx" ON "vendors"("societyId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_categories_vendorId_category_key" ON "vendor_categories"("vendorId", "category");

-- CreateIndex
CREATE INDEX "vendor_ratings_vendorId_idx" ON "vendor_ratings"("vendorId");

-- CreateIndex
CREATE INDEX "vendor_access_requests_vendorId_idx" ON "vendor_access_requests"("vendorId");

-- CreateIndex
CREATE INDEX "kyc_documents_userId_idx" ON "kyc_documents"("userId");

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_categories" ADD CONSTRAINT "vendor_categories_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_ratings" ADD CONSTRAINT "vendor_ratings_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_ratings" ADD CONSTRAINT "vendor_ratings_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_access_requests" ADD CONSTRAINT "vendor_access_requests_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_access_requests" ADD CONSTRAINT "vendor_access_requests_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
