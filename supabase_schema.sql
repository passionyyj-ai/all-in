-- 대경 Tracking Cloud v11 초기 스키마
-- Supabase SQL Editor에서 실행하세요.
create table if not exists public.app_state (
  workspace_id text primary key,
  state_data jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  last_reason text,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- 로그인한 사용자만 공용 워크스페이스를 조회/저장할 수 있습니다.
-- v11은 회사 내부 공용 DB 모델입니다. 사용자별/병원별 권한은 다음 단계에서 정책을 세분화하세요.
drop policy if exists "authenticated can read app state" on public.app_state;
create policy "authenticated can read app state"
on public.app_state for select
to authenticated
using (true);

drop policy if exists "authenticated can insert app state" on public.app_state;
create policy "authenticated can insert app state"
on public.app_state for insert
to authenticated
with check (auth.uid() = updated_by);

drop policy if exists "authenticated can update app state" on public.app_state;
create policy "authenticated can update app state"
on public.app_state for update
to authenticated
using (true)
with check (auth.uid() = updated_by);

create index if not exists app_state_updated_at_idx on public.app_state(updated_at desc);
