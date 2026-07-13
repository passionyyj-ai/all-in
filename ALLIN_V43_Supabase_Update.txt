-- ALLIN V4.3 간단 경기 규칙 적용 SQL
-- 1. 참석 인원에 따라 최대 4팀까지만 생성
-- 2. 각 게임(3판2승/5판3승)의 최종 패배팀에 게임비 1회 청구
-- 3. 일반 패배 2,000원/인
-- 4. 콜드패는 정확히 8:0 세트 패배이며, 해당 게임 최종 패배팀이 콜드패한 경우 4,000원/인

create or replace function public.admin_generate_random_teams_v42(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count int;
  v_team_count int;
  v_team_no int;
  v_team_id uuid;
  r record;
  v_idx int:=0;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  if exists(
    select 1 from public.match_series
    where meeting_id=p_meeting_id and status='active'
  ) then
    raise exception '진행 중인 게임이 있어 팀을 다시 편성할 수 없습니다.';
  end if;

  delete from public.teams where meeting_id=p_meeting_id;

  select count(*) into v_count
  from public.attendance
  where meeting_id=p_meeting_id and attending=true;

  v_team_count:=least(4,floor(v_count/4.0)::int);

  if v_team_count<1 then
    return jsonb_build_object('team_count',0,'mode','random');
  end if;

  for v_team_no in 1..v_team_count loop
    insert into public.teams(meeting_id,team_no,team_name)
    values(p_meeting_id,v_team_no,v_team_no||'팀');
  end loop;

  for r in
    select member_id
    from public.attendance
    where meeting_id=p_meeting_id and attending=true
    order by random()
    limit (v_team_count*4)
  loop
    v_idx:=v_idx+1;

    select id into v_team_id
    from public.teams
    where meeting_id=p_meeting_id
      and team_no=((v_idx-1)/4)+1;

    insert into public.team_members(team_id,member_id)
    values(v_team_id,r.member_id);
  end loop;

  return jsonb_build_object('team_count',v_team_count,'mode','random');
end $$;

grant execute on function public.admin_generate_random_teams_v42(uuid) to authenticated;

create or replace function public.admin_generate_balanced_teams_v42(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  n int;
  i int;
  t uuid;
  p text;
  mid uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  if exists(
    select 1 from public.match_series
    where meeting_id=p_meeting_id and status='active'
  ) then
    raise exception '진행 중인 게임이 있어 팀을 다시 편성할 수 없습니다.';
  end if;

  delete from public.teams where meeting_id=p_meeting_id;

  select least(4,min(c)) into n
  from (
    select p.position,count(m.id) c
    from (values('공격'),('토스'),('좌수비'),('우수비')) p(position)
    left join public.members m
      on m.position=p.position
     and m.id in (
       select member_id from public.attendance
       where meeting_id=p_meeting_id and attending
     )
    group by p.position
  ) z;

  n:=coalesce(n,0);

  for i in 1..n loop
    insert into public.teams(meeting_id,team_no,team_name)
    values(p_meeting_id,i,i||'팀')
    returning id into t;

    foreach p in array array['공격','토스','좌수비','우수비'] loop
      select m.id into mid
      from public.members m
      where m.position=p
        and m.id in (
          select member_id from public.attendance
          where meeting_id=p_meeting_id and attending
        )
        and not exists(
          select 1
          from public.team_members tm
          join public.teams tt on tt.id=tm.team_id
          where tt.meeting_id=p_meeting_id and tm.member_id=m.id
        )
      order by random()
      limit 1;

      if mid is not null then
        insert into public.team_members(team_id,member_id)
        values(t,mid);
      end if;
    end loop;
  end loop;

  return jsonb_build_object('team_count',n,'mode','balanced');
end $$;

grant execute on function public.admin_generate_balanced_teams_v42(uuid) to authenticated;

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
  if s.status<>'active' then raise exception '이미 종료된 게임입니다.'; end if;

  v_target:=case when s.best_of=3 then 2 else 3 end;

  select coalesce(max(set_no),0)+1
  into v_set_no
  from public.series_sets
  where series_id=p_series_id;

  if v_set_no>s.best_of then raise exception '최대 세트 수를 초과했습니다.'; end if;

  v_side:=case when p_score_a>p_score_b then 'A' else 'B' end;

  insert into public.series_sets(
    series_id,set_no,score_a,score_b,winner_side,cold_game
  )
  values(
    p_series_id,v_set_no,p_score_a,p_score_b,v_side,
    ((p_score_a=8 and p_score_b=0) or (p_score_b=8 and p_score_a=0))
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

  if v_a_wins>=v_target or v_b_wins>=v_target then
    v_completed:=true;

    if v_a_wins>=v_target then
      v_loser_side:='B';
      v_loser_members:=s.team_b_members;
    else
      v_loser_side:='A';
      v_loser_members:=s.team_a_members;
    end if;

    -- 최종 패배팀이 정확히 8:0으로 진 세트가 있으면 콜드패 4,000원
    select case when exists(
      select 1
      from public.series_sets ss
      where ss.series_id=p_series_id
        and ss.cold_game=true
        and (
          (v_loser_side='A' and ss.score_a=0 and ss.score_b=8)
          or
          (v_loser_side='B' and ss.score_b=0 and ss.score_a=8)
        )
    ) then 4000 else 2000 end
    into v_fee;

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
