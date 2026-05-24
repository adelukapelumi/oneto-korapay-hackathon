CREATE TYPE "KorapayPayoutFeeBearer" AS ENUM ('UNKNOWN', 'MERCHANT', 'ONETO');

ALTER TABLE "Cashout"
  RENAME COLUMN "payoutAmountBeforeKorapayFeeKobo" TO "korapayTransferAmountKobo";

ALTER TABLE "Cashout"
  ADD COLUMN "korapayPayoutFeeBearer" "KorapayPayoutFeeBearer" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "korapayPayoutFeeDeductedFromRecipient" BOOLEAN;
