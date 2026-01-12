
-- Tabela de Perfis de Usuário (vinculada ao Auth do Supabase)
create table public.profiles (
  id uuid REFERENCES auth.users on delete cascade not null primary key,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Tabela de Clientes
create table public.clients (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null,
  status text not null, -- 'active' | 'inactive'
  contract_value numeric default 0,
  contract_start date,
  contract_end date,
  notes text,
  churned_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Tabela de Contratos (Arquivos em Base64 - Idealmente usar Supabase Storage no futuro)
create table public.client_contracts (
  id uuid default gen_random_uuid() primary key,
  client_id uuid references public.clients(id) on delete cascade not null,
  file_name text not null,
  file_data text, -- Base64
  upload_date timestamptz default now()
);

-- Tabela de Histórico de Pagamentos
create table public.client_payments (
  id uuid default gen_random_uuid() primary key,
  client_id uuid references public.clients(id) on delete cascade not null,
  month text not null, -- 'MM/YYYY'
  status text not null, -- 'paid' | 'pending'
  paid_at timestamptz
);

-- Tabela de Leads (CRM)
create table public.leads (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null,
  company text,
  value numeric default 0,
  phone text,
  city text,
  niche text,
  description text,
  source text,
  status text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Histórico de Movimentação dos Leads
create table public.lead_history (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references public.leads(id) on delete cascade not null,
  date timestamptz default now(),
  from_status text,
  to_status text
);

-- Tabela de Metas
create table public.goals (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null,
  category text not null,
  type text not null, -- 'monetary' | 'numeric' | 'checklist'
  target_value numeric,
  current_value numeric,
  automation_binding text,
  period text,
  status text,
  start_date timestamptz,
  end_date timestamptz,
  active boolean default true,
  progress numeric default 0,
  created_at timestamptz default now()
);

-- Itens de Checklist para Metas
create table public.goal_checklist_items (
  id uuid default gen_random_uuid() primary key,
  goal_id uuid references public.goals(id) on delete cascade not null,
  label text not null,
  checked boolean default false
);

-- Função para criar perfil automaticamente ao cadastrar usuário
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$ language plpgsql security definer;

-- Trigger para chamar a função acima
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Políticas de Segurança (RLS) - Row Level Security
-- Habilitar RLS em todas as tabelas
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.client_contracts enable row level security;
alter table public.client_payments enable row level security;
alter table public.leads enable row level security;
alter table public.lead_history enable row level security;
alter table public.goals enable row level security;
alter table public.goal_checklist_items enable row level security;

-- Política: Usuários só veem seus próprios dados
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

create policy "Users can CRUD own clients" on public.clients for all using (auth.uid() = owner_id);
create policy "Users can CRUD own contracts" on public.client_contracts for all using (exists (select 1 from public.clients where id = client_contracts.client_id and owner_id = auth.uid()));
create policy "Users can CRUD own payments" on public.client_payments for all using (exists (select 1 from public.clients where id = client_payments.client_id and owner_id = auth.uid()));

create policy "Users can CRUD own leads" on public.leads for all using (auth.uid() = owner_id);
create policy "Users can CRUD own lead history" on public.lead_history for all using (exists (select 1 from public.leads where id = lead_history.lead_id and owner_id = auth.uid()));

create policy "Users can CRUD own goals" on public.goals for all using (auth.uid() = owner_id);
create policy "Users can CRUD own goal checklist" on public.goal_checklist_items for all using (exists (select 1 from public.goals where id = goal_checklist_items.goal_id and owner_id = auth.uid()));
