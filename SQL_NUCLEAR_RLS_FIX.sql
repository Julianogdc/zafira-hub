-- ============================================================================
-- SCRIPT NUCLEAR DE CORREÇÃO DE PERMISSÕES (RLS RESET)
-- ============================================================================

-- AVISO: Este script remove políticas antigas que podem estar conflitando
-- e cria uma política SIMPLES que permite leitura para todos os usuários logados.

-- 1. Habilitar RLS (garantia)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2. Remover TODAS as políticas conhecidas (para limpar conflitos)
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;

-- 3. CRIAR POLÍTICAS LIMPAS

-- LEITURA: Qualquer usuário logado pode ver todos os perfis (Necessário para listar usuários no select, ver times, etc)
-- Se isso falhar, o AuthStore não consegue saber quem você é.
CREATE POLICY " authenticated_read_all_profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

-- ATUALIZAÇÃO (PRÓPRIO USUÁRIO): Pode editar seus dados
CREATE POLICY "users_update_own"
ON public.profiles FOR UPDATE
TO authenticated
USING (id = auth.uid());

-- ATUALIZAÇÃO (ADMIN): Pode editar qualquer um (usando a função segura is_admin)
-- Se is_admin() não existir, crie ou use a lógica direta aqui.
-- Vamos usar lógica direta para não depender da função:
CREATE POLICY "admins_update_all"
ON public.profiles FOR UPDATE
TO authenticated
USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

-- INSERÇÃO: Gatilhos já fazem isso, mas se precisar via API:
CREATE POLICY "users_insert_own"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

-- Verifique as políticas atuais
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'profiles';
