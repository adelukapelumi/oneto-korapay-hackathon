DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TopupFeeBearer') THEN
    CREATE TYPE "TopupFeeBearer" AS ENUM ('STUDENT', 'ONETO', 'UNKNOWN');
  END IF;
END $$;

ALTER TABLE "PaymentTopup"
  ADD COLUMN IF NOT EXISTS "creditedAmountKobo" BIGINT,
  ADD COLUMN IF NOT EXISTS "feeBearer" "TopupFeeBearer" NOT NULL DEFAULT 'STUDENT',
  ADD COLUMN IF NOT EXISTS "processorFeeKobo" BIGINT,
  ADD COLUMN IF NOT EXISTS "grossPaidKobo" BIGINT;

UPDATE "PaymentTopup"
SET "creditedAmountKobo" = "amountKobo"
WHERE "creditedAmountKobo" IS NULL;

ALTER TABLE "PaymentTopup"
  ALTER COLUMN "creditedAmountKobo" SET NOT NULL,
  ALTER COLUMN "feeBearer" SET DEFAULT 'STUDENT';
