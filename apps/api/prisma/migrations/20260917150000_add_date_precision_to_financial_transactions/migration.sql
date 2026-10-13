-- CreateEnum
CREATE TYPE "FinancialDatePrecision" AS ENUM ('DATE_ONLY', 'DATETIME');

-- AlterTable
ALTER TABLE "financial_transactions" ADD COLUMN "datePrecision" "FinancialDatePrecision" NOT NULL DEFAULT 'DATE_ONLY';
