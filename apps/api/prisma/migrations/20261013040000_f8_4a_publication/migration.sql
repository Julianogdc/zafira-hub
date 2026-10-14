-- F8-4a (DEC-F8-023): publicacao da versao aprovada via caixa de saida transacional. Piloto: Instagram.

-- CreateEnum
CREATE TYPE "PublicationState" AS ENUM ('PENDING', 'DRAFTED', 'SCHEDULED', 'PROVIDER_RETRY', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "PublicationOutboxKind" AS ENUM ('PUBLISH', 'RESCHEDULE', 'CANCEL');

-- CreateEnum
CREATE TYPE "PublicationOutboxStatus" AS ENUM ('PENDING', 'RETRYING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "content_publications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "state" "PublicationState" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "externalPostId" TEXT,
    "remoteMediaIds" JSONB,
    "platformPostId" TEXT,
    "permalink" TEXT,
    "publishedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_outbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "kind" "PublicationOutboxKind" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB,
    "status" "PublicationOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publication_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_publications_organizationId_itemId_idx" ON "content_publications"("organizationId", "itemId");

-- CreateIndex
CREATE INDEX "content_publications_state_idx" ON "content_publications"("state");

-- CreateIndex
CREATE UNIQUE INDEX "content_publications_organizationId_id_key" ON "content_publications"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "publication_outbox_idempotencyKey_key" ON "publication_outbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "publication_outbox_status_nextAttemptAt_idx" ON "publication_outbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "publication_outbox_publicationId_idx" ON "publication_outbox"("publicationId");

-- AddForeignKey
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "clients"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "content_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_outbox" ADD CONSTRAINT "publication_outbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_outbox" ADD CONSTRAINT "publication_outbox_organizationId_publicationId_fkey" FOREIGN KEY ("organizationId", "publicationId") REFERENCES "content_publications"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Regras no banco (nao expressas pelo Prisma). NAO REMOVER: um `prisma migrate diff` futuro
-- vai listar estes objetos como diferenca em relacao ao schema.prisma.
-- ---------------------------------------------------------------------------

-- Uma publicacao ativa por versao + conta social (cancelada ou falha liberam a vaga)
CREATE UNIQUE INDEX "content_publications_one_active_per_version_account"
  ON "content_publications"("versionId", "socialAccountId")
  WHERE "state" NOT IN ('CANCELLED', 'FAILED');

-- So a versao ATUAL do conteudo, com decisao APPROVED do cliente sobre o mesmo contentHash
CREATE OR REPLACE FUNCTION content_publications_guard_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "content_versions" v
    JOIN "content_items" i ON i."id" = v."itemId"
    JOIN "approval_decisions" d ON d."versionId" = v."id"
    WHERE v."id" = NEW."versionId"
      AND v."itemId" = NEW."itemId"
      AND i."organizationId" = NEW."organizationId"
      AND i."clientId" = NEW."clientId"
      AND d."decision" = 'APPROVED'
      AND d."contentHashAtDecision" = v."contentHash"
  ) THEN
    RAISE EXCEPTION 'publication_requires_approved_version: so a versao aprovada pelo cliente pode ser agendada'
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "content_versions" v2
    WHERE v2."itemId" = NEW."itemId"
      AND v2."number" > (SELECT v."number" FROM "content_versions" v WHERE v."id" = NEW."versionId")
  ) THEN
    RAISE EXCEPTION 'publication_requires_current_version: existe versao mais nova que a aprovada'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "content_publications_insert_guard"
  BEFORE INSERT ON "content_publications"
  FOR EACH ROW EXECUTE FUNCTION content_publications_guard_insert();

-- Identidade imutavel (organizacao, cliente, conteudo, versao, conta e rede)
CREATE OR REPLACE FUNCTION content_publications_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."clientId" IS DISTINCT FROM OLD."clientId"
     OR NEW."itemId" IS DISTINCT FROM OLD."itemId"
     OR NEW."versionId" IS DISTINCT FROM OLD."versionId"
     OR NEW."socialAccountId" IS DISTINCT FROM OLD."socialAccountId"
     OR NEW."platform" IS DISTINCT FROM OLD."platform" THEN
    RAISE EXCEPTION 'content_publications_immutable: identidade da publicacao e imutavel'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "content_publications_update_guard"
  BEFORE UPDATE ON "content_publications"
  FOR EACH ROW EXECUTE FUNCTION content_publications_guard_update();

-- Nada e apagado (mesma regra do conteudo, F8-1/P28): DELETE so com a organizacao ja removida
CREATE TRIGGER "content_publications_no_delete" BEFORE DELETE ON "content_publications" FOR EACH ROW EXECUTE FUNCTION content_block_delete();
CREATE TRIGGER "publication_outbox_no_delete" BEFORE DELETE ON "publication_outbox" FOR EACH ROW EXECUTE FUNCTION content_block_delete();
