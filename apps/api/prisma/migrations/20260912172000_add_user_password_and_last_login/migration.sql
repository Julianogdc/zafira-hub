-- AlterTable
ALTER TABLE "users" ADD COLUMN "passwordHash" TEXT,
ADD COLUMN "lastLoginAt" TIMESTAMP(3);
