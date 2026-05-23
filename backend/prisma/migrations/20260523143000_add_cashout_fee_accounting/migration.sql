ALTER TABLE "Cashout"
  ADD COLUMN "grossAmountKobo" BIGINT,
  ADD COLUMN "onetoFeeBps" INTEGER NOT NULL DEFAULT 250,
  ADD COLUMN "onetoFeeKobo" BIGINT,
  ADD COLUMN "korapayPayoutFeeKobo" BIGINT,
  ADD COLUMN "netPayoutKobo" BIGINT,
  ADD COLUMN "finalPayoutAmountKobo" BIGINT;

UPDATE "Cashout"
SET
  "grossAmountKobo" = "amountKobo",
  "onetoFeeKobo" = ("amountKobo" * 250) / 10000
WHERE "grossAmountKobo" IS NULL;
