-- ============================================================================
-- SCRIPT COMPLETO DE CORREÇÃO (Admin + Perfis + Gatilhos)
-- Rode este script ÚNICO para resolver o erro "column status does not exist" e "missing user".
-- ============================================================================

-- PARTE 1: Garantir que as colunas existem na tabela PROFILES
-- Isso corrige o erro: column "status" of relation "profiles" does not exist
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS last_seen timestamptz DEFAULT now(),
ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

-- PARTE 2: Atualizar Permissões (RLS) para o Admin funcionar
-- Permite que Admins vejam e editem qualquer perfil
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
ON public.profiles FOR SELECT
USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Admins can update all profiles"
ON public.profiles FOR UPDATE
USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

-- Garante que o usuário possa atualizar seu próprio "visto por último"
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
USING ( id = auth.uid() );

-- PARTE 3: Criar o Gatilho Automático (Para novos usuários)
-- Isso garante que usuários criados no futuro apareçam automaticamente
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, role, status, organization_id, email, last_seen)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url',
    'member', 
    'active', 
    NULL,     
    new.email, 
    now()
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- PARTE 4: Correção Retroativa (Para o usuário que já existe e sumiu)
-- Verifica quem está na tabela de login (auth.users) mas não tem Perfil, e cria agora.
INSERT INTO public.profiles (id, email, role, status, last_seen)
SELECT 
    id, 
    email, 
    'member', 
    'active', 
    now() 
FROM auth.users 
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;
