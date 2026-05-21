-- CreateEnum
CREATE TYPE "DeviceKeyStatus" AS ENUM ('ACTIVE', 'VERIFY_ONLY', 'REVOKED');

-- CreateTable
CREATE TABLE "UserDeviceKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "status" "DeviceKeyStatus" NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "verifyUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDeviceKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserDeviceKey_userId_status_idx" ON "UserDeviceKey"("userId", "status");

-- CreateIndex
CREATE INDEX "UserDeviceKey_publicKey_idx" ON "UserDeviceKey"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserDeviceKey_userId_publicKey_key" ON "UserDeviceKey"("userId", "publicKey");

-- AddForeignKey
ALTER TABLE "UserDeviceKey" ADD CONSTRAINT "UserDeviceKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill current compatibility-mirror keys into device-key history.
INSERT INTO "UserDeviceKey" (
    "id",
    "userId",
    "publicKey",
    "status",
    "validFrom",
    "createdAt",
    "updatedAt"
)
SELECT
    CONCAT('udk_backfill_', md5("id" || ':' || "publicKey")),
    "id",
    "publicKey",
    'ACTIVE'::"DeviceKeyStatus",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User"
WHERE "publicKey" IS NOT NULL;

-- Only one ACTIVE device key may exist per user.
CREATE UNIQUE INDEX "UserDeviceKey_one_active_per_user"
ON "UserDeviceKey"("userId")
WHERE "status" = 'ACTIVE';
