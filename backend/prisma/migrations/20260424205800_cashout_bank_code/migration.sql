-- AlterTable
ALTER TABLE "MerchantProfile" ADD COLUMN "cashoutBankCode" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Cashout" ADD COLUMN "cashoutBankCode" TEXT NOT NULL DEFAULT '';
