-- ==============================================================================
-- SQL_FIX_VISIBILITY.sql
-- Fixes visibility issues by allowing all organization members to view shared data.
-- ==============================================================================

-- 1. DROP OLD RESTRICTIVE POLICIES
-- We drop the policies that enforced strict ownership or admin-only access.

-- Clients
drop policy if exists "Admins and Owners can CRUD clients" on public.clients;
drop policy if exists "Org Members can CRUD clients" on public.clients;

-- Leads
drop policy if exists "Admins and Owners can CRUD leads" on public.leads;
drop policy if exists "Org Members can CRUD leads" on public.leads;

-- Goals
drop policy if exists "Admins, Owners, and Assigned can CRUD goals" on public.goals;
drop policy if exists "Org Members can CRUD goals" on public.goals;

-- ==============================================================================
-- 2. CREATE NEW INCLUSIVE POLICIES (ORGANIZATION BASED)
-- ==============================================================================

-- Helper function to check organization membership efficiently
-- (Optional: Inline logic is used below for portability/clarity)

-- --- CLIENTS ---
-- Allow access if:
-- 1. User is Admin
-- 2. User is Owner
-- 3. User is in the SAME Organization as the Owner (Sharing)
create policy "Org Members can VIEW and UPDATE clients" on public.clients for all using (
  auth.uid() = owner_id OR 
  (select role from public.profiles where id = auth.uid()) = 'admin' OR
  exists (
    select 1 from public.profiles p_record
    join public.profiles p_auth on p_auth.organization_id = p_record.organization_id
    where p_record.id = clients.owner_id
    and p_auth.id = auth.uid()
    and p_auth.organization_id is not null
  )
);

-- --- LEADS ---
create policy "Org Members can VIEW and UPDATE leads" on public.leads for all using (
  auth.uid() = owner_id OR 
  (select role from public.profiles where id = auth.uid()) = 'admin' OR
  exists (
    select 1 from public.profiles p_record
    join public.profiles p_auth on p_auth.organization_id = p_record.organization_id
    where p_record.id = leads.owner_id
    and p_auth.id = auth.uid()
    and p_auth.organization_id is not null
  )
);

-- --- GOALS ---
-- Goals can be assigned to specific Users, but visibility is usually Org-wide or Team-wide.
-- Here we imply Org-wide visibility.
create policy "Org Members can VIEW and UPDATE goals" on public.goals for all using (
  auth.uid() = owner_id OR 
  auth.uid() = assigned_to OR
  (select role from public.profiles where id = auth.uid()) = 'admin' OR
  exists (
    select 1 from public.profiles p_record
    join public.profiles p_auth on p_auth.organization_id = p_record.organization_id
    where p_record.id = goals.owner_id
    and p_auth.id = auth.uid()
    and p_auth.organization_id is not null
  )
);

-- ==============================================================================
-- 3. STORAGE POLICIES (CONTRACTS)
-- ==============================================================================
-- Ensure 'client-contracts' bucket allows access to org members
-- (Assuming standard storage.objects policies using bucket_id)

-- We usually don't need complex joins for storage if we trust the folder structure or just allow authenticated reads.
-- For stricter control:
create policy "Org Members can SELECT contracts" on storage.objects for select using (
  bucket_id = 'client-contracts' AND
  auth.role() = 'authenticated'
);

create policy "Org Members can INSERT contracts" on storage.objects for insert with check (
  bucket_id = 'client-contracts' AND
  auth.role() = 'authenticated'
);
