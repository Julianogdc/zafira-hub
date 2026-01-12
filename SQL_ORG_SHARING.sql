-- ==============================================================================
-- 1. UTILITY FUNCTION (Optional but cleaner, using direct subqueries for now)
-- ==============================================================================

-- ==============================================================================
-- 2. CREATE TOOLS TABLE (Migration from LocalStorage)
-- ==============================================================================
create table if not exists public.tools (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null,
  url text,
  icon text,
  category text,
  description text,
  created_at timestamptz default now()
);

alter table public.tools enable row level security;

-- ==============================================================================
-- 3. SHARED POLICIES (ORGANIZATION LEVEL)
-- ==============================================================================

-- Helper logic: Access is granted if:
-- 1. User owns the record.
-- 2. User belongs to an organization, AND the record owner belongs to the SAME organization.

-- --- CLIENTS ---
drop policy if exists "Users can CRUD their own clients" on public.clients;
create policy "Org Members can CRUD clients" on public.clients for all using (
  auth.uid() = owner_id OR 
  exists (
    select 1 from public.profiles p_record
    join public.profiles p_auth on p_auth.organization_id = p_record.organization_id
    where p_record.id = clients.owner_id
    and p_auth.id = auth.uid()
    and p_auth.organization_id is not null
  )
);

-- --- LEADS (CRM) ---
drop policy if exists "Users can CRUD their own leads" on public.leads;
create policy "Org Members can CRUD leads" on public.leads for all using (
  auth.uid() = owner_id OR 
  exists (
    select 1 from public.profiles p_record
    join public.profiles p_auth on p_auth.organization_id = p_record.organization_id
    where p_record.id = leads.owner_id
    and p_auth.id = auth.uid()
    and p_auth.organization_id is not null
  )
);

-- --- GOALS ---
drop policy if exists "Users can CRUD their own goals" on public.goals;
create policy "Org Members can CRUD goals" on public.goals for all using (
  auth.uid() = owner_id OR 
  exists (
    select 1 from public.profiles p_record
    join public.profiles p_auth on p_auth.organization_id = p_record.organization_id
    where p_record.id = goals.owner_id
    and p_auth.id = auth.uid()
    and p_auth.organization_id is not null
  )
);

-- --- FINANCE TRANSACTIONS ---
drop policy if exists "Users can CRUD their own transactions" on public.finance_transactions;
create policy "Org Members can CRUD finance transactions" on public.finance_transactions for all using (
  auth.uid() = owner_id OR 
  exists (
    select 1 from public.profiles p_record
    join public.profiles p_auth on p_auth.organization_id = p_record.organization_id
    where p_record.id = finance_transactions.owner_id
    and p_auth.id = auth.uid()
    and p_auth.organization_id is not null
  )
);

-- --- FINANCE CATEGORIES ---
drop policy if exists "Users can CRUD their own categories" on public.finance_categories;
create policy "Org Members can CRUD finance categories" on public.finance_categories for all using (
  auth.uid() = owner_id OR 
  exists (
    select 1 from public.profiles p_record
    join public.profiles p_auth on p_auth.organization_id = p_record.organization_id
    where p_record.id = finance_categories.owner_id
    and p_auth.id = auth.uid()
    and p_auth.organization_id is not null
  )
);

-- --- TOOLS ---
-- (New table, assumes no existing policy)
create policy "Org Members can CRUD tools" on public.tools for all using (
  auth.uid() = owner_id OR 
  exists (
    select 1 from public.profiles p_record
    join public.profiles p_auth on p_auth.organization_id = p_record.organization_id
    where p_record.id = tools.owner_id
    and p_auth.id = auth.uid()
    and p_auth.organization_id is not null
  )
);

-- --- AI MEMORY (Company Brain) ---
drop policy if exists "Users can CRUD own memories" on public.ai_memories;
create policy "Org Members can CRUD memories" on public.ai_memories for all using (
  auth.uid() = owner_id OR 
  exists (
    select 1 from public.profiles p_record
    join public.profiles p_auth on p_auth.organization_id = p_record.organization_id
    where p_record.id = ai_memories.owner_id
    and p_auth.id = auth.uid()
    and p_auth.organization_id is not null
  )
);
