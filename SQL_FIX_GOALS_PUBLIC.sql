-- ==============================================================================
-- SQL_FIX_GOALS_PUBLIC_V2.sql
-- Fixes Goal visibility so Members can see 'public' goals (General Company Goals).
-- Corrects the issue where 'organization_id' is not on the goals table.
-- ==============================================================================

-- 1. DROP OLD RESTRICTIVE POLICY
DROP POLICY IF EXISTS "Org Leadership can VIEW/UPDATE, Members own/assigned" ON public.goals;
DROP POLICY IF EXISTS "Org Members can VIEW goals" ON public.goals;
DROP POLICY IF EXISTS "Org Members can MODIFY goals" ON public.goals;

-- Helper to check if a goal belongs to the user's organization
-- We check if the goal's owner is in the same org as the current user.
-- (Or if the goal is assigned to someone in the same org, but usually owner org dictates ownership)

-- A) VIEW (SELECT):
CREATE POLICY "Org Members can VIEW goals" ON public.goals FOR SELECT USING (
  -- 1. My Own or Assigned
  auth.uid() = owner_id OR 
  auth.uid() = assigned_to OR
  
  -- 2. Public Goals (Same Org)
  (
    visibility = 'public' AND
    exists (
      select 1 from public.profiles p_record
      where p_record.id = goals.owner_id
      and p_record.organization_id = get_current_user_org_id()
    )
  ) OR

  -- 3. Leadership sees All (Same Org)
  (
    public.is_manager_or_admin() AND 
    exists (
      select 1 from public.profiles p_record
      where p_record.id = goals.owner_id
      and p_record.organization_id = get_current_user_org_id()
    )
  )
);

-- B) MODIFY (INSERT/UPDATE/DELETE):
CREATE POLICY "Org Members can MODIFY goals" ON public.goals FOR ALL USING (
  -- 1. Leadership (Full Access)
  (
    public.is_manager_or_admin() AND 
    exists (
      select 1 from public.profiles p_record
      where p_record.id = goals.owner_id
      and p_record.organization_id = get_current_user_org_id()
    )
  ) OR

  -- 2. Owner (Full Access to own)
  auth.uid() = owner_id OR

  -- 3. Assignee (Can Update)
  auth.uid() = assigned_to
);
