-- AlterTable
ALTER TABLE "financial_category_rules" ADD COLUMN "clientId" TEXT;

-- AlterTable
ALTER TABLE "financial_transactions" ADD COLUMN "clientId" TEXT,
ADD COLUMN "suggestedClientId" TEXT;

-- CreateIndex
CREATE INDEX "financial_category_rules_clientId_idx" ON "financial_category_rules"("clientId");

-- CreateIndex
CREATE INDEX "financial_transactions_clientId_idx" ON "financial_transactions"("clientId");

-- CreateIndex
CREATE INDEX "financial_transactions_suggestedClientId_idx" ON "financial_transactions"("suggestedClientId");

-- AddForeignKey
ALTER TABLE "financial_category_rules" ADD CONSTRAINT "financial_category_rules_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_suggestedClientId_fkey" FOREIGN KEY ("suggestedClientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
