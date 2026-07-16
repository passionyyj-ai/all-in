-- ALLIN V5.2 DB UPDATE
-- 회원 주 포지션 + 복수 보조 포지션

alter table public.members
  add column if not exists secondary_positions text[] not null default '{}'::text[];

-- 기존 또는 잘못된 값을 정리합니다.
update public.members m
set secondary_positions = coalesce((
  select array_agg(distinct p)
  from unnest(coalesce(secondary_positions, '{}'::text[])) p
  where p in ('공격','토스','좌수비','우수비') and p <> m.position
), '{}'::text[]);

-- 허용 포지션만 저장되고 주 포지션은 보조 포지션에 중복되지 않도록 검증합니다.
alter table public.members drop constraint if exists members_secondary_positions_valid;
alter table public.members add constraint members_secondary_positions_valid check (
  secondary_positions <@ array['공격','토스','좌수비','우수비']::text[]
  and not (position = any(secondary_positions))
);

comment on column public.members.secondary_positions is '주 포지션 외 수행 가능한 복수 보조 포지션';
notify pgrst, 'reload schema';

select column_name, data_type, column_default
from information_schema.columns
where table_schema='public' and table_name='members' and column_name='secondary_positions';
