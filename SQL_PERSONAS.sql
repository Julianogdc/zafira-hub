-- Create table for AI Personas
create table public.ai_personas (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  role text not null,
  description text,
  system_prompt text not null,
  icon text default 'Bot',
  is_active boolean default true,
  created_by uuid references auth.users(id),
  organization_id uuid,
  visibility text default 'private', -- 'private' or 'public'
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.ai_personas enable row level security;

-- Policies

-- 1. Select:
-- Users can see public personas in their organization OR their own private personas
create policy "Users can view public org personas or own private"
  on public.ai_personas for select
  using (
    (visibility = 'public' and organization_id = (select organization_id from profiles where id = auth.uid()))
    or
    (created_by = auth.uid())
  );

-- 2. Insert:
-- Authenticated users can create personas
create policy "Users can create personas"
  on public.ai_personas for insert
  with check (
    auth.uid() = created_by
  );

-- 3. Update/Delete:
-- Only creators or admins can update/delete
create policy "Owners or Admins can update personas"
  on public.ai_personas for update
  using (
    created_by = auth.uid() or
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Owners or Admins can delete personas"
  on public.ai_personas for delete
  using (
    created_by = auth.uid() or
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );
