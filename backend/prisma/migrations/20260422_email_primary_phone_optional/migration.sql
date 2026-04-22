-- AlterTable: add email column (required, no default — will fail on non-empty tables;
-- this is expected since the pilot database is empty or will be re-seeded)
ALTER TABLE "User" ADD COLUMN "email" TEXT NOT NULL;

-- AlterTable: make phone optional
ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;

-- DropIndex: remove unique constraint on phone (phone is now optional)
DROP INDEX "User_phone_key";

-- DropIndex: remove old phone index
DROP INDEX "User_phone_idx";

-- CreateIndex: unique index on email (primary identifier)
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex: index on email for lookup performance
CREATE INDEX "User_email_idx" ON "User"("email");
