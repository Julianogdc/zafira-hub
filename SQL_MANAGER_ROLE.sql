-- ============================================================================
-- SCRIPT DE PERMISSÕES PARA SÓCIOS (MANAGER LEVEL)
-- ============================================================================

-- Objetivo: Dar poderes de Leitura e Escrita para 'manager' nas áreas de negócio,
-- mas SEM dar poder de Admin total (como excluir usuários).

-- 1. Função Helper para checar se é Manager ou Admin
CREATE OR REPLACE FUNCTION public.is_manager_or_admin()
RETURNS boolean AS $$
BEGIN
  RETURN (
    SELECT role FROM public.profiles WHERE id = auth.uid()
  ) IN ('admin', 'manager');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Atualizar Políticas de FINANÇAS
-- Removemos a restrição "Só Admin" e liberamos para "Admin ou Manager"

DROP POLICY IF EXISTS "Admins can CRUD finance transactions" ON public.finance_transactions;
CREATE POLICY "Admins and Managers can CRUD finance" 
ON public.finance_transactions FOR ALL 
USING ( public.is_manager_or_admin() );

DROP POLICY IF EXISTS "Admins can CRUD finance categories" ON public.finance_categories;
CREATE POLICY "Admins and Managers can CRUD categories" 
ON public.finance_categories FOR ALL 
USING ( public.is_manager_or_admin() );

-- 3. Atualizar Políticas de CLIENTES e LEADS
-- Manager vê tudo (igual Admin), Membro vê só o que é dono.

DROP POLICY IF EXISTS "Admins and Owners can CRUD clients" ON public.clients;
CREATE POLICY "Managers, Admins and Owners can CRUD clients" 
ON public.clients FOR ALL 
USING (
  public.is_manager_or_admin() OR auth.uid() = owner_id
);

DROP POLICY IF EXISTS "Admins and Owners can CRUD leads" ON public.leads;
CREATE POLICY "Managers, Admins and Owners can CRUD leads" 
ON public.leads FOR ALL 
USING (
  public.is_manager_or_admin() OR auth.uid() = owner_id
);

-- 4. Atualizar Políticas de METAS (Goals)
DROP POLICY IF EXISTS "Admins, Owners, and Assigned can CRUD goals" ON public.goals;
CREATE POLICY "Managers, Admins, Owners, Assigned CRUD goals" 
ON public.goals FOR ALL 
USING (
  public.is_manager_or_admin() OR auth.uid() = owner_id OR auth.uid() = assigned_to
);

-- 5. Atualizar Políticas de FERRAMENTAS (Tools)
-- Manager pode ver tudo (mesmo se visibilidade for 'admin'?), vamos assumir que sim.
-- Mas só Admin pode criar/excluir ferramentas.

DROP POLICY IF EXISTS "Users can view appropriate tools" ON public.tools;
CREATE POLICY "Users can view appropriate tools" 
ON public.tools FOR SELECT 
USING (
  public.is_manager_or_admin() OR 
  (visibility = 'all' OR visibility = 'member')
);

-- Nota: PROFILES (Usuários) não alteramos. 
-- A política "Nuclear" de leitura já permite que Manager veja a lista de usuários (para atribuir tarefas),
-- mas a política de UPDATE/DELETE continua restrita a 'admin' apenas.
