-- ==============================================================================
-- 1. SCHEMA UPDATES
-- ==============================================================================

-- Goals Assignment
alter table public.goals 
add column if not exists assigned_to uuid references public.profiles(id);

-- Tools Visibility
alter table public.tools 
add column if not exists visibility text default 'all'; -- 'admin', 'all', 'member'

-- ==============================================================================
-- 2. HELPER FUNCTIONS
-- ==============================================================================
-- Function to check if user is admin
create or replace function public.is_admin()
returns boolean as $$
begin
  return (select role from public.profiles where id = auth.uid()) = 'admin';
end;
$$ language plpgsql security definer;

-- Function to check if user is member
create or replace function public.is_member()
returns boolean as $$
begin
  return (select role from public.profiles where id = auth.uid()) = 'member';
end;
$$ language plpgsql security definer;

-- ==============================================================================
-- 3. RLS POLICY UPDATES (RBAC)
-- ==============================================================================

-- --- FINANCE (Admin Only) ---
drop policy if exists "Org Members can CRUD finance transactions" on public.finance_transactions;
create policy "Admins can CRUD finance transactions" on public.finance_transactions for all using (
  public.is_admin()
);

drop policy if exists "Org Members can CRUD finance categories" on public.finance_categories;
create policy "Admins can CRUD finance categories" on public.finance_categories for all using (
  public.is_admin()
);

-- --- CLIENTS (Admin + Owner) ---
-- Admins see all. Members see only what they own.
drop policy if exists "Org Members can CRUD clients" on public.clients;
create policy "Admins and Owners can CRUD clients" on public.clients for all using (
  public.is_admin() OR auth.uid() = owner_id
);

-- --- LEADS (Admin + Owner) ---
drop policy if exists "Org Members can CRUD leads" on public.leads;
create policy "Admins and Owners can CRUD leads" on public.leads for all using (
  public.is_admin() OR auth.uid() = owner_id
);

-- --- GOALS (Admin + Assigned + Owner) ---
drop policy if exists "Org Members can CRUD goals" on public.goals;
create policy "Admins, Owners, and Assigned can CRUD goals" on public.goals for all using (
  public.is_admin() OR auth.uid() = owner_id OR auth.uid() = assigned_to
);

-- --- TOOLS (Visibility Based) ---
drop policy if exists "Org Members can CRUD tools" on public.tools;
-- Read: Admin sees all. Members see 'all' or 'member'.
create policy "Users can view appropriate tools" on public.tools for select using (
  public.is_admin() OR 
  (visibility = 'all' OR visibility = 'member')
);
-- Write: Only Admins can create/edit/delete tools.
create policy "Admins can manage tools" on public.tools for insert with check (public.is_admin());
create policy "Admins can update tools" on public.tools for update using (public.is_admin());
create policy "Admins can delete tools" on public.tools for delete using (public.is_admin());
