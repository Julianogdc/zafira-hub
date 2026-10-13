-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'BRIGHTBEAN';

-- CreateEnum
CREATE TYPE "IntegrationAuthType" AS ENUM ('API_KEY', 'OAUTH2', 'TOKEN');

-- CreateEnum
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('ACTIVE', 'DISCONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "provider" "IntegrationProvider" NOT NULL,
    "authType" "IntegrationAuthType" NOT NULL,
    "externalScopeId" TEXT,
    "displayName" TEXT,
    "credentialCiphertext" TEXT,
    "metadata" JSONB,
    "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_connections_organizationId_idx" ON "integration_connections"("organizationId");

-- CreateIndex
CREATE INDEX "integration_connections_clientId_idx" ON "integration_connections"("clientId");

-- CreateIndex
CREATE INDEX "integration_connections_provider_idx" ON "integration_connections"("provider");

-- CreateIndex
CREATE INDEX "integration_connections_status_idx" ON "integration_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_organizationId_provider_externalSc_key" ON "integration_connections"("organizationId", "provider", "externalScopeId");

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
