CREATE TYPE "RecoveryBalanceHoldStatus" AS ENUM ('ACTIVE', 'CANCELLED');

CREATE TABLE "RecoveryBalanceHold" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recoveryRequestId" TEXT NOT NULL,
    "oldKeyId" TEXT NOT NULL,
    "status" "RecoveryBalanceHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "heldAmountKobo" BIGINT NOT NULL,
    "consumedAmountKobo" BIGINT NOT NULL DEFAULT 0,
    "holdUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryBalanceHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecoveryBalanceHold_recoveryRequestId_key" ON "RecoveryBalanceHold"("recoveryRequestId");
CREATE INDEX "RecoveryBalanceHold_userId_status_holdUntil_idx" ON "RecoveryBalanceHold"("userId", "status", "holdUntil");
CREATE INDEX "RecoveryBalanceHold_oldKeyId_status_holdUntil_idx" ON "RecoveryBalanceHold"("oldKeyId", "status", "holdUntil");

ALTER TABLE "RecoveryBalanceHold" ADD CONSTRAINT "RecoveryBalanceHold_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecoveryBalanceHold" ADD CONSTRAINT "RecoveryBalanceHold_recoveryRequestId_fkey"
FOREIGN KEY ("recoveryRequestId") REFERENCES "KeyRecoveryRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecoveryBalanceHold" ADD CONSTRAINT "RecoveryBalanceHold_oldKeyId_fkey"
FOREIGN KEY ("oldKeyId") REFERENCES "UserDeviceKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
