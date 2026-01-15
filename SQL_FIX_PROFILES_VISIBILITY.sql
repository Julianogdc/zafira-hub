-- ==============================================================================
-- SQL_FIX_PROFILES_VISIBILITY.sql
-- Fixes profile visibility so users can see their colleagues (for assignment).
-- ==============================================================================

-- 1. DROP OLD RESTRICTIVE POLICIES
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
-- Drop any other potential read policies
DROP POLICY IF EXISTS "Org Members can VIEW profiles" ON public.profiles;

-- 2. CREATE NEW INCLUSIVE READ POLICY
-- All members of the same organization can view each other's basic profile info (name, avatar, role).
CREATE POLICY "Org Members can VIEW profiles"
ON public.profiles FOR SELECT
USING (
  id = auth.uid() OR -- Always see self
  (
    organization_id is not null AND
    organization_id = (select organization_id from public.profiles where id = auth.uid())
  )
);

-- 3. ENSURE UPDATE POLICY REMAINS RESTRICTED (Security)
-- Only I can update my own profile, or Admin can update anyone.
-- (Assuming existing update policies are fine, usually defined in other scripts.
--  If not, we reinforce 'Users can update own profile' here or leave as is if not broken).
-- We won't touch UPDATE policies here to avoid regressions, focusing on SELECT.
