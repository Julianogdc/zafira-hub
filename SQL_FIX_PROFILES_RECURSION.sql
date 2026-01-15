-- ==============================================================================
-- SQL_FIX_PROFILES_RECURSION.sql
-- Fixes Infinite Recursion in RLS by using a Security Definer function.
-- ==============================================================================

-- 1. Create Helper Function (Bypasses RLS)
-- This function runs with the privileges of the creator (Definer), not the user (Invoker).
-- This allows it to peek at the profiles table to get the Org ID without triggering the RLS loop.

CREATE OR REPLACE FUNCTION public.get_current_user_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public -- Secure search path
STABLE
AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$;

-- 2. Update Policy to use the Function
-- We replace the direct subquery with our safe function call.

DROP POLICY IF EXISTS "Org Members can VIEW profiles" ON public.profiles;

CREATE POLICY "Org Members can VIEW profiles"
ON public.profiles FOR SELECT
USING (
  id = auth.uid() OR -- Always see self
  (
    organization_id is not null AND
    organization_id = get_current_user_org_id() -- Safe recursive check
  )
);
