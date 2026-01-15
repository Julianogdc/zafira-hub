-- ==============================================================================
-- SQL_FIX_VISIBILITY.sql
-- Fixes visibility issues by allowing Admins and Managers to view shared data,
-- while restricting Members to their own data.
-- ==============================================================================

-- 1. DROP POLICY (Clean slate for these tables)
-- We drop the policies we just created or any old ones ensuring no conflicts.

-- Clients
drop policy if exists "Org Members can VIEW and UPDATE clients" on public.clients;
drop policy if exists "Admins and Owners can CRUD clients" on public.clients;
drop policy if exists "Org Members can CRUD clients" on public.clients;

-- Leads
drop policy if exists "Org Members can VIEW and UPDATE leads" on public.leads;
drop policy if exists "Admins and Owners can CRUD leads" on public.leads;
drop policy if exists "Org Members can CRUD leads" on public.leads;

-- Goals
drop policy if exists "Org Members can VIEW and UPDATE goals" on public.goals;
drop policy if exists "Admins, Owners, and Assigned can CRUD goals" on public.goals;
drop policy if exists "Org Members can CRUD goals" on public.goals;


-- ==============================================================================
-- 2. CREATE NEW POLICIES (ROLE BASED SHARING)
-- ==============================================================================

-- --- CLIENTS ---
-- Access: Owner OR (Admin/Manager AND Same Org)
create policy "Org Leadership can VIEW/UPDATE, Members own" on public.clients for all using (
  auth.uid() = owner_id OR 
  (
    (select role from public.profiles where id = auth.uid()) in ('admin', 'manager') 
    AND
    exists (
      select 1 from public.profiles p_record
      join public.profiles p_auth on p_auth.organization_id = p_record.organization_id
      where p_record.id = clients.owner_id
      and p_auth.id = auth.uid()
      and p_auth.organization_id is not null
    )
  )
);

-- --- LEADS ---
-- Access: Owner OR (Admin/Manager AND Same Org)
create policy "Org Leadership can VIEW/UPDATE, Members own" on public.leads for all using (
  auth.uid() = owner_id OR 
  (
    (select role from public.profiles where id = auth.uid()) in ('admin', 'manager') 
    AND
    exists (
      select 1 from public.profiles p_record
      join public.profiles p_auth on p_auth.organization_id = p_record.organization_id
      where p_record.id = leads.owner_id
      and p_auth.id = auth.uid()
      and p_auth.organization_id is not null
    )
  )
);

-- --- GOALS ---
-- Access: Owner OR Assigned OR (Admin/Manager AND Same Org)
create policy "Org Leadership can VIEW/UPDATE, Members own/assigned" on public.goals for all using (
  auth.uid() = owner_id OR 
  auth.uid() = assigned_to OR
  (
    (select role from public.profiles where id = auth.uid()) in ('admin', 'manager') 
    AND
    exists (
      select 1 from public.profiles p_record
      join public.profiles p_auth on p_auth.organization_id = p_record.organization_id
      where p_record.id = goals.owner_id
      and p_auth.id = auth.uid()
      and p_auth.organization_id is not null
    )
  )
);

-- ==============================================================================
-- 3. STORAGE POLICIES (Implies same logic or loose for contracts?)
-- ==============================================================================
-- For now, keeping storage "Org Members" is usually safe for files, 
-- but if strictness is needed, we would need a function to check metadata, which is complex for storage.
-- We will keep storage accessible to the Org for simplicity unless requested otherwise, 
-- as contracts are usually less sensitive between members than financial data, 
-- but arguably members shouldn't see all contracts. 
-- However, storage policies without metadata reference are hard to scope to "Lead Owner".
-- We will leave storage as "Authenticated" within bucket for now (the previous policy was Org based but loosely).
-- Let's stick to the previous `Org Members` policy for storage as it's harder to scope strictly without edge functions.

