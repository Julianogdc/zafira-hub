-- F8-5a (DEC-F8-029, D-F85-1): metricas organicas do post publicado, somente acrescentar.
-- fetchedAt = consulta do Hub; capturedAt = coleta do provedor. Consulta sem captured_at nao grava linha.

-- AlterTable
ALTER TABLE "content_publications" ADD COLUMN     "metricsCheckedAt" TIMESTAMP(3),
ADD COLUMN     "metricsLastOutcome" TEXT,
ADD COLUMN     "metricsLastReason" TEXT;

-- CreateTable
CREATE TABLE "content_publication_metrics" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "reach" INTEGER,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "saves" INTEGER,
    "shares" INTEGER,
    "engagementPct" DOUBLE PRECISION,
    "metricKinds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_publication_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_publication_metrics_organizationId_publicationId_idx" ON "content_publication_metrics"("organizationId", "publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "content_publication_metrics_publicationId_capturedAt_key" ON "content_publication_metrics"("publicationId", "capturedAt");

-- AddForeignKey
ALTER TABLE "content_publication_metrics" ADD CONSTRAINT "content_publication_metrics_organizationId_publicationId_fkey" FOREIGN KEY ("organizationId", "publicationId") REFERENCES "content_publications"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Valores nunca negativos (ausencia e NULL, nunca 0 fabricado)
ALTER TABLE "content_publication_metrics" ADD CONSTRAINT "content_publication_metrics_non_negative" CHECK (
  ("reach" IS NULL OR "reach" >= 0) AND ("views" IS NULL OR "views" >= 0) AND ("likes" IS NULL OR "likes" >= 0)
  AND ("comments" IS NULL OR "comments" >= 0) AND ("saves" IS NULL OR "saves" >= 0) AND ("shares" IS NULL OR "shares" >= 0)
  AND ("engagementPct" IS NULL OR "engagementPct" >= 0)
);

-- So publicacao confirmada (PUBLISHED) recebe coleta
CREATE OR REPLACE FUNCTION content_publication_metrics_guard_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "content_publications" p
    WHERE p."id" = NEW."publicationId" AND p."organizationId" = NEW."organizationId" AND p."state" = 'PUBLISHED'
  ) THEN
    RAISE EXCEPTION 'publication_metrics_requires_published: metricas so de publicacao confirmada'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "content_publication_metrics_insert_guard"
  BEFORE INSERT ON "content_publication_metrics"
  FOR EACH ROW EXECUTE FUNCTION content_publication_metrics_guard_insert();

-- Historico nao e reescrito: sem UPDATE; DELETE so com a organizacao ja removida (mesma regra da F8-1/F8-4a)
CREATE OR REPLACE FUNCTION content_publication_metrics_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'publication_metrics_append_only: coletas de metricas nao podem ser alteradas'
    USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER "content_publication_metrics_no_update" BEFORE UPDATE ON "content_publication_metrics" FOR EACH ROW EXECUTE FUNCTION content_publication_metrics_append_only();
CREATE TRIGGER "content_publication_metrics_no_delete" BEFORE DELETE ON "content_publication_metrics" FOR EACH ROW EXECUTE FUNCTION content_block_delete();
