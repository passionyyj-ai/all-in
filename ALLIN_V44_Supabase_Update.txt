-- ALLIN V4.4 콜드패 즉시 시리즈 종료 SQL
-- 정확히 8:0 발생 시:
-- 1) 해당 세트 승리팀이 시리즈 승리
-- 2) 시리즈 즉시 종료
-- 3) 0점 팀원에게 4,000원/인 게임비 1회 청구
-- 4) 시리즈 종료 상태가 되어 팀 재편성 가능

create or replace function public.admin_record_series_set(
  p_series_id uuid,
  p_score_a int,
  p_score_b int
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  s public.match_series;
  v_set_no int;
  v_side text;
  v_a_wins int;
  v_b_wins int;
  v_target int;
  v_completed boolean:=false;
  v_cold_ended boolean:=false;
  v_loser_side text;
  v_loser_members uuid[];
  v_fee numeric(12,0);
  v_member_id uuid;
  v_meeting_date date;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_score_a<0 or p_score_b<0 or p_score_a=p_score_b then
    raise exception '올바른 점수를 입력하세요.';
  end if;

  select * into s
  from public.match_series
  where id=p_series_id
  for update;

  if s.id is null then raise exception '게임을 찾을 수 없습니다.'; end if;
  if s.status<>'active' then raise exception '이미 종료된 시리즈입니다.'; end if;

  v_target:=case when s.best_of=3 then 2 else 3 end;

  select coalesce(max(set_no),0)+1
  into v_set_no
  from public.series_sets
  where series_id=p_series_id;

  if v_set_no>s.best_of then raise exception '최대 세트 수를 초과했습니다.'; end if;

  v_side:=case when p_score_a>p_score_b then 'A' else 'B' end;
  v_cold_ended:=((p_score_a=8 and p_score_b=0) or (p_score_b=8 and p_score_a=0));

  insert into public.series_sets(
    series_id,set_no,score_a,score_b,winner_side,cold_game
  )
  values(
    p_series_id,v_set_no,p_score_a,p_score_b,v_side,v_cold_ended
  );

  select
    count(*) filter(where winner_side='A'),
    count(*) filter(where winner_side='B')
  into v_a_wins,v_b_wins
  from public.series_sets
  where series_id=p_series_id;

  update public.match_series
  set team_a_wins=v_a_wins,team_b_wins=v_b_wins
  where id=p_series_id;

  -- 콜드패는 승수와 관계없이 즉시 시리즈 종료
  if v_cold_ended then
    v_completed:=true;
    v_loser_side:=case when p_score_a=0 then 'A' else 'B' end;
    v_fee:=4000;
  elsif v_a_wins>=v_target or v_b_wins>=v_target then
    v_completed:=true;
    v_loser_side:=case when v_a_wins>=v_target then 'B' else 'A' end;
    v_fee:=2000;
  end if;

  if v_completed then
    if v_loser_side='A' then
      v_loser_members:=s.team_a_members;
    else
      v_loser_members:=s.team_b_members;
    end if;

    select meeting_date into v_meeting_date
    from public.meetings
    where id=s.meeting_id;

    update public.match_series
    set status='completed',
        winner_side=case when v_loser_side='A' then 'B' else 'A' end,
        winner_name=case when v_loser_side='A' then s.team_b_name else s.team_a_name end,
        loser_name=case when v_loser_side='A' then s.team_a_name else s.team_b_name end,
        fee_amount=v_fee,
        completed_at=now(),
        team_a_wins=v_a_wins,
        team_b_wins=v_b_wins
    where id=p_series_id;

    foreach v_member_id in array v_loser_members loop
      insert into public.game_dues(
        game_id,series_id,meeting_id,member_id,due_date,amount,status
      )
      values(
        null,p_series_id,s.meeting_id,v_member_id,v_meeting_date,v_fee,'unpaid'
      )
      on conflict(series_id,member_id) where series_id is not null
      do update set
        amount=excluded.amount,status='unpaid',
        paid_date=null,transaction_id=null;
    end loop;
  end if;

  return jsonb_build_object(
    'completed',v_completed,
    'cold_ended',v_cold_ended,
    'team_a_wins',v_a_wins,
    'team_b_wins',v_b_wins,
    'winner_name',case
      when not v_completed then null
      when v_loser_side='A' then s.team_b_name
      else s.team_a_name
    end,
    'fee_amount',case when v_completed then v_fee else null end
  );
end $$;

grant execute on function public.admin_record_series_set(uuid,int,int) to authenticated;
