-- ALLIN V6.0.0: run after V5.9.10 on the existing database.
begin;
alter table public.game_dues add column if not exists deleted_at timestamptz;
alter table public.game_dues add column if not exists deleted_by uuid;
create index if not exists game_dues_visible_date on public.game_dues(due_date,member_id) where deleted_at is null;

create table if not exists public.game_fee_deletion_history (
 id uuid primary key default gen_random_uuid(),
 series_kind text not null check(series_kind in ('S','T','G','D')),
 source_id uuid not null,
 deleted_by uuid,
 deleted_at timestamptz not null default now(),
 deleted_rows jsonb not null,
 deleted_count int not null,
 total_amount numeric not null
);
alter table public.game_fee_deletion_history enable row level security;
drop policy if exists admin_read on public.game_fee_deletion_history;
create policy admin_read on public.game_fee_deletion_history for select to authenticated using(public.is_admin());
grant select on public.game_fee_deletion_history to authenticated;
revoke insert,update,delete on public.game_fee_deletion_history from anon,authenticated;

create or replace function public.admin_delete_series_game_fees_v600(p_series_kind text,p_source_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_rows jsonb; v_count int; v_total numeric;
begin
 if not public.is_admin() then raise exception 'admin only'; end if;
 if p_source_id is null or p_series_kind is null or p_series_kind not in ('S','T','G','D') then raise exception '삭제할 게임비를 확인하세요.'; end if;
 perform pg_advisory_xact_lock(hashtext(p_series_kind||':'||p_source_id::text));
 -- Serialize against charge adjustments for all affected members in stable order.
 perform m.id from public.members m where exists(
  select 1 from public.game_dues d where d.member_id=m.id and d.deleted_at is null and (
   (p_series_kind='S' and d.series_id=p_source_id and d.three_team_series_id is null)
   or (p_series_kind='T' and d.three_team_series_id=p_source_id)
   or (p_series_kind='G' and d.game_id=p_source_id and d.series_id is null and d.three_team_series_id is null)
   or (p_series_kind='D' and d.id=p_source_id and d.game_id is null and d.series_id is null and d.three_team_series_id is null)
  )
 ) order by m.id for update;
 with removed as (
  update public.game_dues d set deleted_at=now(),deleted_by=auth.uid()
  where d.deleted_at is null and (
   (p_series_kind='S' and d.series_id=p_source_id and d.three_team_series_id is null)
   or (p_series_kind='T' and d.three_team_series_id=p_source_id)
   or (p_series_kind='G' and d.game_id=p_source_id and d.series_id is null and d.three_team_series_id is null)
   or (p_series_kind='D' and d.id=p_source_id and d.game_id is null and d.series_id is null and d.three_team_series_id is null)
  ) returning d.*
 ) select coalesce(jsonb_agg(to_jsonb(removed)),'[]'::jsonb),count(*)::int,coalesce(sum(amount),0) into v_rows,v_count,v_total from removed;
 if v_count>0 then
  insert into public.game_fee_deletion_history(series_kind,source_id,deleted_by,deleted_rows,deleted_count,total_amount)
  values(p_series_kind,p_source_id,auth.uid(),v_rows,v_count,v_total);
 end if;
 return jsonb_build_object('deleted_count',v_count,'total_amount',v_total);
end $$;
revoke all on function public.admin_delete_series_game_fees_v600(text,uuid) from public;
grant execute on function public.admin_delete_series_game_fees_v600(text,uuid) to authenticated;

create or replace function public.admin_adjust_game_fee_charge_v600(p_member_id uuid,p_month date,p_new_charge numeric,p_reason text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_month date:=date_trunc('month',p_month)::date; v_charge numeric; v_id uuid;
begin
 if not public.is_admin() then raise exception 'admin only'; end if;
 if p_month is null or p_member_id is null or p_new_charge is null or p_new_charge<0 or p_new_charge<>trunc(p_new_charge) or p_new_charge::text in ('NaN','Infinity','-Infinity') then raise exception '회원·월·게임비를 확인하세요.'; end if;
 if length(trim(coalesce(p_reason,'')))<2 then raise exception '변경 사유를 입력하세요.'; end if;
 perform 1 from public.members where id=p_member_id for update;
 if not found then raise exception '회원을 찾을 수 없습니다.'; end if;
 select coalesce((select sum(amount) from public.game_dues where member_id=p_member_id and deleted_at is null and date_trunc('month',due_date)::date=v_month),0)
 +coalesce((select sum(charge_delta) from public.member_game_fee_adjustments where member_id=p_member_id and adjustment_month=v_month),0) into v_charge;
 if v_charge<0 then raise exception '기존 조정 합계를 확인하세요.'; end if;
 if v_charge=p_new_charge then raise exception '변경된 금액이 없습니다.'; end if;
 insert into public.member_game_fee_adjustments(member_id,adjustment_month,charge_before,charge_after,balance_before,balance_after,charge_delta,balance_delta,reason)
 values(p_member_id,v_month,v_charge,p_new_charge,0,0,p_new_charge-v_charge,0,trim(p_reason)) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.admin_adjust_game_fee_charge_v600(uuid,date,numeric,text) from public;
grant execute on function public.admin_adjust_game_fee_charge_v600(uuid,date,numeric,text) to authenticated;

create or replace function public.admin_delete_charge_adjustment_v600(p_adjustment_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.member_game_fee_adjustments%rowtype; v_charge numeric;
begin
 if not public.is_admin() then raise exception 'admin only'; end if;
 select * into a from public.member_game_fee_adjustments where id=p_adjustment_id;
 if not found then raise exception '수정 내역이 없습니다.'; end if;
 perform 1 from public.members where id=a.member_id for update;
 select * into a from public.member_game_fee_adjustments where id=p_adjustment_id for update;
 if a.deleted_at is not null then return true; end if;
 if a.reversal_of is not null or a.reason='게임비 합계 입금 확인' then raise exception '취소 이력은 삭제할 수 없습니다.'; end if;
 select coalesce((select sum(amount) from public.game_dues where member_id=a.member_id and deleted_at is null and date_trunc('month',due_date)::date=a.adjustment_month),0)
 +coalesce((select sum(charge_delta) from public.member_game_fee_adjustments where member_id=a.member_id and adjustment_month=a.adjustment_month),0) into v_charge;
 if v_charge<0 or v_charge-a.charge_delta<0 then raise exception '후속 변경이 있어 삭제할 수 없습니다. 게임비를 먼저 수정하세요.'; end if;
 insert into public.member_game_fee_adjustments(member_id,adjustment_month,charge_before,charge_after,balance_before,balance_after,charge_delta,balance_delta,reason,reversal_of)
 values(a.member_id,a.adjustment_month,v_charge,v_charge-a.charge_delta,0,0,-a.charge_delta,0,'수정 내역 삭제: '||a.reason,a.id);
 update public.member_game_fee_adjustments set deleted_at=now(),deleted_by=auth.uid() where id=a.id;
 return true;
end $$;
revoke all on function public.admin_delete_charge_adjustment_v600(uuid) from public;
grant execute on function public.admin_delete_charge_adjustment_v600(uuid) to authenticated;

create or replace function public.member_get_game_fees_v600(p_month date,p_member_id uuid,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_month date:=date_trunc('month',p_month)::date; v_items jsonb; v_total numeric; v_adjustment numeric;
begin
 if p_month is null or p_member_id is null or coalesce(p_pin,'') !~ '^[0-9]{4}$' then raise exception '회원 인증 정보를 확인하세요.'; end if;
 if not public.operation_verify_member(p_member_id,p_pin) then raise exception '회원 인증에 실패했습니다.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'due_date',d.due_date,'amount',d.amount,
  'title',case when d.three_team_series_id is not null then coalesce(t.series_no::text,'-')||'차 3팀 시리즈'
   when d.series_id is not null then coalesce(s.series_no::text,'-')||'차 시리즈 · '||coalesce(s.team_a_name,'A팀')||' vs '||coalesce(s.team_b_name,'B팀')
   else '단판 경기' end) order by d.due_date desc,d.created_at desc),'[]'::jsonb),coalesce(sum(d.amount),0)
 into v_items,v_total from public.game_dues d left join public.match_series s on s.id=d.series_id left join public.three_team_series t on t.id=d.three_team_series_id
 where d.member_id=p_member_id and d.deleted_at is null and date_trunc('month',d.due_date)::date=v_month;
 select coalesce(sum(charge_delta),0) into v_adjustment from public.member_game_fee_adjustments where member_id=p_member_id and adjustment_month=v_month;
 return jsonb_build_object('items',v_items,'total_amount',v_total+v_adjustment,'adjustment_amount',v_adjustment);
end $$;
revoke all on function public.member_get_game_fees_v600(date,uuid,text) from public;
grant execute on function public.member_get_game_fees_v600(date,uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
