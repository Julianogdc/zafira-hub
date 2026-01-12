-- Add new columns for User Management
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS last_seen timestamptz DEFAULT now(),
ADD COLUMN IF NOT EXISTS status text DEFAULT 'active'; -- 'active', 'suspended'

-- Update RLS Policies to allow Admins to manage everything
-- (Assuming existing RLS might be restrictive)

-- 1. Allow Admins to read ALL profiles
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
ON public.profiles FOR SELECT
USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

-- 2. Allow Admins to update ALL profiles (to suspend/change role)
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Admins can update all profiles"
ON public.profiles FOR UPDATE
USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

-- 3. Allow Users to update their OWN last_seen (regardless of admin status)
-- Note: This often conflicts if we have a restrictive UPDATE policy. 
-- Ideally, we'd have a function for "heartbeat" to bypass RLS or careful policy crafting.
-- For now, let's ensure the comprehensive "Users can update own profile" policy exists.

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
USING ( id = auth.uid() );

-- Verify the columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'profiles';
