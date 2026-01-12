-- FORCE SYNC ORGANIZATION (Para Ambiente de Teste)
-- Este script vai pegar TODOS os usuários e colocá-los na mesma organização.
-- Também vai atualizar os agentes "Públicos" para pertencerem a essa organização.

DO $$
DECLARE
    target_org_id uuid;
BEGIN
    -- 1. Verifica se já existe algum ID de organização sendo usado, se não, gera um novo.
    SELECT organization_id INTO target_org_id FROM public.profiles WHERE organization_id IS NOT NULL LIMIT 1;
    
    IF target_org_id IS NULL THEN
        target_org_id := gen_random_uuid();
    END IF;

    -- 2. Atualiza TODOS os perfis para terem este ID (Unificação de Time)
    UPDATE public.profiles
    SET organization_id = target_org_id
    WHERE organization_id IS NULL OR organization_id != target_org_id;

    -- 3. Atualiza os Agentes que deveriam ser "Públicos" mas ficaram sem ID
    UPDATE public.ai_personas
    SET organization_id = target_org_id
    WHERE visibility = 'public';

    RAISE NOTICE 'Organização Sincronizada com ID: %', target_org_id;
END $$;
