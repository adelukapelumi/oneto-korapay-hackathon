- CreateTable
CREATE TABLE "ProcessedSequence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "transactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedSequence_userId_sequenceNumber_key" ON "ProcessedSequence"("userId", "sequenceNumber");

-- CreateIndex
CREATE INDEX "ProcessedSequence_userId_createdAt_idx" ON "ProcessedSequence"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProcessedSequence" ADD CONSTRAINT "ProcessedSequence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
