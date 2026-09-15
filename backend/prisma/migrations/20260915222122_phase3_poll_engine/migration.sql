-- CreateEnum
CREATE TYPE "PollType" AS ENUM ('ADVISORY', 'BINDING', 'EVENT', 'BULK_BUY_RESIDENT');

-- CreateEnum
CREATE TYPE "PollWeightMode" AS ENUM ('UNIFORM', 'OWNERSHIP_WEIGHTED');

-- CreateEnum
CREATE TYPE "PollStatus" AS ENUM ('OPEN', 'PASSED', 'FAILED', 'FIRED', 'EXPIRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "VoteChoice" AS ENUM ('YES', 'NO', 'ABSTAIN');

-- CreateTable
CREATE TABLE "polls" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "pollType" "PollType" NOT NULL,
    "weightMode" "PollWeightMode" NOT NULL DEFAULT 'UNIFORM',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "quorumPct" DECIMAL(5,2) NOT NULL DEFAULT 60,
    "passingPct" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "minCommitments" INTEGER,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "status" "PollStatus" NOT NULL DEFAULT 'OPEN',
    "firedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "votes" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "voterHash" TEXT NOT NULL,
    "choice" "VoteChoice" NOT NULL,
    "weight" DECIMAL(6,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_commitments" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_commitments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "polls_societyId_status_idx" ON "polls"("societyId", "status");

-- CreateIndex
CREATE INDEX "polls_closesAt_idx" ON "polls"("closesAt");

-- CreateIndex
CREATE INDEX "votes_pollId_idx" ON "votes"("pollId");

-- CreateIndex
CREATE UNIQUE INDEX "votes_pollId_voterHash_key" ON "votes"("pollId", "voterHash");

-- CreateIndex
CREATE UNIQUE INDEX "poll_commitments_pollId_residentId_key" ON "poll_commitments"("pollId", "residentId");

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_commitments" ADD CONSTRAINT "poll_commitments_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_commitments" ADD CONSTRAINT "poll_commitments_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
