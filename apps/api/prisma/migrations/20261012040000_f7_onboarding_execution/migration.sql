-- F7-2a - Execucao do onboarding por cliente (DEC-F7-008)
-- Cria execucoes, etapas em execucao e eventos append-only. NENHUMA linha e inserida.
-- Garantias no banco: B2 (uma execucao ATIVA por cliente e modelo; indice unico parcial),
-- cliente/modelo/versao imutaveis, etapa encerrada nao reabre, eventos append-only,
-- nenhuma etapa aberta em execucao encerrada.
-- NAO REMOVER os indices parciais e gatilhos desta nem da migration 20261012030000 (F7-1a):
-- um prisma migrate diff futuro os listara como diferenca em relacao ao schema.prisma.
-- Nota: o diff tambem sugere renomear a FK organization_invitations_...organizationMemberId_fk
-- (divergencia de nome ja existente, fora do escopo; nao incluida aqui).
-- Ensaiar somente em base descartavel antes de qualquer ambiente real.

-- CreateEnum
CREATE TYPE "OnboardingExecutionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OnboardingStepRunStatus" AS ENUM ('WAITING', 'READY', 'IN_PROGRESS', 'DONE', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OnboardingStartTrigger" AS ENUM ('MANUAL');

-- CreateEnum
CREATE TYPE "OnboardingAssigneeSource" AS ENUM ('NONE', 'MODEL_MEMBER', 'FUNCTION_RESOLVED', 'MANUAL');

-- CreateTable
CREATE TABLE "onboarding_executions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" "OnboardingExecutionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startTrigger" "OnboardingStartTrigger" NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "requestId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "completionMode" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_step_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "status" "OnboardingStepRunStatus" NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "blockedAt" TIMESTAMP(3),
    "assigneeMemberId" TEXT,
    "assigneeSource" "OnboardingAssigneeSource" NOT NULL DEFAULT 'NONE',
    "functionId" TEXT,
    "releasedAt" TIMESTAMP(3),
    "dueDate" DATE,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "evidenceLink" TEXT,
    "evidenceNote" TEXT,
    "asanaProjectGid" TEXT,
    "skipReason" TEXT,
    "skippedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_step_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_execution_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stepKey" TEXT,
    "type" TEXT NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_execution_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "onboarding_executions_organizationId_status_idx" ON "onboarding_executions"("organizationId", "status");

-- CreateIndex
CREATE INDEX "onboarding_executions_organizationId_clientId_idx" ON "onboarding_executions"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "onboarding_executions_templateId_idx" ON "onboarding_executions"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_executions_organizationId_id_key" ON "onboarding_executions"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_executions_organizationId_id_versionId_key" ON "onboarding_executions"("organizationId", "id", "versionId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_executions_organizationId_requestId_key" ON "onboarding_executions"("organizationId", "requestId");

-- CreateIndex
CREATE INDEX "onboarding_step_runs_organizationId_assigneeMemberId_status_idx" ON "onboarding_step_runs"("organizationId", "assigneeMemberId", "status");

-- CreateIndex
CREATE INDEX "onboarding_step_runs_executionId_idx" ON "onboarding_step_runs"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_step_runs_executionId_stepKey_key" ON "onboarding_step_runs"("executionId", "stepKey");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_step_runs_organizationId_id_key" ON "onboarding_step_runs"("organizationId", "id");

-- CreateIndex
CREATE INDEX "onboarding_execution_events_executionId_createdAt_idx" ON "onboarding_execution_events"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "onboarding_execution_events_organizationId_createdAt_idx" ON "onboarding_execution_events"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "onboarding_executions" ADD CONSTRAINT "onboarding_executions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_executions" ADD CONSTRAINT "onboarding_executions_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "clients"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_executions" ADD CONSTRAINT "onboarding_executions_organizationId_templateId_fkey" FOREIGN KEY ("organizationId", "templateId") REFERENCES "onboarding_templates"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "onboarding_executions" ADD CONSTRAINT "onboarding_executions_organizationId_versionId_fkey" FOREIGN KEY ("organizationId", "versionId") REFERENCES "onboarding_template_versions"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "onboarding_step_runs" ADD CONSTRAINT "onboarding_step_runs_organizationId_executionId_versionId_fkey" FOREIGN KEY ("organizationId", "executionId", "versionId") REFERENCES "onboarding_executions"("organizationId", "id", "versionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_step_runs" ADD CONSTRAINT "onboarding_step_runs_versionId_stepKey_fkey" FOREIGN KEY ("versionId", "stepKey") REFERENCES "onboarding_step_definitions"("versionId", "stepKey") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "onboarding_execution_events" ADD CONSTRAINT "onboarding_execution_events_organizationId_executionId_fkey" FOREIGN KEY ("organizationId", "executionId") REFERENCES "onboarding_executions"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "integration_connections_organizationId_provider_externalSc_key" RENAME TO "integration_connections_organizationId_provider_externalSco_key";

-- RenameIndex
ALTER INDEX "organization_invitations_organizationId_organizationMemberId_ke" RENAME TO "organization_invitations_organizationId_organizationMemberI_key";


-- ---------------------------------------------------------------------------
-- Regras no banco (nao expressas pelo Prisma). NAO REMOVER: um `prisma migrate diff` futuro
-- vai listar estes objetos como diferenca em relacao ao schema.prisma (DEC-F7-007, item 4).
-- ---------------------------------------------------------------------------

-- B2: no maximo UMA execucao ATIVA por (organizacao, cliente, modelo), inclusive sob concorrencia.
CREATE UNIQUE INDEX "onboarding_executions_one_active_per_client_template"
  ON "onboarding_executions"("organizationId", "clientId", "templateId") WHERE "status" = 'ACTIVE';

-- Coerencia dos estados
ALTER TABLE "onboarding_executions"
  ADD CONSTRAINT "onboarding_executions_completed_coherent" CHECK (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL)),
  ADD CONSTRAINT "onboarding_executions_cancelled_coherent" CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)),
  ADD CONSTRAINT "onboarding_executions_cancel_reason" CHECK ("status" <> 'CANCELLED' OR ("cancelReason" IS NOT NULL AND length(btrim("cancelReason")) >= 3)),
  ADD CONSTRAINT "onboarding_executions_completion_mode" CHECK (
    ("completionMode" IS NULL OR "completionMode" IN ('AUTO', 'EARLY'))
    AND ("status" <> 'COMPLETED' OR "completionMode" IS NOT NULL)
  );

