-- ============================================================================
-- SCRIPT DE CORREÇÃO DE PERMISSÕES (Leitura de Perfil)
-- ============================================================================

-- Problema: Se você não consegue ler seu próprio perfil, o sistema acha que você não é Admin.
-- Este script garante que qualquer usuário logado possa ler seus próprios dados (role, nome, etc).

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
USING ( id = auth.uid() );

-- Verifica se a política foi criada
SELECT tablename, policyname, cmd, qual 
FROM pg_policies 
WHERE tablename = 'profiles';
