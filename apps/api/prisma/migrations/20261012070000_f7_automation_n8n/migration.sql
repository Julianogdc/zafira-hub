-- F7-4a - Automacoes n8n do onboarding: infraestrutura generica (DEC-F7-016)
-- Cria fluxos por organizacao e a caixa de saida transacional (outbox); acrescenta a condicao
-- AUTOMATION_SUCCEEDED, o fluxo da etapa (automationKey) e a marca de conclusao por sistema.
-- NENHUMA linha e inserida. O n8n nao escreve no Asana por estas automacoes (D1).
-- NAO REMOVER indices parciais, CHECKs e gatilhos desta nem das migrations F7-1a, F7-2a, F7-3a e F7-3c.
-- Nota: o diff tambem sugere renomear a FK organization_invitations_..._fk (divergencia anterior; fora do escopo).
-- Ensaiar somente em base descartavel antes de qualquer ambiente real.

-- CreateEnum
CREATE TYPE "AutomationOutboxStatus" AS ENUM ('PENDING', 'SENT', 'RETRYING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'DEAD');

-- CreateEnum
CREATE TYPE "AutomationEventType" AS ENUM ('STEP_AUTOMATION', 'EXECUTION_STARTED', 'EXECUTION_COMPLETED', 'EXECUTION_CANCELLED');

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'N8N';

-- AlterEnum
ALTER TYPE "OnboardingCompletionCondition" ADD VALUE 'AUTOMATION_SUCCEEDED';

-- AlterTable
ALTER TABLE "onboarding_step_definitions" ADD COLUMN     "automationKey" TEXT;

-- AlterTable
ALTER TABLE "onboarding_step_runs" ADD COLUMN     "completedBySystem" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "automation_flows" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "webhookUrl" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "subscribeLifecycle" BOOLEAN NOT NULL DEFAULT false,
    "includeClientName" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_outbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stepKey" TEXT,
    "flowKey" TEXT NOT NULL,
    "eventType" "AutomationEventType" NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "status" "AutomationOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "resultCode" TEXT,
    "resultMessage" TEXT,
    "externalRefs" JSONB,
    "appliedAt" TIMESTAMP(3),
    "requestedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automation_flows_organizationId_key_key" ON "automation_flows"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "automation_outbox_idempotencyKey_key" ON "automation_outbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "automation_outbox_status_nextAttemptAt_idx" ON "automation_outbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "automation_outbox_organizationId_executionId_idx" ON "automation_outbox"("organizationId", "executionId");

-- AddForeignKey
ALTER TABLE "automation_flows" ADD CONSTRAINT "automation_flows_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_outbox" ADD CONSTRAINT "automation_outbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_outbox" ADD CONSTRAINT "automation_outbox_organizationId_executionId_fkey" FOREIGN KEY ("organizationId", "executionId") REFERENCES "onboarding_executions"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Regras no banco (nao expressas pelo Prisma). NAO REMOVER: um `prisma migrate diff` futuro
-- vai listar estes objetos como diferenca em relacao ao schema.prisma.
-- ---------------------------------------------------------------------------

-- Duas liberacoes simultaneas da mesma etapa geram UM pedido (por fluxo, tipo e geracao)
CREATE UNIQUE INDEX "automation_outbox_unique_request"
  ON "automation_outbox"("executionId", COALESCE("stepKey", ''), "eventType", "flowKey", "generation");

ALTER TABLE "automation_outbox"
  ADD CONSTRAINT "automation_outbox_attempts_nonnegative" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "automation_outbox_generation_positive" CHECK ("generation" >= 1),
  ADD CONSTRAINT "automation_outbox_step_event_has_step" CHECK ("eventType" <> 'STEP_AUTOMATION' OR "stepKey" IS NOT NULL);

-- Identidade do pedido imutavel; resultado SUCCEEDED e definitivo; historico nao e apagado diretamente.
CREATE OR REPLACE FUNCTION automation_guard_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "onboarding_executions" WHERE "id" = OLD."executionId") THEN
      RAISE EXCEPTION 'automation_outbox_history_protected: o historico de automacao nao pode ser apagado'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."executionId" IS DISTINCT FROM OLD."executionId"
     OR NEW."stepKey" IS DISTINCT FROM OLD."stepKey"
     OR NEW."flowKey" IS DISTINCT FROM OLD."flowKey"
     OR NEW."eventType" IS DISTINCT FROM OLD."eventType"
     OR NEW."generation" IS DISTINCT FROM OLD."generation"
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" THEN
    RAISE EXCEPTION 'automation_outbox_immutable: identidade do pedido e imutavel'
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" = 'SUCCEEDED' AND (
       NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."attempts" IS DISTINCT FROM OLD."attempts"
    OR NEW."resultCode" IS DISTINCT FROM OLD."resultCode"
    OR NEW."externalRefs" IS DISTINCT FROM OLD."externalRefs"
    OR NEW."finishedAt" IS DISTINCT FROM OLD."finishedAt") THEN
    RAISE EXCEPTION 'automation_outbox_final: pedido concluido com sucesso nao pode ser alterado'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "automation_outbox_guard"
  BEFORE UPDATE OR DELETE ON "automation_outbox"
  FOR EACH ROW EXECUTE FUNCTION automation_guard_outbox();
