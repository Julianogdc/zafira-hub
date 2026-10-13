-- F7-1a - Construtor de onboarding configuravel (DEC-F7-004 / DEC-F7-005)
-- Cria funcoes operacionais, modelos, versoes, etapas, dependencias e eventos do MODELO.
-- NENHUMA linha e inserida por esta migration (sem etapas, modelos ou funcoes ficticios).
-- Execucoes de onboarding (F7-2) NAO existem aqui.
-- Garantias no banco: unicidade (nome, versao, rascunho unico por modelo), exclusao mutua
-- funcao x pessoa, e IMUTABILIDADE das versoes PUBLICADAS por gatilho.
-- Ensaiar somente em base descartavel antes de qualquer ambiente real.

-- CreateEnum
CREATE TYPE "OnboardingTemplateScopeKind" AS ENUM ('GENERAL', 'SERVICE', 'PACKAGE', 'CLIENT_TYPE');

-- CreateEnum
CREATE TYPE "OnboardingTemplateStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OnboardingVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "OnboardingStepKind" AS ENUM ('MANUAL', 'CONFIRM_ASANA_PROJECT', 'CALENDAR_EVENT', 'AUTOMATION');

-- CreateEnum
CREATE TYPE "OnboardingAssigneeMode" AS ENUM ('NONE', 'FUNCTION', 'MEMBER');

-- CreateEnum
CREATE TYPE "OnboardingDueAnchor" AS ENUM ('START', 'RELEASED');

-- CreateEnum
CREATE TYPE "OnboardingEvidenceKind" AS ENUM ('NONE', 'LINK', 'NOTE');

-- CreateEnum
CREATE TYPE "OnboardingCompletionCondition" AS ENUM ('CONFIRMATION', 'EVIDENCE_PROVIDED', 'ASANA_PROJECT_LINKED', 'CALENDAR_EVENT_LINKED');

-- CreateTable
CREATE TABLE "organization_functions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_functions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_function_members" (
    "organizationId" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "organizationMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_function_members_pkey" PRIMARY KEY ("functionId","organizationMemberId")
);

-- CreateTable
CREATE TABLE "onboarding_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scopeKind" "OnboardingTemplateScopeKind" NOT NULL DEFAULT 'GENERAL',
    "scopeLabel" TEXT,
    "status" "OnboardingTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_template_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "OnboardingVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "changeNote" TEXT,
    "basedOnVersionId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_step_definitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "OnboardingStepKind" NOT NULL DEFAULT 'MANUAL',
    "assigneeMode" "OnboardingAssigneeMode" NOT NULL DEFAULT 'NONE',
    "functionId" TEXT,
    "memberId" TEXT,
    "dueBusinessDays" INTEGER,
    "dueAnchor" "OnboardingDueAnchor" NOT NULL DEFAULT 'RELEASED',
    "evidenceKind" "OnboardingEvidenceKind" NOT NULL DEFAULT 'NONE',
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "completionCondition" "OnboardingCompletionCondition" NOT NULL DEFAULT 'CONFIRMATION',
    "blocksCompletion" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_step_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_step_dependencies" (
    "organizationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "dependsOnStepKey" TEXT NOT NULL,

    CONSTRAINT "onboarding_step_dependencies_pkey" PRIMARY KEY ("versionId","stepKey","dependsOnStepKey")
);

-- CreateTable
CREATE TABLE "onboarding_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionId" TEXT,
    "type" TEXT NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_functions_organizationId_idx" ON "organization_functions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_functions_organizationId_id_key" ON "organization_functions"("organizationId", "id");

-- CreateIndex
CREATE INDEX "organization_function_members_organizationId_idx" ON "organization_function_members"("organizationId");

-- CreateIndex
CREATE INDEX "organization_function_members_organizationMemberId_idx" ON "organization_function_members"("organizationMemberId");

-- CreateIndex
CREATE INDEX "onboarding_templates_organizationId_idx" ON "onboarding_templates"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_templates_organizationId_id_key" ON "onboarding_templates"("organizationId", "id");

