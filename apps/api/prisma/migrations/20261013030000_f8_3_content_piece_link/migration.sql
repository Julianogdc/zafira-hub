-- ---------------------------------------------------------------------------
-- F8-3 (DEC-F8-007, D3): vinculo conteudo <-> peca de Entregas.
--   * uma peca de Entregas por conteudo (indice unico parcial);
--   * a peca vinculada pertence a mesma organizacao e ao mesmo cliente do conteudo (gatilho).
-- Regras no banco (nao expressas pelo Prisma). NAO REMOVER: um `prisma migrate diff` futuro
-- vai listar estes objetos como diferenca em relacao ao schema.prisma.
-- ---------------------------------------------------------------------------

-- Verificacao previa: se houver vinculos duplicados ou inconsistentes, a migration PARA sem alterar
-- nenhum registro. A correcao de dados existentes exige decisao do proprietario (nada e apagado aqui).
DO $$
DECLARE
  duplicados integer;
  inconsistentes integer;
BEGIN
  SELECT count(*) INTO duplicados FROM (
    SELECT "deliverablePieceId" FROM "content_items"
    WHERE "deliverablePieceId" IS NOT NULL
    GROUP BY "deliverablePieceId" HAVING count(*) > 1
  ) d;
  IF duplicados > 0 THEN
    RAISE EXCEPTION 'f8_3_precheck: % peca(s) de Entregas com mais de um conteudo vinculado. Nada foi alterado.', duplicados
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO inconsistentes FROM "content_items" c
  WHERE c."deliverablePieceId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "deliverable_pieces" p
    JOIN "deliverable_items" i ON i."id" = p."itemId" AND i."organizationId" = p."organizationId"
    JOIN "deliverable_plans" pl ON pl."id" = i."planId" AND pl."organizationId" = i."organizationId"
    WHERE p."id" = c."deliverablePieceId" AND p."organizationId" = c."organizationId" AND pl."clientId" = c."clientId"
  );
  IF inconsistentes > 0 THEN
    RAISE EXCEPTION 'f8_3_precheck: % conteudo(s) vinculado(s) a peca de outra organizacao, de outro cliente ou inexistente. Nada foi alterado.', inconsistentes
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Uma peca de Entregas por conteudo (so quando ha vinculo)
CREATE UNIQUE INDEX "content_items_one_per_deliverable_piece"
  ON "content_items"("deliverablePieceId") WHERE "deliverablePieceId" IS NOT NULL;

-- Peca da mesma organizacao e do mesmo cliente, na criacao e na alteracao do vinculo
CREATE OR REPLACE FUNCTION content_items_piece_scope_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."deliverablePieceId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."deliverablePieceId" IS NOT DISTINCT FROM OLD."deliverablePieceId" THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "deliverable_pieces" p
    JOIN "deliverable_items" i ON i."id" = p."itemId" AND i."organizationId" = p."organizationId"
    JOIN "deliverable_plans" pl ON pl."id" = i."planId" AND pl."organizationId" = i."organizationId"
    WHERE p."id" = NEW."deliverablePieceId" AND p."organizationId" = NEW."organizationId" AND pl."clientId" = NEW."clientId"
  ) THEN
    RAISE EXCEPTION 'content_piece_scope: a peca de Entregas deve ser da mesma organizacao e do mesmo cliente do conteudo'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "content_items_piece_scope"
  BEFORE INSERT OR UPDATE OF "deliverablePieceId" ON "content_items"
  FOR EACH ROW EXECUTE FUNCTION content_items_piece_scope_guard();