ALTER TABLE "onboarding_step_runs"
  ADD CONSTRAINT "onboarding_runs_done_has_completed_at" CHECK ("status" <> 'DONE' OR "completedAt" IS NOT NULL),
  ADD CONSTRAINT "onboarding_runs_skipped_has_reason" CHECK ("status" <> 'SKIPPED' OR ("skipReason" IS NOT NULL AND length(btrim("skipReason")) >= 3)),
  ADD CONSTRAINT "onboarding_runs_blocked_has_reason" CHECK (NOT "blocked" OR ("blockedReason" IS NOT NULL AND length(btrim("blockedReason")) >= 3)),
  ADD CONSTRAINT "onboarding_runs_closed_not_blocked" CHECK (NOT ("blocked" AND "status" IN ('DONE', 'SKIPPED', 'CANCELLED'))),
  ADD CONSTRAINT "onboarding_runs_released_when_active" CHECK ("status" NOT IN ('READY', 'IN_PROGRESS', 'DONE') OR "releasedAt" IS NOT NULL);

-- INSERT de execucao: so versao PUBLICADA do proprio modelo, nascendo ATIVA.
CREATE OR REPLACE FUNCTION onboarding_guard_execution_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status "OnboardingVersionStatus";
  v_template text;
BEGIN
  SELECT "status", "templateId" INTO v_status, v_template
    FROM "onboarding_template_versions" WHERE "id" = NEW."versionId";
  IF NOT FOUND OR v_status <> 'PUBLISHED' OR v_template <> NEW."templateId" THEN
    RAISE EXCEPTION 'onboarding_execution_version_invalid: a execucao exige versao publicada do proprio modelo'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'onboarding_execution_version_invalid: a execucao nasce ativa'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "onboarding_executions_guard_insert"
  BEFORE INSERT ON "onboarding_executions"
  FOR EACH ROW EXECUTE FUNCTION onboarding_guard_execution_insert();

