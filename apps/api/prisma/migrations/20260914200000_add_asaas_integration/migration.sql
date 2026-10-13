-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'ASAAS';

-- CreateEnum
CREATE TYPE "AsaasPaymentStatus" AS ENUM ('PENDING', 'RECEIVED', 'CONFIRMED', 'OVERDUE', 'REFUNDED', 'DELETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "asaas_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "asaasCustomerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "installmentNumber" INTEGER,
    "description" TEXT,
    "value" DECIMAL(12,2) NOT NULL,
    "netValue" DECIMAL(12,2),
    "originalValue" DECIMAL(12,2),
    "interestValue" DECIMAL(12,2),
    "billingType" TEXT NOT NULL DEFAULT 'UNDEFINED',
    "status" "AsaasPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paymentDate" TIMESTAMP(3),
    "clientPaymentDate" TIMESTAMP(3),
    "invoiceUrl" TEXT,
    "bankSlipUrl" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asaas_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asaas_webhook_events" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "eventId" TEXT,
    "event" TEXT NOT NULL,
    "paymentExternalId" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,

    CONSTRAINT "asaas_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asaas_payments_externalId_key" ON "asaas_payments"("externalId");

-- CreateIndex
CREATE INDEX "asaas_payments_organizationId_idx" ON "asaas_payments"("organizationId");

-- CreateIndex
CREATE INDEX "asaas_payments_clientId_idx" ON "asaas_payments"("clientId");

-- CreateIndex
CREATE INDEX "asaas_payments_asaasCustomerId_idx" ON "asaas_payments"("asaasCustomerId");

-- CreateIndex
CREATE INDEX "asaas_payments_status_idx" ON "asaas_payments"("status");

-- CreateIndex
CREATE INDEX "asaas_payments_dueDate_idx" ON "asaas_payments"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "asaas_webhook_events_dedupeKey_key" ON "asaas_webhook_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "asaas_webhook_events_paymentExternalId_idx" ON "asaas_webhook_events"("paymentExternalId");

-- CreateIndex
CREATE INDEX "asaas_webhook_events_dedupeKey_idx" ON "asaas_webhook_events"("dedupeKey");

-- AddForeignKey
ALTER TABLE "asaas_payments" ADD CONSTRAINT "asaas_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asaas_payments" ADD CONSTRAINT "asaas_payments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
