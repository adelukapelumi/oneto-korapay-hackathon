CREATE TYPE "CashoutStatus" AS ENUM ('PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "Cashout" (
  "id" TEXT NOT NULL,
  "merchantUserId" TEXT NOT NULL,
  "amountKobo" BIGINT NOT NULL,
  "status" "CashoutStatus" NOT NULL DEFAULT 'PENDING',
  "cashoutBankName" TEXT NOT NULL,
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

CREATE UNIQUE INDEX "Cashout_korapayReference_key" ON "Cashout"("korapayReference");
CREATE INDEX "Cashout_merchantUserId_requestedAt_idx" ON "Cashout"("merchantUserId", "requestedAt");
CREATE INDEX "Cashout_status_idx" ON "Cashout"("status");

ALTER TABLE "Cashout" ADD CONSTRAINT "Cashout_merchantUserId_fkey" FOREIGN KEY ("merchantUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cashout" ADD CONSTRAINT "Cashout_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
