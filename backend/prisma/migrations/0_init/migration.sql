-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'MERCHANT', 'ADMIN');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('ACTIVE', 'FROZEN', 'FLAGGED', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "verifiedBalanceKobo" BIGINT NOT NULL DEFAULT 0,
    "publicKey" TEXT,
    "sequenceNumber" INTEGER NOT NULL DEFAULT 1,
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "status" "Status" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "balanceAfterKobo" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "envelopeJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTopup" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "korapayResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTopup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_transactionId_idx" ON "LedgerEntry"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTopup_reference_key" ON "PaymentTopup"("reference");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

