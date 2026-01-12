-- 1. Updates to Profiles Table (for Roles and Organization)
-- Adiciona coluna de cargo (admin, member, etc)
alter table public.profiles 
add column if not exists role text default 'member';

-- Adiciona coluna de organização (para compartilhar dados entre sócios)
-- Por enquanto deixaremos nulo, mas futuramente você pode criar uma tabela 'organizations'
alter table public.profiles 
add column if not exists organization_id uuid;

-- 2. Storage Setup for Avatars
-- Insere um novo bucket chamado 'avatars'
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 3. Storage Security Policies (RLS)

-- Permitir acesso público para VER as fotos (necessário para carregar o avatar no app)
create policy "Avatar images are publicly accessible"
on storage.objects for select
using ( bucket_id = 'avatars' );

-- Permitir que usuários autenticados façam UPLOAD de suas próprias fotos
create policy "Anyone can upload an avatar"
on storage.objects for insert
with check ( bucket_id = 'avatars' and auth.role() = 'authenticated' );

-- Permitir que usuários ATUALIZEM suas próprias fotos
create policy "Anyone can update their own avatar"
on storage.objects for update
using ( bucket_id = 'avatars' and auth.uid() = owner )
with check ( bucket_id = 'avatars' and auth.uid() = owner );
