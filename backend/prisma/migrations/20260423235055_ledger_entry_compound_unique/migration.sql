- DropIndex
DROP INDEX "LedgerEntry_transactionId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_transactionId_userId_key" ON "LedgerEntry"("transactionId", "userId");