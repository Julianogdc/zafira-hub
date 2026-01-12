
-- Categorias Financeiras
create table public.finance_categories (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null,
  icon text,
  color text,
  last_used timestamptz,
  created_at timestamptz default now()
);

-- Transações Financeiras
create table public.finance_transactions (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references public.profiles(id) on delete set null,
  description text not null,
  amount numeric not null,
  type text not null, -- 'income' | 'expense'
  category text, -- Armazena o nome da categoria ou FK (idealmente FK, mas o código usa nome)
  date timestamptz,
  status text, -- 'paid' | 'pending'
  payment_method text,
  created_at timestamptz default now()
);

-- RLS
alter table public.finance_categories enable row level security;
alter table public.finance_transactions enable row level security;

create policy "Users can CRUD own categories" on public.finance_categories for all using (auth.uid() = owner_id);
create policy "Users can CRUD own transactions" on public.finance_transactions for all using (auth.uid() = owner_id);
