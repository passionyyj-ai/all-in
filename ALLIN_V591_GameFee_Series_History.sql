-- ALLIN V5.9.1
-- 회원별 게임비 수동 조정 이력 + 시리즈 팀/대기 명단 스냅샷
-- 기존 자동 청구(game_dues)는 수정하지 않으며 조정 차액을 별도 누적합니다.

create table if not exists public.member_game_fee_adjustments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  adjustment_month date not null,
  charge_before numeric(12,0) not null check(charge_before>=0),
  charge_after numeric(12,0) not null check(charge_after>=0),
  balance_before numeric(12,0) not null check(balance_before>=0),
  balance_after numeric(12,0) not null check(balance_after>=0),
  charge_delta numeric(12,0) not null,
  balance_delta numeric(12,0) not null,
  reason text not null check(length(trim(reason))>=2),
  changed_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check(balance_after<=charge_after)
);

create index if not exists idx_game_fee_adjustments_member_month
on public.member_game_fee_adjustments(member_id,adjustment_month,created_at desc);

alter table public.member_game_fee_adjustments enable row level security;
drop policy if exists admin_all on public.member_game_fee_adjustments;
create policy admin_all on public.member_game_fee_adjustments
for all to authenticated using(public.is_admin()) with check(public.is_admin());
grant select,insert on public.member_game_fee_adjustments to authenticated;