-- UPDATE de execucao: cliente, modelo, versao e origem imutaveis; encerrada nao muda;
-- encerrar so sem etapa aberta (nenhuma etapa aberta em execucao COMPLETED/CANCELLED).
CREATE OR REPLACE FUNCTION onboarding_guard_execution_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."clientId" IS DISTINCT FROM OLD."clientId"
     OR NEW."templateId" IS DISTINCT FROM OLD."templateId"
     OR NEW."versionId" IS DISTINCT FROM OLD."versionId"
     OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
     OR NEW."startTrigger" IS DISTINCT FROM OLD."startTrigger"
     OR NEW."sourceRef" IS DISTINCT FROM OLD."sourceRef"
     OR NEW."requestId" IS DISTINCT FROM OLD."requestId"
     OR NEW."startedByUserId" IS DISTINCT FROM OLD."startedByUserId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'onboarding_execution_immutable: cliente, modelo, versao e origem da execucao sao imutaveis'
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'onboarding_execution_closed: execucao encerrada nao pode ser alterada'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" IN ('COMPLETED', 'CANCELLED') AND EXISTS (
    SELECT 1 FROM "onboarding_step_runs"
    WHERE "executionId" = OLD."id" AND "status" IN ('WAITING', 'READY', 'IN_PROGRESS')
  ) THEN
    RAISE EXCEPTION 'onboarding_execution_open_steps: nenhuma etapa pode ficar aberta em execucao encerrada'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "onboarding_executions_guard_update"
  BEFORE UPDATE ON "onboarding_executions"
  FOR EACH ROW EXECUTE FUNCTION onboarding_guard_execution_update();

-- DELETE de execucao: so quando a organizacao ou o cliente ja nao existem (cascata); historico protegido.
CREATE OR REPLACE FUNCTION onboarding_guard_execution_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "organizations" WHERE "id" = OLD."organizationId")
     AND EXISTS (SELECT 1 FROM "clients" WHERE "id" = OLD."clientId") THEN
    RAISE EXCEPTION 'onboarding_execution_history_protected: o historico da execucao nao pode ser apagado'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "onboarding_executions_guard_delete"
  BEFORE DELETE ON "onboarding_executions"
  FOR EACH ROW EXECUTE FUNCTION onboarding_guard_execution_delete();

-- Etapas em execucao: identidade imutavel; so mudam com a execucao ATIVA; etapa encerrada nao reabre (P5).
CREATE OR REPLACE FUNCTION onboarding_guard_step_run() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status "OnboardingExecutionStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "onboarding_executions" WHERE "id" = OLD."executionId") THEN
      RAISE EXCEPTION 'onboarding_execution_history_protected: o historico da execucao nao pode ser apagado'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  SELECT "status" INTO v_status FROM "onboarding_executions" WHERE "id" = NEW."executionId";
  IF TG_OP = 'INSERT' THEN
    IF NOT FOUND OR v_status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'onboarding_execution_closed: etapas so entram em execucao ativa'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."executionId" IS DISTINCT FROM OLD."executionId"
     OR NEW."versionId" IS DISTINCT FROM OLD."versionId"
     OR NEW."stepKey" IS DISTINCT FROM OLD."stepKey"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'onboarding_execution_immutable: identidade da etapa em execucao e imutavel'
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT FOUND OR v_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'onboarding_execution_closed: execucao encerrada nao pode ser alterada'
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" IN ('DONE', 'SKIPPED', 'CANCELLED') THEN
    RAISE EXCEPTION 'onboarding_step_closed: etapa encerrada nao pode ser alterada ou reaberta'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "onboarding_step_runs_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "onboarding_step_runs"
  FOR EACH ROW EXECUTE FUNCTION onboarding_guard_step_run();

-- Eventos: append-only. DELETE so em cascata (execucao ja removida).
CREATE OR REPLACE FUNCTION onboarding_guard_execution_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'onboarding_event_append_only: eventos nao podem ser alterados'
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM "onboarding_executions" WHERE "id" = OLD."executionId") THEN
    RAISE EXCEPTION 'onboarding_event_append_only: eventos nao podem ser apagados'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "onboarding_execution_events_guard"
  BEFORE UPDATE OR DELETE ON "onboarding_execution_events"
  FOR EACH ROW EXECUTE FUNCTION onboarding_guard_execution_event();