-- CreateIndex
CREATE INDEX "onboarding_template_versions_organizationId_idx" ON "onboarding_template_versions"("organizationId");

-- CreateIndex
CREATE INDEX "onboarding_template_versions_templateId_idx" ON "onboarding_template_versions"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_template_versions_organizationId_id_key" ON "onboarding_template_versions"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_template_versions_templateId_versionNumber_key" ON "onboarding_template_versions"("templateId", "versionNumber");

-- CreateIndex
CREATE INDEX "onboarding_step_definitions_organizationId_idx" ON "onboarding_step_definitions"("organizationId");

-- CreateIndex
CREATE INDEX "onboarding_step_definitions_functionId_idx" ON "onboarding_step_definitions"("functionId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_step_definitions_versionId_stepKey_key" ON "onboarding_step_definitions"("versionId", "stepKey");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_step_definitions_versionId_position_key" ON "onboarding_step_definitions"("versionId", "position");

-- CreateIndex
CREATE INDEX "onboarding_step_dependencies_organizationId_idx" ON "onboarding_step_dependencies"("organizationId");

-- CreateIndex
CREATE INDEX "onboarding_events_organizationId_templateId_createdAt_idx" ON "onboarding_events"("organizationId", "templateId", "createdAt");


-- AddForeignKey
ALTER TABLE "organization_functions" ADD CONSTRAINT "organization_functions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_function_members" ADD CONSTRAINT "organization_function_members_organizationId_functionId_fkey" FOREIGN KEY ("organizationId", "functionId") REFERENCES "organization_functions"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_function_members" ADD CONSTRAINT "organization_function_members_organizationId_organizationM_fkey" FOREIGN KEY ("organizationId", "organizationMemberId") REFERENCES "organization_members"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_template_versions" ADD CONSTRAINT "onboarding_template_versions_organizationId_templateId_fkey" FOREIGN KEY ("organizationId", "templateId") REFERENCES "onboarding_templates"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_template_versions" ADD CONSTRAINT "onboarding_template_versions_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_step_definitions" ADD CONSTRAINT "onboarding_step_definitions_organizationId_versionId_fkey" FOREIGN KEY ("organizationId", "versionId") REFERENCES "onboarding_template_versions"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- NO ACTION + DEFERRABLE INITIALLY DEFERRED (verificado so no fim da transacao): permite a remocao da organizacao em cascata
-- (qualquer ordem de remocao) e ainda impede apagar uma funcao em uso por uma etapa.
ALTER TABLE "onboarding_step_definitions" ADD CONSTRAINT "onboarding_step_definitions_organizationId_functionId_fkey" FOREIGN KEY ("organizationId", "functionId") REFERENCES "organization_functions"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
-- memberId SEM chave estrangeira: o historico de uma versao publicada (imutavel) nao pode impedir a remocao de uma pessoa da organizacao.
-- A existencia e verificada ao salvar/publicar (servico) e a pessoa ativa sera verificada na execucao (F7-2).

-- AddForeignKey
ALTER TABLE "onboarding_step_dependencies" ADD CONSTRAINT "onboarding_step_dependencies_versionId_stepKey_fkey" FOREIGN KEY ("versionId", "stepKey") REFERENCES "onboarding_step_definitions"("versionId", "stepKey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_step_dependencies" ADD CONSTRAINT "onboarding_step_dependencies_versionId_dependsOnStepKey_fkey" FOREIGN KEY ("versionId", "dependsOnStepKey") REFERENCES "onboarding_step_definitions"("versionId", "stepKey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_events" ADD CONSTRAINT "onboarding_events_organizationId_templateId_fkey" FOREIGN KEY ("organizationId", "templateId") REFERENCES "onboarding_templates"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_events" ADD CONSTRAINT "onboarding_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Regras no banco (nao expressas pelo Prisma; ver docs/propostas/F7-1_ESPECIFICACAO...)
-- ---------------------------------------------------------------------------

-- Nome unico por organizacao, sem diferenciar maiusculas
CREATE UNIQUE INDEX "organization_functions_org_lower_name_key" ON "organization_functions"("organizationId", lower("name"));
CREATE UNIQUE INDEX "onboarding_templates_org_lower_name_key" ON "onboarding_templates"("organizationId", lower("name"));

-- No maximo UM rascunho por modelo
CREATE UNIQUE INDEX "onboarding_versions_one_draft_per_template" ON "onboarding_template_versions"("templateId") WHERE "status" = 'DRAFT';

-- Coerencia dos dados
ALTER TABLE "onboarding_template_versions"
  ADD CONSTRAINT "onboarding_versions_number_positive" CHECK ("versionNumber" >= 1),
  ADD CONSTRAINT "onboarding_versions_published_has_timestamp" CHECK (("status" = 'PUBLISHED') = ("publishedAt" IS NOT NULL));

ALTER TABLE "onboarding_step_definitions"
  ADD CONSTRAINT "onboarding_steps_due_range" CHECK ("dueBusinessDays" IS NULL OR ("dueBusinessDays" >= 0 AND "dueBusinessDays" <= 365)),
  ADD CONSTRAINT "onboarding_steps_function_xor_member" CHECK (NOT ("functionId" IS NOT NULL AND "memberId" IS NOT NULL)),
  ADD CONSTRAINT "onboarding_steps_position_nonnegative" CHECK ("position" >= 0);

ALTER TABLE "onboarding_step_dependencies"
  ADD CONSTRAINT "onboarding_deps_no_self" CHECK ("stepKey" <> "dependsOnStepKey");

-- Imutabilidade: etapas e dependencias de versao PUBLICADA nao aceitam INSERT/UPDATE/DELETE.
-- Se a versao ja nao existe (remocao em cascata), a operacao e permitida.
CREATE OR REPLACE FUNCTION onboarding_guard_published_content() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status "OnboardingVersionStatus";
  v_version_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_version_id := OLD."versionId";
  ELSE
    v_version_id := NEW."versionId";
  END IF;

  SELECT "status" INTO v_status FROM "onboarding_template_versions" WHERE "id" = v_version_id;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF v_status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'onboarding_version_published_immutable: versao publicada nao pode ser alterada'
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "onboarding_steps_guard_published"
  BEFORE INSERT OR UPDATE OR DELETE ON "onboarding_step_definitions"
  FOR EACH ROW EXECUTE FUNCTION onboarding_guard_published_content();

CREATE TRIGGER "onboarding_deps_guard_published"
  BEFORE INSERT OR UPDATE OR DELETE ON "onboarding_step_dependencies"
  FOR EACH ROW EXECUTE FUNCTION onboarding_guard_published_content();

-- Versao PUBLICADA: nenhum campo muda (so publishedByUserId pode virar NULL quando o usuario
-- e removido) e ela nao pode ser apagada enquanto o modelo existir.
CREATE OR REPLACE FUNCTION onboarding_guard_published_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'PUBLISHED'
       AND EXISTS (SELECT 1 FROM "onboarding_templates" WHERE "id" = OLD."templateId") THEN
      RAISE EXCEPTION 'onboarding_version_published_immutable: versao publicada nao pode ser removida'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'PUBLISHED' THEN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."templateId" IS DISTINCT FROM OLD."templateId"
       OR NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber"
       OR NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."changeNote" IS DISTINCT FROM OLD."changeNote"
       OR NEW."basedOnVersionId" IS DISTINCT FROM OLD."basedOnVersionId"
       OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
       OR (NEW."publishedByUserId" IS DISTINCT FROM OLD."publishedByUserId" AND NEW."publishedByUserId" IS NOT NULL) THEN
      RAISE EXCEPTION 'onboarding_version_published_immutable: versao publicada nao pode ser alterada'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "onboarding_versions_guard_published"
  BEFORE UPDATE OR DELETE ON "onboarding_template_versions"
  FOR EACH ROW EXECUTE FUNCTION onboarding_guard_published_version();
