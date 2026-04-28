-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'MERCHANT', 'ADMIN');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('ACTIVE', 'FROZEN', 'FLAGGED', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "CashoutStatus" AS ENUM ('PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
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

-- CreateTable
CREATE TABLE "ProcessedSequence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "transactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "businessAddress" TEXT,
    "cashoutBankName" TEXT NOT NULL,
    "cashoutBankCode" TEXT NOT NULL,
    "cashoutAccountNumber" TEXT NOT NULL,
    "cashoutAccountName" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cashout" (
    "id" TEXT NOT NULL,
    "merchantUserId" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "status" "CashoutStatus" NOT NULL DEFAULT 'PENDING',
    "cashoutBankName" TEXT NOT NULL,
    "cashoutBankCode" TEXT NOT NULL,
    "cashoutAccountNumber" TEXT NOT NULL,
    "cashoutAccountName" TEXT NOT NULL,
    "korapayReference" TEXT,
    "korapayResponse" JSONB,
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Cashout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_transactionId_userId_key" ON "LedgerEntry"("transactionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTopup_reference_key" ON "PaymentTopup"("reference");

-- CreateIndex
CREATE INDEX "ProcessedSequence_userId_createdAt_idx" ON "ProcessedSequence"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedSequence_userId_sequenceNumber_key" ON "ProcessedSequence"("userId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantProfile_userId_key" ON "MerchantProfile"("userId");

-- CreateIndex
CREATE INDEX "MerchantProfile_businessName_idx" ON "MerchantProfile"("businessName");

-- CreateIndex
CREATE UNIQUE INDEX "Cashout_korapayReference_key" ON "Cashout"("korapayReference");

-- CreateIndex
CREATE INDEX "Cashout_merchantUserId_requestedAt_idx" ON "Cashout"("merchantUserId", "requestedAt");

-- CreateIndex
CREATE INDEX "Cashout_status_idx" ON "Cashout"("status");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedSequence" ADD CONSTRAINT "ProcessedSequence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantProfile" ADD CONSTRAINT "MerchantProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cashout" ADD CONSTRAINT "Cashout_merchantUserId_fkey" FOREIGN KEY ("merchantUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cashout" ADD CONSTRAINT "Cashout_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

