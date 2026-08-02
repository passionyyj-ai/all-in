-- ALLIN V5.9.2 - 시리즈별 게임비 직접 입력
-- V5.9.1 SQL 적용 후 실행하세요.

alter table public.match_series add column if not exists manual_fee_amount numeric(12,0) check(manual_fee_amount>=0);
alter table public.three_team_series add column if not exists manual_fee_amount numeric(12,0) check(manual_fee_amount>=0);

create or replace function public.admin_set_series_fee_v592(p_series_kind text,p_series_id uuid,p_fee_amount numeric)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_fee_amount is null or p_fee_amount<0 then raise exception '게임비를 확인하세요.'; end if;
  if p_series_kind='normal' then
    update public.match_series set manual_fee_amount=p_fee_amount where id=p_series_id and status='active';
  elsif p_series_kind='three_team' then
    update public.three_team_series set manual_fee_amount=p_fee_amount where id=p_series_id and status='active';
  else raise exception '시리즈 유형을 확인하세요.';
  end if;
  if not found then raise exception '진행 중인 시리즈를 찾을 수 없습니다.'; end if;
  return true;
end $$;
grant execute on function public.admin_set_series_fee_v592(text,uuid,numeric) to authenticated;

create or replace function public.operation_set_series_fee_v592(
  p_operator_member_id uuid,p_operator_pin text,p_series_kind text,p_series_id uuid,p_fee_amount numeric
)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not public.operation_verify_member(p_operator_member_id,p_operator_pin) then raise exception '회원 인증에 실패했습니다.'; end if;
  if p_fee_amount is null or p_fee_amount<0 then raise exception '게임비를 확인하세요.'; end if;
  if p_series_kind='normal' then
    update public.match_series set manual_fee_amount=p_fee_amount where id=p_series_id and status='active';
  elsif p_series_kind='three_team' then
    update public.three_team_series set manual_fee_amount=p_fee_amount where id=p_series_id and status='active';
  else raise exception '시리즈 유형을 확인하세요.';
  end if;
  if not found then raise exception '진행 중인 시리즈를 찾을 수 없습니다.'; end if;
  return true;
end $$;
grant execute on function public.operation_set_series_fee_v592(uuid,text,text,uuid,numeric) to anon,authenticated;

create or replace function public.apply_manual_series_fee_v592()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='completed' and new.manual_fee_amount is not null then new.fee_amount:=new.manual_fee_amount; end if;
  return new;
end $$;
drop trigger if exists trg_manual_match_series_fee_v592 on public.match_series;
create trigger trg_manual_match_series_fee_v592 before update on public.match_series
for each row execute function public.apply_manual_series_fee_v592();
drop trigger if exists trg_manual_three_series_fee_v592 on public.three_team_series;
create trigger trg_manual_three_series_fee_v592 before update on public.three_team_series
for each row execute function public.apply_manual_series_fee_v592();

create or replace function public.apply_manual_game_due_fee_v592()
returns trigger language plpgsql set search_path=public as $$
declare v_fee numeric(12,0);
begin
  if new.series_id is not null then select manual_fee_amount into v_fee from public.match_series where id=new.series_id;
  elsif new.three_team_series_id is not null then select manual_fee_amount into v_fee from public.three_team_series where id=new.three_team_series_id;
  end if;
  if v_fee is not null then new.amount:=v_fee; end if;
  return new;
end $$;
drop trigger if exists trg_manual_game_due_fee_v592 on public.game_dues;
create trigger trg_manual_game_due_fee_v592 before insert or update on public.game_dues
for each row execute function public.apply_manual_game_due_fee_v592();

notify pgrst,'reload schema';
