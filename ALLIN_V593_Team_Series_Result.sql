-- ALLIN V5.9.3 - 팀별 시리즈 결과(승/패/콜드패) 직접 선택 및 패배팀 청구
-- V5.9.2 SQL 적용 후 실행하세요.

alter table public.match_series add column if not exists team_a_result text check(team_a_result in ('win','loss','cold_loss'));
alter table public.match_series add column if not exists team_b_result text check(team_b_result in ('win','loss','cold_loss'));

create or replace function public.fill_match_series_result_v593()
returns trigger language plpgsql set search_path=public as $$
declare v_cold boolean;
begin
  if new.status='completed' and (new.team_a_result is null or new.team_b_result is null) then
    select exists(select 1 from public.series_sets where series_id=new.id and cold_game=true) into v_cold;
    if new.winner_side='A' then new.team_a_result:='win';new.team_b_result:=case when v_cold then 'cold_loss' else 'loss' end;
    else new.team_b_result:='win';new.team_a_result:=case when v_cold then 'cold_loss' else 'loss' end;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_fill_match_series_result_v593 on public.match_series;
create trigger trg_fill_match_series_result_v593 before update on public.match_series
for each row execute function public.fill_match_series_result_v593();

create or replace function public.admin_complete_match_series_v593(
  p_series_id uuid,p_team_a_result text,p_team_b_result text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.match_series; v_loser_members uuid[]; v_member uuid; v_date date; v_fee numeric(12,0); v_loser_result text;
begin
  if not public.is_admin() and coalesce(current_setting('app.operation_authorized',true),'')<>'on' then raise exception 'admin only'; end if;
  if p_team_a_result not in ('win','loss','cold_loss') or p_team_b_result not in ('win','loss','cold_loss') then raise exception '결과를 확인하세요.'; end if;
  if (p_team_a_result='win')=(p_team_b_result='win') then raise exception '한 팀만 승으로 선택하세요.'; end if;
  select * into s from public.match_series where id=p_series_id for update;
  if s.id is null then raise exception '시리즈를 찾을 수 없습니다.'; end if;
  if s.status<>'active' then raise exception '이미 종료된 시리즈입니다.'; end if;
  select meeting_date into v_date from public.meetings where id=s.meeting_id;
  v_fee:=coalesce(s.manual_fee_amount,case when p_team_a_result='cold_loss' or p_team_b_result='cold_loss' then 4000 else 2000 end);
  if p_team_a_result='win' then
    v_loser_members:=s.team_b_members;v_loser_result:=p_team_b_result;
    update public.match_series set status='completed',winner_side='A',winner_name=team_a_name,loser_name=team_b_name,
      team_a_result='win',team_b_result=p_team_b_result,team_a_wins=case when best_of=3 then 2 else 3 end,fee_amount=v_fee,completed_at=now() where id=s.id;
  else
    v_loser_members:=s.team_a_members;v_loser_result:=p_team_a_result;
    update public.match_series set status='completed',winner_side='B',winner_name=team_b_name,loser_name=team_a_name,
      team_a_result=p_team_a_result,team_b_result='win',team_b_wins=case when best_of=3 then 2 else 3 end,fee_amount=v_fee,completed_at=now() where id=s.id;
  end if;
  foreach v_member in array v_loser_members loop
    insert into public.game_dues(game_id,series_id,meeting_id,member_id,due_date,amount,status)
    values(null,s.id,s.meeting_id,v_member,v_date,v_fee,'unpaid')
    on conflict(series_id,member_id) where series_id is not null do update set amount=excluded.amount,status='unpaid',paid_date=null,transaction_id=null;
  end loop;
  return jsonb_build_object('completed',true,'winner_name',case when p_team_a_result='win' then s.team_a_name else s.team_b_name end,
    'loser_name',case when p_team_a_result='win' then s.team_b_name else s.team_a_name end,'loser_result',v_loser_result,'fee_amount',v_fee);
end $$;
grant execute on function public.admin_complete_match_series_v593(uuid,text,text) to authenticated;

create or replace function public.operation_complete_match_series_v593(
  p_operator_member_id uuid,p_operator_pin text,p_series_id uuid,p_team_a_result text,p_team_b_result text
)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.operation_verify_member(p_operator_member_id,p_operator_pin) then raise exception '회원 인증에 실패했습니다.'; end if;
  perform set_config('app.operation_authorized','on',true);
  return public.admin_complete_match_series_v593(p_series_id,p_team_a_result,p_team_b_result);
end $$;
grant execute on function public.operation_complete_match_series_v593(uuid,text,uuid,text,text) to anon,authenticated;

-- 기존 종료 시리즈도 저장된 승패/콜드 기록으로 결과 표시를 보완합니다.
update public.match_series s set
  team_a_result=case when s.winner_side='A' then 'win' when exists(select 1 from public.series_sets ss where ss.series_id=s.id and ss.cold_game) then 'cold_loss' else 'loss' end,
  team_b_result=case when s.winner_side='B' then 'win' when exists(select 1 from public.series_sets ss where ss.series_id=s.id and ss.cold_game) then 'cold_loss' else 'loss' end
where s.status='completed' and (s.team_a_result is null or s.team_b_result is null);

notify pgrst,'reload schema';
