-- Existing V5.9.7 database hotfix; apply after the existing migrations.
begin;
alter table public.member_game_fee_adjustments add column if not exists deleted_at timestamptz;
alter table public.member_game_fee_adjustments add column if not exists deleted_by uuid;
alter table public.member_game_fee_adjustments add column if not exists reversal_of uuid references public.member_game_fee_adjustments(id);
create unique index if not exists game_fee_reversal_unique on public.member_game_fee_adjustments(reversal_of) where reversal_of is not null;
-- History writes go through checked RPCs only.
revoke insert,update,delete on public.member_game_fee_adjustments from authenticated,anon;
create or replace function public.apply_manual_series_fee_v592()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='completed' and new.manual_fee_amount is not null then
    new.fee_amount:=new.manual_fee_amount;
    if tg_table_name='three_team_series' then
      if coalesce((to_jsonb(new)->>'reset_count')::int,0)>0 then
        new.fee_amount:=new.manual_fee_amount*2;
      end if;
    end if;
  end if;
  return new;
end $$;
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
  if p_member_id is null or p_month is null then raise exception '회원과 월을 확인하세요.'; end if;
  perform 1 from public.members where id=p_member_id for update;
  if not exists(select 1 from public.members where id=p_member_id) then raise exception '회원을 찾을 수 없습니다.'; end if;
  if p_new_charge is null or p_new_balance is null or p_new_charge<>trunc(p_new_charge) or p_new_balance<>trunc(p_new_balance) or p_new_charge<0 or p_new_balance<0 or p_new_balance>p_new_charge then
    raise exception '청구액과 잔액을 확인하세요.';
  end if;
  if length(trim(coalesce(p_reason,'')))<2 then raise exception '변경 사유를 입력하세요.'; end if;

  select
    coalesce((select sum(amount) from public.game_dues where member_id=p_member_id and date_trunc('month',due_date)::date=v_month),0)
      + coalesce((select sum(charge_delta) from public.member_game_fee_adjustments where member_id=p_member_id and adjustment_month=v_month),0),
    coalesce((select sum(amount) from public.game_dues where member_id=p_member_id and status='unpaid' and date_trunc('month',due_date)::date=v_month),0)
      + coalesce((select sum(balance_delta) from public.member_game_fee_adjustments where member_id=p_member_id and adjustment_month=v_month),0)
  into v_charge,v_balance;

  if v_charge<0 or v_balance<0 or v_balance>v_charge then raise exception '기존 조정 합계를 확인하세요.'; end if;
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
  if p_member_id is null or p_month is null then raise exception '회원과 월을 확인하세요.'; end if;
  perform 1 from public.members where id=p_member_id for update;
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


