CREATE TYPE "OfflinePaymentResolutionStatus" AS ENUM ('EXPIRED_UNCLAIMED', 'REJECTED');

CREATE TABLE "OfflinePaymentResolution" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "status" "OfflinePaymentResolutionStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "claimDeadlineAt" TIMESTAMP(3) NOT NULL,
    "envelopeJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfflinePaymentResolution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfflinePaymentResolution_transactionId_key" ON "OfflinePaymentResolution"("transactionId");
CREATE INDEX "OfflinePaymentResolution_senderUserId_status_idx" ON "OfflinePaymentResolution"("senderUserId", "status");
CREATE INDEX "OfflinePaymentResolution_recipientUserId_status_idx" ON "OfflinePaymentResolution"("recipientUserId", "status");
CREATE INDEX "OfflinePaymentResolution_claimDeadlineAt_idx" ON "OfflinePaymentResolution"("claimDeadlineAt");

ALTER TABLE "OfflinePaymentResolution"
ADD CONSTRAINT "OfflinePaymentResolution_senderUserId_fkey"
FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
