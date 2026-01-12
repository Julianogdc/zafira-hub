-- Este script ajusta apenas a tabela de perfis para garantir que as colunas existam.
-- Rode este script para corrigir o erro de carregamento dos agentes.

DO $$
BEGIN
    -- Adicionar coluna 'role' se não existir
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'role') THEN
        ALTER TABLE public.profiles ADD COLUMN role text DEFAULT 'member';
    END IF;

    -- Adicionar coluna 'organization_id' se não existir (CRUCIAL PARA OS AGENTES)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'organization_id') THEN
        ALTER TABLE public.profiles ADD COLUMN organization_id uuid;
    END IF;
END $$;
