-- F8-5p.1 (DEC-F8-031, P35): largura e altura das imagens, lidas do cabecalho do arquivo.
-- Arquivos antigos ficam nulos e sao calculados uma unica vez pelo Hub (leitura do proprio arquivo).
ALTER TABLE "content_media" ADD COLUMN "widthPx" INTEGER, ADD COLUMN "heightPx" INTEGER;
ALTER TABLE "content_media" ADD CONSTRAINT "content_media_dimensions_positive" CHECK (
  ("widthPx" IS NULL AND "heightPx" IS NULL) OR ("widthPx" > 0 AND "heightPx" > 0)
);

-- Arquivo continua imutavel: as dimensoes so podem passar de nulas para preenchidas (as duas juntas), nunca mudar depois.
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
  IF (OLD."widthPx" IS NOT NULL AND NEW."widthPx" IS DISTINCT FROM OLD."widthPx")
     OR (OLD."heightPx" IS NOT NULL AND NEW."heightPx" IS DISTINCT FROM OLD."heightPx") THEN
    RAISE EXCEPTION 'content_media_dimensions_immutable: dimensoes registradas nao podem mudar' USING ERRCODE = 'P0001';
  END IF;
  SELECT "sentForApprovalAt" INTO frozen FROM "content_versions" WHERE "id" = OLD."versionId";
  IF frozen IS NOT NULL AND (NEW."removedAt" IS DISTINCT FROM OLD."removedAt") THEN
    RAISE EXCEPTION 'content_versions_frozen: versao enviada para aprovacao nao permite remover arquivos' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
