create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  role text not null default 'viewer' check (role in ('admin','inventory','sales','viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower_idx on public.profiles(lower(username));
alter table public.profiles enable row level security;
drop policy if exists "users can read own profile" on public.profiles;
create policy "users can read own profile" on public.profiles for select to authenticated using (auth.uid()=id);
grant select on public.profiles to authenticated;
