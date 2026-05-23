CREATE TYPE "TopupFeeBearer" AS ENUM ('STUDENT', 'ONETO', 'UNKNOWN');

ALTER TABLE "PaymentTopup"
ADD COLUMN "creditedAmountKobo" BIGINT,
ADD COLUMN "feeBearer" "TopupFeeBearer" NOT NULL DEFAULT 'STUDENT',
ADD COLUMN "processorFeeKobo" BIGINT,
ADD COLUMN "grossPaidKobo" BIGINT;

UPDATE "PaymentTopup"
SET "creditedAmountKobo" = "amountKobo"
WHERE "creditedAmountKobo" IS NULL;

ALTER TABLE "PaymentTopup"
ALTER COLUMN "creditedAmountKobo" SET NOT NULL;
