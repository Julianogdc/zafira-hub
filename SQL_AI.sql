-- AI Sessions (Conversations)
create table public.ai_sessions (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references public.profiles(id) on delete set null,
  title text,
  model text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- AI Messages
create table public.ai_messages (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.ai_sessions(id) on delete cascade,
  role text not null, -- 'user', 'assistant', 'system'
  content text not null,
  created_at timestamptz default now()
);

-- AI Long-Term Memory (Facts about the user/company)
create table public.ai_memories (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references public.profiles(id) on delete set null,
  content text not null,
  category text, -- 'preference', 'fact', 'business_rule'
  created_at timestamptz default now()
);

-- AI Prompts (Saved user prompts)
create table public.ai_prompts (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references public.profiles(id) on delete set null,
  title text not null,
  content text not null,
  category text,
  created_at timestamptz default now()
);

-- RLS Policies
alter table public.ai_sessions enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_memories enable row level security;
alter table public.ai_prompts enable row level security;

-- Sessions
create policy "Users can CRUD own sessions" on public.ai_sessions for all using (auth.uid() = owner_id);

-- Messages (Linked via session ownership or direct owner check if we added owner_id to messages, but session check is cleaner if traversing)
-- Simplified: Users can access messages if they own the session.
create policy "Users can CRUD messages of own sessions" on public.ai_messages for all using (
  exists (select 1 from public.ai_sessions s where s.id = ai_messages.session_id and s.owner_id = auth.uid())
);

-- Memories
create policy "Users can CRUD own memories" on public.ai_memories for all using (auth.uid() = owner_id);

-- Prompts
create policy "Users can CRUD own prompts" on public.ai_prompts for all using (auth.uid() = owner_id);
