-- CreateEnum
CREATE TYPE "ApprovalDecisionKind" AS ENUM ('APPROVED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "ApprovalChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'OTHER');

-- DropIndex

-- CreateTable
CREATE TABLE "approval_links" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokeReason" TEXT,
    "recipientLabel" TEXT,
    "channel" "ApprovalChannel" NOT NULL DEFAULT 'OTHER',
    "identificationLevel" TEXT NOT NULL DEFAULT 'N1',
    "contentHashAtSend" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_decisions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "decision" "ApprovalDecisionKind" NOT NULL,
    "comment" TEXT,
    "approverName" TEXT NOT NULL,
    "approverContact" TEXT NOT NULL,
    "authorityDeclared" BOOLEAN NOT NULL,
    "channel" "ApprovalChannel" NOT NULL,
    "identificationLevel" TEXT NOT NULL,
    "contentHashAtDecision" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_links_tokenHash_key" ON "approval_links"("tokenHash");

-- CreateIndex
CREATE INDEX "approval_links_organizationId_idx" ON "approval_links"("organizationId");

-- CreateIndex
CREATE INDEX "approval_links_versionId_idx" ON "approval_links"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_decisions_versionId_key" ON "approval_decisions"("versionId");

-- CreateIndex
CREATE INDEX "approval_decisions_organizationId_idx" ON "approval_decisions"("organizationId");

-- CreateIndex
CREATE INDEX "approval_decisions_itemId_idx" ON "approval_decisions"("itemId");

-- RenameForeignKey

-- AddForeignKey
ALTER TABLE "approval_links" ADD CONSTRAINT "approval_links_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_links" ADD CONSTRAINT "approval_links_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_links" ADD CONSTRAINT "approval_links_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "content_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "content_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "approval_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Regras no banco (nao expressas pelo Prisma). NAO REMOVER: um `prisma migrate diff` futuro
-- vai listar estes objetos como diferenca em relacao ao schema.prisma.
-- F8-2 (DEC-F8-004): link de aprovacao e decisao do cliente.
-- ---------------------------------------------------------------------------

-- No maximo um link ATIVO (nao revogado) por versao: reemitir revoga o anterior na mesma transacao
CREATE UNIQUE INDEX "approval_links_one_active_per_version" ON "approval_links"("versionId") WHERE "revokedAt" IS NULL;

ALTER TABLE "approval_links"
  ADD CONSTRAINT "approval_links_validity_window" CHECK ("expiresAt" <= "createdAt" + interval '30 days' + interval '1 minute'),
  ADD CONSTRAINT "approval_links_token_hash_shape" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "approval_links_level_n1" CHECK ("identificationLevel" = 'N1');

ALTER TABLE "approval_decisions"
  ADD CONSTRAINT "approval_decisions_authority" CHECK ("authorityDeclared" IS TRUE),
  ADD CONSTRAINT "approval_decisions_comment_required" CHECK ("decision" <> 'CHANGES_REQUESTED' OR length(btrim(coalesce("comment", ''))) >= 3),
  ADD CONSTRAINT "approval_decisions_identity_filled" CHECK (length(btrim("approverName")) >= 2 AND length(btrim("approverContact")) >= 3),
  ADD CONSTRAINT "approval_decisions_level_n1" CHECK ("identificationLevel" = 'N1');

-- Link: identidade imutavel; revogacao e definitiva; a validade so pode ser ENCURTADA
CREATE OR REPLACE FUNCTION approval_links_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."itemId" IS DISTINCT FROM OLD."itemId"
     OR NEW."versionId" IS DISTINCT FROM OLD."versionId" OR NEW."tokenHash" IS DISTINCT FROM OLD."tokenHash"
     OR NEW."contentHashAtSend" IS DISTINCT FROM OLD."contentHashAtSend" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."identificationLevel" IS DISTINCT FROM OLD."identificationLevel" THEN
    RAISE EXCEPTION 'approval_links_immutable: identidade do link e imutavel' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."expiresAt" > OLD."expiresAt" THEN
    RAISE EXCEPTION 'approval_links_immutable: a validade do link nao pode ser estendida (emita um novo link)' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."revokedAt" IS NOT NULL AND (NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" OR NEW."revokedByUserId" IS DISTINCT FROM OLD."revokedByUserId" OR NEW."revokeReason" IS DISTINCT FROM OLD."revokeReason") THEN
    RAISE EXCEPTION 'approval_links_revoked: link revogado e definitivo' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "approval_links_guard_update" BEFORE UPDATE ON "approval_links" FOR EACH ROW EXECUTE FUNCTION approval_links_guard();

-- Decisao: validada NO BANCO (link ativo, da mesma versao, versao enviada e integra) e depois imutavel
CREATE OR REPLACE FUNCTION approval_decisions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE l approval_links%ROWTYPE; v content_versions%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'approval_decisions_immutable: a decisao do cliente nao pode ser alterada' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO l FROM "approval_links" WHERE "id" = NEW."linkId";
  IF NOT FOUND OR l."versionId" <> NEW."versionId" OR l."itemId" <> NEW."itemId" OR l."organizationId" <> NEW."organizationId" THEN
    RAISE EXCEPTION 'approval_link_mismatch: o link nao pertence a esta versao' USING ERRCODE = 'P0001';
  END IF;
  IF l."revokedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'approval_link_revoked: link revogado nao aceita decisao' USING ERRCODE = 'P0001';
  END IF;
  IF l."expiresAt" <= timezone('UTC', now()) THEN
    RAISE EXCEPTION 'approval_link_expired: link expirado nao aceita decisao' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v FROM "content_versions" WHERE "id" = NEW."versionId";
  IF v."sentForApprovalAt" IS NULL THEN
    RAISE EXCEPTION 'approval_version_not_sent: versao nao foi enviada para aprovacao' USING ERRCODE = 'P0001';
  END IF;
  IF v."contentHash" <> NEW."contentHashAtDecision" OR l."contentHashAtSend" <> NEW."contentHashAtDecision" THEN
    RAISE EXCEPTION 'approval_integrity: o conteudo mudou desde o envio ao cliente' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "approval_decisions_guard_write" BEFORE INSERT OR UPDATE ON "approval_decisions" FOR EACH ROW EXECUTE FUNCTION approval_decisions_guard();

-- Nada e apagado (reaproveita a funcao da F8-1: so aceita DELETE na remocao do tenant inteiro)
CREATE TRIGGER "approval_links_no_delete" BEFORE DELETE ON "approval_links" FOR EACH ROW EXECUTE FUNCTION content_block_delete();
CREATE TRIGGER "approval_decisions_no_delete" BEFORE DELETE ON "approval_decisions" FOR EACH ROW EXECUTE FUNCTION content_block_delete();
