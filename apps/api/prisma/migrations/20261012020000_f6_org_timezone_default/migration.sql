-- F6-IMP.9 - Fuso padrao da organizacao (DEC-F6-005)
-- Novas configuracoes passam a nascer em America/Sao_Paulo. Linhas existentes NAO sao alteradas.

-- AlterTable
ALTER TABLE "organization_configs" ALTER COLUMN "timezone" SET DEFAULT 'America/Sao_Paulo';
