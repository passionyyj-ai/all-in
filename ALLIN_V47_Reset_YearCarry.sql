-- ALLIN V4.7 초기화 + 연도 이월 기능

create table if not exists public.year_carryovers (
  id uuid primary key default gen_random_uuid(),
  from_year int not null unique,
  to_year int not null unique,
  balance numeric(12,0) not null,
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_security_settings (
  id int primary key default 1 check(id=1),
  reset_pin_hash text not null
);

insert into public.admin_security_settings(id,reset_pin_hash)
values(1,extensions.crypt('1111',extensions.gen_salt('bf')))
on conflict(id) do nothing;

alter table public.year_carryovers enable row level security;
alter table public.admin_security_settings enable row level security;

drop policy if exists admin_all on public.year_carryovers;
create policy admin_all on public.year_carryovers
for all to authenticated using(public.is_admin()) with check(public.is_admin());

drop policy if exists admin_all on public.admin_security_settings;
create policy admin_all on public.admin_security_settings
for all to authenticated using(public.is_admin()) with check(public.is_admin());

grant select,insert,update,delete on public.year_carryovers to authenticated;
grant select,update on public.admin_security_settings to authenticated;

create or replace function public.admin_carry_year_balance(p_from_year int)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_to_year int:=p_from_year+1;
  v_balance numeric(12,0);
  v_tx uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_from_year<2023 or p_from_year>2100 then raise exception 'invalid year'; end if;

  if exists(select 1 from public.year_carryovers where from_year=p_from_year or to_year=v_to_year) then
    raise exception '이미 이월 처리된 연도입니다.';
  end if;

  select coalesce(sum(case when tx_type='income' then amount else -amount end),0)
  into v_balance
  from public.transactions
  where tx_date>=make_date(p_from_year,1,1)
    and tx_date<make_date(v_to_year,1,1);

  insert into public.transactions(
    tx_date,tx_type,category,target,amount,memo,source
  )
  values(
    make_date(v_to_year,1,1),
    case when v_balance>=0 then 'income' else 'expense' end,
    '이월잔액',
    '전년도 이월',
    abs(v_balance),
    p_from_year||'년 말 잔액 이월',
    'manual'
  )
  returning id into v_tx;

  insert into public.year_carryovers(from_year,to_year,balance,transaction_id)
  values(p_from_year,v_to_year,v_balance,v_tx);

  return jsonb_build_object('ok',true,'balance',v_balance,'to_year',v_to_year);
end $$;

grant execute on function public.admin_carry_year_balance(int) to authenticated;

create or replace function public.admin_reset_operational_data(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_hash text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select reset_pin_hash into v_hash
  from public.admin_security_settings
  where id=1;

  if v_hash is null or v_hash<>extensions.crypt(p_pin,v_hash) then
    return jsonb_build_object('ok',false,'message','초기화 PIN이 올바르지 않습니다.');
  end if;

  truncate table
    public.series_sets,
    public.game_dues,
    public.games,
    public.match_series,
    public.team_members,
    public.teams,
    public.attendance,
    public.fees,
    public.fee_payments,
    public.year_carryovers,
    public.transactions,
    public.meetings
  restart identity cascade;

  return jsonb_build_object('ok',true);
end $$;

grant execute on function public.admin_reset_operational_data(text) to authenticated;

notify pgrst,'reload schema';
