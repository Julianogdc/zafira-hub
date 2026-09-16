-- CreateEnum
CREATE TYPE "FinancialAccountProvider" AS ENUM ('ASAAS', 'INTER');

-- CreateEnum
CREATE TYPE "FinancialTransactionDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "FinancialTransactionKind" AS ENUM ('CUSTOMER_PAYMENT', 'TRANSFER_INTERNAL', 'FEE', 'EXPENSE', 'TAX', 'ADJUSTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "FinancialCategorizationSource" AS ENUM ('PROVIDER', 'AUTO_RULE', 'MANUAL', 'PENDING');

-- CreateEnum
CREATE TYPE "FinancialTransferStatus" AS ENUM ('UNMATCHED', 'REVIEW', 'AUTO_MATCHED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "FinancialCategoryType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER', 'FEE', 'TAX', 'OTHER');

-- CreateEnum
CREATE TYPE "FinancialMatchField" AS ENUM ('DESCRIPTION', 'COUNTERPARTY_NAME', 'COUNTERPARTY_DOCUMENT');

-- CreateEnum
CREATE TYPE "FinancialMatchType" AS ENUM ('CONTAINS', 'EXACT');

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "FinancialAccountProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "currentBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balanceAsOf" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinancialCategoryType" NOT NULL,
    "color" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_category_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "matchField" "FinancialMatchField" NOT NULL,
    "matchType" "FinancialMatchType" NOT NULL,
    "matchValueNormalized" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_category_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transactions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "direction" "FinancialTransactionDirection" NOT NULL,
    "kind" "FinancialTransactionKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "counterpartyName" TEXT,
    "counterpartyDocument" TEXT,
    "externalReference" TEXT,
    "categoryId" TEXT,
    "categorizationSource" "FinancialCategorizationSource" NOT NULL DEFAULT 'PENDING',
    "categorizationConfidence" DECIMAL(5,2),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transfers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceAccountId" TEXT NOT NULL,
    "destinationAccountId" TEXT NOT NULL,
    "sourceTransactionId" TEXT NOT NULL,
    "destinationTransactionId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "transferredAt" TIMESTAMP(3) NOT NULL,
    "status" "FinancialTransferStatus" NOT NULL DEFAULT 'UNMATCHED',
    "confidence" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "matchReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_accounts_organizationId_idx" ON "financial_accounts"("organizationId");
CREATE INDEX "financial_accounts_provider_idx" ON "financial_accounts"("provider");
CREATE UNIQUE INDEX "financial_accounts_organizationId_provider_name_key" ON "financial_accounts"("organizationId", "provider", "name");

-- CreateIndex
CREATE INDEX "financial_categories_organizationId_idx" ON "financial_categories"("organizationId");
CREATE INDEX "financial_categories_type_idx" ON "financial_categories"("type");
CREATE UNIQUE INDEX "financial_categories_organizationId_name_key" ON "financial_categories"("organizationId", "name");

-- CreateIndex
CREATE INDEX "financial_category_rules_organizationId_idx" ON "financial_category_rules"("organizationId");
CREATE INDEX "financial_category_rules_categoryId_idx" ON "financial_category_rules"("categoryId");
CREATE INDEX "financial_category_rules_priority_idx" ON "financial_category_rules"("priority");

-- CreateIndex
CREATE INDEX "financial_transactions_organizationId_idx" ON "financial_transactions"("organizationId");
CREATE INDEX "financial_transactions_accountId_idx" ON "financial_transactions"("accountId");
CREATE INDEX "financial_transactions_occurredAt_idx" ON "financial_transactions"("occurredAt");
CREATE INDEX "financial_transactions_direction_idx" ON "financial_transactions"("direction");
CREATE INDEX "financial_transactions_kind_idx" ON "financial_transactions"("kind");
CREATE INDEX "financial_transactions_categoryId_idx" ON "financial_transactions"("categoryId");
CREATE INDEX "financial_transactions_categorizationSource_idx" ON "financial_transactions"("categorizationSource");
CREATE UNIQUE INDEX "financial_transactions_accountId_externalId_key" ON "financial_transactions"("accountId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transfers_sourceTransactionId_key" ON "financial_transfers"("sourceTransactionId");
CREATE UNIQUE INDEX "financial_transfers_destinationTransactionId_key" ON "financial_transfers"("destinationTransactionId");
CREATE INDEX "financial_transfers_organizationId_idx" ON "financial_transfers"("organizationId");
CREATE INDEX "financial_transfers_sourceAccountId_idx" ON "financial_transfers"("sourceAccountId");
CREATE INDEX "financial_transfers_destinationAccountId_idx" ON "financial_transfers"("destinationAccountId");
CREATE INDEX "financial_transfers_status_idx" ON "financial_transfers"("status");
CREATE INDEX "financial_transfers_transferredAt_idx" ON "financial_transfers"("transferredAt");

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_category_rules" ADD CONSTRAINT "financial_category_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_category_rules" ADD CONSTRAINT "financial_category_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "financial_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "financial_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transfers" ADD CONSTRAINT "financial_transfers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transfers" ADD CONSTRAINT "financial_transfers_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transfers" ADD CONSTRAINT "financial_transfers_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transfers" ADD CONSTRAINT "financial_transfers_sourceTransactionId_fkey" FOREIGN KEY ("sourceTransactionId") REFERENCES "financial_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transfers" ADD CONSTRAINT "financial_transfers_destinationTransactionId_fkey" FOREIGN KEY ("destinationTransactionId") REFERENCES "financial_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
