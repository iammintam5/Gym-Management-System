-- AlterEnum
ALTER TYPE "SubscriptionStatus" RENAME VALUE 'PENDING' TO 'UPCOMING';

-- AlterTable
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'UPCOMING';
