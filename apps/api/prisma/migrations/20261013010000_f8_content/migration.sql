-- CreateEnum
CREATE TYPE "ContentFormat" AS ENUM ('FEED_IMAGE', 'CAROUSEL', 'REEL', 'STORY');

-- CreateEnum
CREATE TYPE "ContentMediaKind" AS ENUM ('IMAGE', 'VIDEO');

-- DropIndex

-- CreateTable
CREATE TABLE "content_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "format" "ContentFormat" NOT NULL,
    "asanaTaskGid" TEXT,
    "deliverablePieceId" TEXT,
    "createdByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL,
    "sentForApprovalAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_media" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "ContentMediaKind" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedByUserId" TEXT,

    CONSTRAINT "content_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "versionId" TEXT,
    "type" TEXT NOT NULL,
    "actorUserId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_items_organizationId_clientId_idx" ON "content_items"("organizationId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "content_items_organizationId_id_key" ON "content_items"("organizationId", "id");

-- CreateIndex
CREATE INDEX "content_versions_organizationId_idx" ON "content_versions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "content_versions_itemId_number_key" ON "content_versions"("itemId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "content_versions_organizationId_id_key" ON "content_versions"("organizationId", "id");

-- CreateIndex
CREATE INDEX "content_media_organizationId_idx" ON "content_media"("organizationId");

-- CreateIndex
CREATE INDEX "content_media_versionId_idx" ON "content_media"("versionId");

-- CreateIndex
CREATE INDEX "content_events_organizationId_idx" ON "content_events"("organizationId");

-- CreateIndex
CREATE INDEX "content_events_itemId_createdAt_idx" ON "content_events"("itemId", "createdAt");

-- RenameForeignKey

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "clients"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_media" ADD CONSTRAINT "content_media_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_media" ADD CONSTRAINT "content_media_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_media" ADD CONSTRAINT "content_media_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "content_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_events" ADD CONSTRAINT "content_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_events" ADD CONSTRAINT "content_events_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Regras no banco (nao expressas pelo Prisma). NAO REMOVER: um `prisma migrate diff` futuro
-- vai listar estes objetos como diferenca em relacao ao schema.prisma.
-- F8-1 (DEC-F8-003, D2/P28): conteudo, versoes, arquivos e historico nunca sao apagados nem reescritos.
-- ---------------------------------------------------------------------------

-- Uma versao ativa por tarefa do Asana e cliente (evita peca duplicada); so quando ha vinculo
CREATE UNIQUE INDEX "content_items_one_per_asana_task"
  ON "content_items"("organizationId", "clientId", "asanaTaskGid") WHERE "asanaTaskGid" IS NOT NULL;

-- Posicao unica entre os arquivos ativos de uma versao
CREATE UNIQUE INDEX "content_media_active_position"
  ON "content_media"("versionId", "position") WHERE "removedAt" IS NULL;

ALTER TABLE "content_media"
  ADD CONSTRAINT "content_media_size_positive" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 104857600),
  ADD CONSTRAINT "content_media_position_nonnegative" CHECK ("position" >= 0),
  ADD CONSTRAINT "content_media_sha256_shape" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_number_positive" CHECK ("number" >= 1);

-- Nada e apagado: DELETE so e aceito quando a organizacao inteira ja foi removida (remocao de tenant, tratada na P28)
CREATE OR REPLACE FUNCTION content_block_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "organizations" WHERE "id" = OLD."organizationId") THEN
    RAISE EXCEPTION 'content_history_protected: conteudo, versoes, arquivos e historico nao podem ser apagados'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "content_items_no_delete" BEFORE DELETE ON "content_items" FOR EACH ROW EXECUTE FUNCTION content_block_delete();
CREATE TRIGGER "content_versions_no_delete" BEFORE DELETE ON "content_versions" FOR EACH ROW EXECUTE FUNCTION content_block_delete();
CREATE TRIGGER "content_media_no_delete" BEFORE DELETE ON "content_media" FOR EACH ROW EXECUTE FUNCTION content_block_delete();
CREATE TRIGGER "content_events_no_delete" BEFORE DELETE ON "content_events" FOR EACH ROW EXECUTE FUNCTION content_block_delete();

-- Eventos: somente acrescentar
CREATE OR REPLACE FUNCTION content_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'content_events_append_only: o historico de conteudo so aceita novos eventos'
    USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER "content_events_no_update" BEFORE UPDATE ON "content_events" FOR EACH ROW EXECUTE FUNCTION content_events_append_only();

-- Item: identidade imutavel (organizacao, cliente)
CREATE OR REPLACE FUNCTION content_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."clientId" IS DISTINCT FROM OLD."clientId" THEN
    RAISE EXCEPTION 'content_items_immutable: organizacao e cliente do conteudo sao imutaveis'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "content_items_guard_update" BEFORE UPDATE ON "content_items" FOR EACH ROW EXECUTE FUNCTION content_items_guard();

-- Versao: depois de enviada para aprovacao (F8-2) legenda e hash sao imutaveis; numero e item sempre
CREATE OR REPLACE FUNCTION content_versions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."itemId" IS DISTINCT FROM OLD."itemId" OR NEW."number" IS DISTINCT FROM OLD."number"
     OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
    RAISE EXCEPTION 'content_versions_immutable: identidade da versao e imutavel' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."sentForApprovalAt" IS NOT NULL AND (
       NEW."caption" IS DISTINCT FROM OLD."caption"
    OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
    OR NEW."sentForApprovalAt" IS DISTINCT FROM OLD."sentForApprovalAt") THEN
    RAISE EXCEPTION 'content_versions_frozen: versao enviada para aprovacao nao pode ser alterada' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "content_versions_guard_update" BEFORE UPDATE ON "content_versions" FOR EACH ROW EXECUTE FUNCTION content_versions_guard();

-- Arquivo: identidade e conteudo imutaveis; so a remocao logica (removedAt) muda, e nunca em versao congelada;
-- nao e possivel acrescentar arquivo a versao congelada.
CREATE OR REPLACE FUNCTION content_media_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE frozen timestamp;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "sentForApprovalAt" INTO frozen FROM "content_versions" WHERE "id" = NEW."versionId";
    IF frozen IS NOT NULL THEN
      RAISE EXCEPTION 'content_versions_frozen: versao enviada para aprovacao nao aceita novos arquivos' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."itemId" IS DISTINCT FROM OLD."itemId"
     OR NEW."versionId" IS DISTINCT FROM OLD."versionId" OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
     OR NEW."storageKey" IS DISTINCT FROM OLD."storageKey" OR NEW."mimeType" IS DISTINCT FROM OLD."mimeType"
     OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes" OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."position" IS DISTINCT FROM OLD."position" OR NEW."originalFilename" IS DISTINCT FROM OLD."originalFilename" THEN
    RAISE EXCEPTION 'content_media_immutable: o arquivo registrado e imutavel' USING ERRCODE = 'P0001';
  END IF;
  SELECT "sentForApprovalAt" INTO frozen FROM "content_versions" WHERE "id" = OLD."versionId";
  IF frozen IS NOT NULL AND (NEW."removedAt" IS DISTINCT FROM OLD."removedAt") THEN
    RAISE EXCEPTION 'content_versions_frozen: versao enviada para aprovacao nao permite remover arquivos' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "content_media_guard_write" BEFORE INSERT OR UPDATE ON "content_media" FOR EACH ROW EXECUTE FUNCTION content_media_guard();