create or replace function public.admin_adjust_member_game_fee_v591(
  p_member_id uuid,
  p_month date,
  p_new_charge numeric,
  p_new_balance numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_month date:=date_trunc('month',p_month)::date;
  v_charge numeric(12,0);
  v_balance numeric(12,0);
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if not exists(select 1 from public.members where id=p_member_id) then raise exception '회원을 찾을 수 없습니다.'; end if;
  if p_new_charge<0 or p_new_balance<0 or p_new_balance>p_new_charge then
    raise exception '청구액과 잔액을 확인하세요.';
  end if;
  if length(trim(coalesce(p_reason,'')))<2 then raise exception '변경 사유를 입력하세요.'; end if;

  select
    coalesce((select sum(amount) from public.game_dues where member_id=p_member_id and date_trunc('month',due_date)::date=v_month),0)
      + coalesce((select sum(charge_delta) from public.member_game_fee_adjustments where member_id=p_member_id and adjustment_month=v_month),0),
    coalesce((select sum(amount) from public.game_dues where member_id=p_member_id and status='unpaid' and date_trunc('month',due_date)::date=v_month),0)
      + coalesce((select sum(balance_delta) from public.member_game_fee_adjustments where member_id=p_member_id and adjustment_month=v_month),0)
  into v_charge,v_balance;

  if v_charge=p_new_charge and v_balance=p_new_balance then raise exception '변경된 금액이 없습니다.'; end if;

  insert into public.member_game_fee_adjustments(
    member_id,adjustment_month,charge_before,charge_after,balance_before,balance_after,
    charge_delta,balance_delta,reason
  ) values(
    p_member_id,v_month,v_charge,p_new_charge,v_balance,p_new_balance,
    p_new_charge-v_charge,p_new_balance-v_balance,trim(p_reason)
  ) returning id into v_id;
  return v_id;
end $$;
grant execute on function public.admin_adjust_member_game_fee_v591(uuid,date,numeric,numeric,text) to authenticated;

create or replace function public.admin_mark_member_game_fee_paid_v591(p_member_id uuid,p_month date,p_paid_date date)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_month date:=date_trunc('month',p_month)::date; v_charge numeric(12,0); v_balance numeric(12,0); v_balance_adjustment numeric(12,0); v_name text; v_tx uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select name into v_name from public.members where id=p_member_id;
  select
    coalesce((select sum(amount) from public.game_dues where member_id=p_member_id and date_trunc('month',due_date)::date=v_month),0)+coalesce((select sum(charge_delta) from public.member_game_fee_adjustments where member_id=p_member_id and adjustment_month=v_month),0),
    coalesce((select sum(amount) from public.game_dues where member_id=p_member_id and status='unpaid' and date_trunc('month',due_date)::date=v_month),0)+coalesce((select sum(balance_delta) from public.member_game_fee_adjustments where member_id=p_member_id and adjustment_month=v_month),0)
  into v_charge,v_balance;
  select coalesce(sum(balance_delta),0) into v_balance_adjustment
  from public.member_game_fee_adjustments where member_id=p_member_id and adjustment_month=v_month;
  if v_balance<=0 then raise exception '미납 게임비가 없습니다.'; end if;
  insert into public.transactions(tx_date,tx_type,category,target,amount,memo,source,ref_id)
  values(p_paid_date,'income','게임비',v_name,v_balance,to_char(v_month,'YYYY-MM')||' 조정 반영 게임비 입금 확인','game_payment',gen_random_uuid()) returning id into v_tx;
  update public.game_dues set status='paid',paid_date=p_paid_date,transaction_id=v_tx
  where member_id=p_member_id and status='unpaid' and date_trunc('month',due_date)::date=v_month;
  insert into public.member_game_fee_adjustments(member_id,adjustment_month,charge_before,charge_after,balance_before,balance_after,charge_delta,balance_delta,reason)
  values(p_member_id,v_month,v_charge,v_charge,v_balance,0,0,-v_balance_adjustment,'게임비 합계 입금 확인');
  return true;
end $$;
grant execute on function public.admin_mark_member_game_fee_paid_v591(uuid,date,date) to authenticated;

create table if not exists public.series_team_snapshots (
  id uuid primary key default gen_random_uuid(),
  series_kind text not null check(series_kind in ('normal','three_team')),
  series_id uuid not null,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  series_no int not null,
  meeting_date date not null,
  match_format text not null,
  team_code text not null check(team_code in ('A','B','C','WAIT')),
  team_name text not null,
  member_ids uuid[] not null default '{}'::uuid[],
  member_names text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  unique(series_kind,series_id,team_code)
);
create index if not exists idx_series_snapshots_meeting on public.series_team_snapshots(meeting_date desc,series_no desc);
alter table public.series_team_snapshots enable row level security;
drop policy if exists admin_all on public.series_team_snapshots;
create policy admin_all on public.series_team_snapshots
for all to authenticated using(public.is_admin()) with check(public.is_admin());
grant select on public.series_team_snapshots to authenticated;

create or replace function public.snapshot_member_names(p_ids uuid[])
returns text[] language sql stable set search_path=public as $$
  select coalesce(array_agg(m.name order by u.ord),'{}'::text[])
  from unnest(coalesce(p_ids,'{}'::uuid[])) with ordinality u(id,ord)
  join public.members m on m.id=u.id
$$;

create or replace function public.capture_normal_series_snapshot_v591()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_date date; v_wait uuid[]; v_c uuid[]; v_c_name text;
begin
  select meeting_date into v_date from public.meetings where id=new.meeting_id;
  select coalesce(array_agg(a.member_id order by m.name),'{}'::uuid[]) into v_wait
  from public.attendance a join public.members m on m.id=a.member_id
  where a.meeting_id=new.meeting_id and a.attending=true
    and not(a.member_id=any(new.team_a_members||new.team_b_members));
  select coalesce(array_agg(tm.member_id order by m.name),'{}'::uuid[]),coalesce(max(t.team_name),'C팀') into v_c,v_c_name
  from public.teams t join public.team_members tm on tm.team_id=t.id join public.members m on m.id=tm.member_id
  where t.meeting_id=new.meeting_id and t.id not in(new.team_a_source_id,new.team_b_source_id);
  insert into public.series_team_snapshots(series_kind,series_id,meeting_id,series_no,meeting_date,match_format,team_code,team_name,member_ids,member_names)
  values
    ('normal',new.id,new.meeting_id,new.series_no,v_date,case when new.best_of=3 then '3판 2승제' else '5판 3승제' end,'A',new.team_a_name,new.team_a_members,public.snapshot_member_names(new.team_a_members)),
    ('normal',new.id,new.meeting_id,new.series_no,v_date,case when new.best_of=3 then '3판 2승제' else '5판 3승제' end,'B',new.team_b_name,new.team_b_members,public.snapshot_member_names(new.team_b_members)),
    ('normal',new.id,new.meeting_id,new.series_no,v_date,case when new.best_of=3 then '3판 2승제' else '5판 3승제' end,'C',v_c_name,v_c,public.snapshot_member_names(v_c)),
    ('normal',new.id,new.meeting_id,new.series_no,v_date,case when new.best_of=3 then '3판 2승제' else '5판 3승제' end,'WAIT','대기',v_wait,public.snapshot_member_names(v_wait));
  return new;
end $$;
drop trigger if exists trg_capture_normal_series_snapshot_v591 on public.match_series;
create trigger trg_capture_normal_series_snapshot_v591 after insert on public.match_series
for each row execute function public.capture_normal_series_snapshot_v591();

create or replace function public.capture_three_series_snapshot_v591()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_date date; v_wait uuid[]; v_all uuid[];
begin
  select meeting_date into v_date from public.meetings where id=new.meeting_id;
  v_all:=new.team_1_members||new.team_2_members||new.team_3_members;
  select coalesce(array_agg(a.member_id order by m.name),'{}'::uuid[]) into v_wait
  from public.attendance a join public.members m on m.id=a.member_id
  where a.meeting_id=new.meeting_id and a.attending=true and not(a.member_id=any(v_all));
  insert into public.series_team_snapshots(series_kind,series_id,meeting_id,series_no,meeting_date,match_format,team_code,team_name,member_ids,member_names)
  values
    ('three_team',new.id,new.meeting_id,new.series_no,v_date,'3팀 단판 승자연전','A',new.team_1_name,new.team_1_members,public.snapshot_member_names(new.team_1_members)),
    ('three_team',new.id,new.meeting_id,new.series_no,v_date,'3팀 단판 승자연전','B',new.team_2_name,new.team_2_members,public.snapshot_member_names(new.team_2_members)),
    ('three_team',new.id,new.meeting_id,new.series_no,v_date,'3팀 단판 승자연전','C',new.team_3_name,new.team_3_members,public.snapshot_member_names(new.team_3_members)),
    ('three_team',new.id,new.meeting_id,new.series_no,v_date,'3팀 단판 승자연전','WAIT','대기',v_wait,public.snapshot_member_names(v_wait));
  return new;
end $$;
drop trigger if exists trg_capture_three_series_snapshot_v591 on public.three_team_series;
create trigger trg_capture_three_series_snapshot_v591 after insert on public.three_team_series
for each row execute function public.capture_three_series_snapshot_v591();

-- 기존 시리즈는 원래 저장돼 있던 팀 배열로 안전하게 역채웁니다(과거 대기 명단은 복원 불가).
insert into public.series_team_snapshots(series_kind,series_id,meeting_id,series_no,meeting_date,match_format,team_code,team_name,member_ids,member_names)
select 'normal',s.id,s.meeting_id,s.series_no,m.meeting_date,case when s.best_of=3 then '3판 2승제' else '5판 3승제' end,x.code,x.name,x.ids,public.snapshot_member_names(x.ids)
from public.match_series s join public.meetings m on m.id=s.meeting_id
cross join lateral(values('A',s.team_a_name,s.team_a_members),('B',s.team_b_name,s.team_b_members)) x(code,name,ids)
on conflict do nothing;
insert into public.series_team_snapshots(series_kind,series_id,meeting_id,series_no,meeting_date,match_format,team_code,team_name,member_ids,member_names)
select 'three_team',s.id,s.meeting_id,s.series_no,m.meeting_date,'3팀 단판 승자연전',x.code,x.name,x.ids,public.snapshot_member_names(x.ids)
from public.three_team_series s join public.meetings m on m.id=s.meeting_id
cross join lateral(values('A',s.team_1_name,s.team_1_members),('B',s.team_2_name,s.team_2_members),('C',s.team_3_name,s.team_3_members)) x(code,name,ids)
on conflict do nothing;

create or replace function public.operation_get_series_team_snapshots_v591(p_member_id uuid,p_pin text)
returns setof public.series_team_snapshots language plpgsql security definer set search_path=public as $$
begin
  if not public.operation_verify_member(p_member_id,p_pin) then raise exception '회원 인증에 실패했습니다.'; end if;
  return query select * from public.series_team_snapshots order by meeting_date desc,series_no desc,team_code;
end $$;
grant execute on function public.operation_get_series_team_snapshots_v591(uuid,text) to anon,authenticated;

notify pgrst,'reload schema';