create or replace function public.admin_delete_game_fee_adjustment_v591(p_adjustment_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare a public.member_game_fee_adjustments%rowtype; c numeric; b numeric;
begin
 if not public.is_admin() then raise exception 'admin only'; end if;
 select * into a from public.member_game_fee_adjustments where id=p_adjustment_id;
 if not found then raise exception '수정 내역이 없습니다.'; end if;
 perform 1 from public.members where id=a.member_id for update;
 select * into a from public.member_game_fee_adjustments where id=p_adjustment_id for update;
 if a.deleted_at is not null then return true; end if;
 if a.reversal_of is not null or a.reason='게임비 합계 입금 확인' then raise exception '입금 및 삭제 이력은 삭제할 수 없습니다.'; end if;
 select coalesce((select sum(amount) from public.game_dues where member_id=a.member_id and date_trunc('month',due_date)::date=a.adjustment_month),0)+coalesce(sum(charge_delta),0),
 coalesce((select sum(amount) from public.game_dues where member_id=a.member_id and status='unpaid' and date_trunc('month',due_date)::date=a.adjustment_month),0)+coalesce(sum(balance_delta),0)
 into c,b from public.member_game_fee_adjustments where member_id=a.member_id and adjustment_month=a.adjustment_month;
 if c-a.charge_delta<0 or b-a.balance_delta<0 or b-a.balance_delta>c-a.charge_delta then
   raise exception '후속 조정 또는 입금이 있어 삭제할 수 없습니다. 현재 금액을 먼저 수정하세요.';
 end if;
 insert into public.member_game_fee_adjustments(member_id,adjustment_month,charge_before,charge_after,balance_before,balance_after,charge_delta,balance_delta,reason,reversal_of)
 values(a.member_id,a.adjustment_month,c,c-a.charge_delta,b,b-a.balance_delta,-a.charge_delta,-a.balance_delta,'수정 내역 삭제: '||a.reason,a.id);
 update public.member_game_fee_adjustments set deleted_at=now(),deleted_by=auth.uid() where id=a.id;
 return true;
end $$;
revoke all on function public.admin_delete_game_fee_adjustment_v591(uuid) from public;
grant execute on function public.admin_delete_game_fee_adjustment_v591(uuid) to authenticated;
-- Publish only admin-readable tables; retain existing RLS.
do $$ declare t text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['teams','team_members','match_series','series_sets','three_team_series','three_team_games','series_team_snapshots','member_game_fee_adjustments'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
    execute format('alter publication supabase_realtime add table public.%I',t);
   end if;
  end loop;
 end if;
end $$;
create or replace function public.admin_start_match_series_v59(
  p_meeting_id uuid,
  p_team_a_id uuid,
  p_team_b_id uuid,
  p_best_of int
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_id uuid;
  v_no int;
  v_a_name text;
  v_b_name text;
  v_a_members uuid[];
  v_b_members uuid[];
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  perform 1 from public.meetings where id=p_meeting_id for update;
  if not found then raise exception '모임을 찾을 수 없습니다.'; end if;
  if p_team_a_id is null or p_team_b_id is null then raise exception '팀을 선택하세요.'; end if;
  if p_best_of is null or p_best_of not in (3,5) then
    raise exception '경기 방식은 3판 또는 5판이어야 합니다.';
  end if;

  if p_team_a_id=p_team_b_id then
    raise exception '서로 다른 팀을 선택하세요.';
  end if;

  if exists(
      select 1 from public.match_series
      where meeting_id=p_meeting_id and status='active'
    )
    or exists(
      select 1 from public.three_team_series
      where meeting_id=p_meeting_id and status='active'
    ) then
    raise exception '이미 진행 중인 시리즈가 있습니다.';
  end if;

  select team_name into v_a_name
  from public.teams
  where id=p_team_a_id and meeting_id=p_meeting_id;

  select team_name into v_b_name
  from public.teams
  where id=p_team_b_id and meeting_id=p_meeting_id;

  if v_a_name is null or v_b_name is null then
    raise exception '선택한 팀을 찾을 수 없습니다.';
  end if;

  select coalesce(array_agg(member_id order by member_id),'{}'::uuid[])
  into v_a_members
  from public.team_members
  where team_id=p_team_a_id;

  select coalesce(array_agg(member_id order by member_id),'{}'::uuid[])
  into v_b_members
  from public.team_members
  where team_id=p_team_b_id;

  if cardinality(v_a_members)=0 or cardinality(v_b_members)=0 then
    raise exception '팀원이 없는 팀은 시리즈를 시작할 수 없습니다.';
  end if;

  select coalesce(max(series_no),0)+1
  into v_no
  from public.match_series
  where meeting_id=p_meeting_id;

  insert into public.match_series(
    meeting_id,
    series_no,
    best_of,
    team_a_source_id,
    team_b_source_id,
    team_a_name,
    team_b_name,
    team_a_members,
    team_b_members,
    referee_member_id,
    referee_name
  )
  values(
    p_meeting_id,
    v_no,
    p_best_of,
    p_team_a_id,
    p_team_b_id,
    v_a_name,
    v_b_name,
    v_a_members,
    v_b_members,
    null,
    null
  )
  returning id into v_id;

  return v_id;
end $$;

grant execute on function public.admin_start_match_series_v59(uuid,uuid,uuid,int)
to authenticated;
create or replace function public.capture_normal_series_snapshot_v591()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_date date; v_wait uuid[]; v_c uuid[]; v_c_name text;
begin
  select meeting_date into v_date from public.meetings where id=new.meeting_id;
  select coalesce(array_agg(tm.member_id order by m.name),'{}'::uuid[]),coalesce(max(t.team_name),'C팀') into v_c,v_c_name
  from public.teams t join public.team_members tm on tm.team_id=t.id join public.members m on m.id=tm.member_id
  where t.meeting_id=new.meeting_id and t.id not in(new.team_a_source_id,new.team_b_source_id);
  select coalesce(array_agg(a.member_id order by m.name),'{}'::uuid[]) into v_wait
  from public.attendance a join public.members m on m.id=a.member_id
  where a.meeting_id=new.meeting_id and a.attending=true
    and not(a.member_id=any(coalesce(new.team_a_members,'{}'::uuid[])||coalesce(new.team_b_members,'{}'::uuid[])||v_c));
  insert into public.series_team_snapshots(series_kind,series_id,meeting_id,series_no,meeting_date,match_format,team_code,team_name,member_ids,member_names)
  values
    ('normal',new.id,new.meeting_id,new.series_no,v_date,case when new.best_of=3 then '3판 2승제' else '5판 3승제' end,'A',new.team_a_name,new.team_a_members,public.snapshot_member_names(new.team_a_members)),
    ('normal',new.id,new.meeting_id,new.series_no,v_date,case when new.best_of=3 then '3판 2승제' else '5판 3승제' end,'B',new.team_b_name,new.team_b_members,public.snapshot_member_names(new.team_b_members)),
    ('normal',new.id,new.meeting_id,new.series_no,v_date,case when new.best_of=3 then '3판 2승제' else '5판 3승제' end,'C',v_c_name,v_c,public.snapshot_member_names(v_c)),
    ('normal',new.id,new.meeting_id,new.series_no,v_date,case when new.best_of=3 then '3판 2승제' else '5판 3승제' end,'WAIT','대기',v_wait,public.snapshot_member_names(v_wait));
  return new;
end $$;

notify pgrst,'reload schema';
commit;
