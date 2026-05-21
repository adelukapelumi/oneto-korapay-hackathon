-- Key recovery request workflow and global device public-key uniqueness.

CREATE TYPE "KeyRecoveryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TYPE "KeyRecoveryRiskType" AS ENUM ('LOST_DEVICE', 'COMPROMISED_DEVICE');

CREATE TYPE "KeyRecoveryReason" AS ENUM (
  'LOST_PHONE',
  'STOLEN_PHONE',
  'DAMAGED_PHONE',
  'APP_UNINSTALLED',
  'APP_DATA_CLEARED',
  'FACTORY_RESET',
  'FORGOT_PIN',
  'KEYPAIR_WIPED',
  'OTHER'
);

CREATE TABLE "KeyRecoveryRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "oldKeyId" TEXT NOT NULL,
  "requestedNewPublicKey" TEXT NOT NULL,
  "status" "KeyRecoveryStatus" NOT NULL DEFAULT 'PENDING',
  "riskType" "KeyRecoveryRiskType" NOT NULL,
  "reason" "KeyRecoveryReason" NOT NULL,
  "userNotes" TEXT,
  "approximateBalanceKobo" BIGINT,
  "lastMerchantText" TEXT,
  "lastTopupAmountKobo" BIGINT,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "decisionNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KeyRecoveryRequest_pkey" PRIMARY KEY ("id")
);

DROP INDEX IF EXISTS "UserDeviceKey_publicKey_idx";

CREATE UNIQUE INDEX "UserDeviceKey_publicKey_key" ON "UserDeviceKey"("publicKey");

CREATE INDEX "KeyRecoveryRequest_userId_status_idx" ON "KeyRecoveryRequest"("userId", "status");

CREATE INDEX "KeyRecoveryRequest_status_createdAt_idx" ON "KeyRecoveryRequest"("status", "createdAt");

CREATE INDEX "KeyRecoveryRequest_oldKeyId_idx" ON "KeyRecoveryRequest"("oldKeyId");

CREATE UNIQUE INDEX "KeyRecoveryRequest_one_pending_per_user"
ON "KeyRecoveryRequest"("userId")
WHERE "status" = 'PENDING';

ALTER TABLE "KeyRecoveryRequest"
ADD CONSTRAINT "KeyRecoveryRequest_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KeyRecoveryRequest"
ADD CONSTRAINT "KeyRecoveryRequest_oldKeyId_fkey"
FOREIGN KEY ("oldKeyId") REFERENCES "UserDeviceKey"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KeyRecoveryRequest"
ADD CONSTRAINT "KeyRecoveryRequest_reviewedByUserId_fkey"
FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
