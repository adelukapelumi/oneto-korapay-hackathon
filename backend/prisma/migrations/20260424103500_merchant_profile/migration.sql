REATE TABLE "MerchantProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "businessName" TEXT NOT NULL,
  "businessAddress" TEXT,
  "cashoutBankName" TEXT NOT NULL,
  "cashoutAccountNumber" TEXT NOT NULL,
  "cashoutAccountName" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MerchantProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantProfile_userId_key" ON "MerchantProfile"("userId");

CREATE INDEX "MerchantProfile_businessName_idx" ON "MerchantProfile"("businessName");

ALTER TABLE "MerchantProfile" ADD CONSTRAINT "MerchantProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
