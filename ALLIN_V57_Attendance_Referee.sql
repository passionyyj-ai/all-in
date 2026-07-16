-- ALLIN V5.7
-- 1. 신규 모임 기본 상태 = 미응답
-- 2. 12명 미만 2팀 / 12명 이상 3팀
-- 3. 2팀 시리즈 심판 지정 및 게임비/게임횟수 제외

alter table public.match_series
  add column if not exists referee_member_id uuid
  references public.members(id) on delete set null;

alter table public.match_series
  add column if not exists referee_name text;

create index if not exists ix_match_series_referee
on public.match_series(referee_member_id);

-- 총무 참석 저장:
-- 체크된 회원은 참석으로 저장하고,
-- 체크되지 않은 회원은 기존의 명시적 불참 응답은 유지하며 나머지는 미응답으로 둔다.
create or replace function public.admin_replace_attendance(
  p_meeting_id uuid,
  p_member_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  -- 기존 참석 응답 중 이번에 체크 해제된 건은 미응답으로 되돌림
  delete from public.attendance a
  where a.meeting_id=p_meeting_id
    and a.attending=true
    and not (a.member_id=any(coalesce(p_member_ids,'{}'::uuid[])));

  -- 체크된 회원은 참석으로 저장
  insert into public.attendance(meeting_id,member_id,attending,updated_at)
  select p_meeting_id,id,true,now()
  from public.members
  where active
    and id=any(coalesce(p_member_ids,'{}'::uuid[]))
  on conflict(meeting_id,member_id)
  do update set attending=true,updated_at=now();

  return true;
end $$;

grant execute on function public.admin_replace_attendance(uuid,uuid[])
to authenticated;

-- 과거 버전에서 신규 모임의 전원을 자동 불참 처리한 데이터 정리:
-- 진행 기록이 없고, 활성 회원 전원이 false로 저장된 열린 모임만 미응답으로 초기화
delete from public.attendance a
using public.meetings m
where a.meeting_id=m.id
  and m.status='open'
  and m.meeting_date>=current_date
  and not exists(
    select 1 from public.attendance x
    where x.meeting_id=m.id and x.attending=true
  )
  and (
    select count(*) from public.attendance x
    where x.meeting_id=m.id and x.attending=false
  ) >= (
    select count(*) from public.members mm where mm.active
  )
  and not exists(select 1 from public.teams t where t.meeting_id=m.id)
  and not exists(select 1 from public.games g where g.meeting_id=m.id)
  and not exists(select 1 from public.match_series s where s.meeting_id=m.id);

-- 12명 미만 2팀, 12명 이상 3팀
create or replace function public.admin_generate_balanced_teams_v51(
  p_meeting_id uuid
)
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

  if exists(select 1 from public.match_series where meeting_id=p_meeting_id and status='active')
     or exists(select 1 from public.three_team_series where meeting_id=p_meeting_id and status='active') then
    raise exception '진행 중인 시리즈가 있어 팀을 다시 편성할 수 없습니다.';
  end if;

  select count(*) into v_count
  from public.attendance
  where meeting_id=p_meeting_id and attending=true;

  if v_count<4 then
    raise exception '팀 편성에는 최소 4명의 참석자가 필요합니다.';
  end if;

  v_team_count:=case when v_count>=12 then 3 else 2 end;

  delete from public.teams where meeting_id=p_meeting_id;

  for v_team_no in 1..v_team_count loop
    insert into public.teams(meeting_id,team_no,team_name)
    values(p_meeting_id,v_team_no,v_team_no||'팀');
  end loop;

  for r in
    select a.member_id,m.position
    from public.attendance a
    join public.members m on m.id=a.member_id
    where a.meeting_id=p_meeting_id and a.attending=true
    order by
      case m.position
        when '공격' then 1
        when '토스' then 2
        when '좌수비' then 3
        when '우수비' then 4
        else 5
      end,
      random()
  loop
    v_idx:=v_idx+1;
    select id into v_team_id
    from public.teams
    where meeting_id=p_meeting_id
      and team_no=(((v_idx-1)%v_team_count)+1);

    insert into public.team_members(team_id,member_id)
    values(v_team_id,r.member_id);
  end loop;

  return jsonb_build_object(
    'team_count',v_team_count,
    'mode','balanced',
    'assigned_count',v_count
  );
end $$;

grant execute on function public.admin_generate_balanced_teams_v51(uuid)
to authenticated;

create or replace function public.admin_generate_random_teams_v51(
  p_meeting_id uuid
)
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

  if exists(select 1 from public.match_series where meeting_id=p_meeting_id and status='active')
     or exists(select 1 from public.three_team_series where meeting_id=p_meeting_id and status='active') then
    raise exception '진행 중인 시리즈가 있어 팀을 다시 편성할 수 없습니다.';
  end if;

  select count(*) into v_count
  from public.attendance
  where meeting_id=p_meeting_id and attending=true;

  if v_count<4 then
    raise exception '팀 편성에는 최소 4명의 참석자가 필요합니다.';
  end if;

  v_team_count:=case when v_count>=12 then 3 else 2 end;

  delete from public.teams where meeting_id=p_meeting_id;

  for v_team_no in 1..v_team_count loop
    insert into public.teams(meeting_id,team_no,team_name)
    values(p_meeting_id,v_team_no,v_team_no||'팀');
  end loop;

  for r in
    select a.member_id
    from public.attendance a
    where a.meeting_id=p_meeting_id and a.attending=true
    order by random()
  loop
    v_idx:=v_idx+1;
    select id into v_team_id
    from public.teams
    where meeting_id=p_meeting_id
      and team_no=(((v_idx-1)%v_team_count)+1);

    insert into public.team_members(team_id,member_id)
    values(v_team_id,r.member_id);
  end loop;

  return jsonb_build_object(
    'team_count',v_team_count,
    'mode','random',
    'assigned_count',v_count
  );
end $$;

grant execute on function public.admin_generate_random_teams_v51(uuid)
to authenticated;

-- 심판 인자를 포함한 2팀 시리즈 시작 함수
create or replace function public.admin_start_match_series_v57(
  p_meeting_id uuid,
  p_team_a_id uuid,
  p_team_b_id uuid,
  p_best_of int,
  p_referee_member_id uuid default null
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
  v_referee_name text;
  v_attendee_count int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_best_of not in (3,5) then raise exception '경기 방식은 3판 또는 5판이어야 합니다.'; end if;
  if p_team_a_id=p_team_b_id then raise exception '서로 다른 팀을 선택하세요.'; end if;

  if exists(select 1 from public.match_series where meeting_id=p_meeting_id and status='active')
     or exists(select 1 from public.three_team_series where meeting_id=p_meeting_id and status='active') then
    raise exception '이미 진행 중인 시리즈가 있습니다.';
  end if;

  select count(*) into v_attendee_count
  from public.attendance
  where meeting_id=p_meeting_id and attending=true;

  if v_attendee_count<12 and p_referee_member_id is null then
    raise exception '12명 미만 경기에서는 심판을 지정하세요.';
  end if;

  if p_referee_member_id is not null then
    select m.name into v_referee_name
    from public.members m
    join public.attendance a
      on a.member_id=m.id
     and a.meeting_id=p_meeting_id
     and a.attending=true
    where m.id=p_referee_member_id;

    if v_referee_name is null then
      raise exception '심판은 현재 모임 참석자 중에서 선택해야 합니다.';
    end if;
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

  select coalesce(max(series_no),0)+1 into v_no
  from public.match_series
  where meeting_id=p_meeting_id;

  insert into public.match_series(
    meeting_id,series_no,best_of,
    team_a_source_id,team_b_source_id,
    team_a_name,team_b_name,
    team_a_members,team_b_members,
    referee_member_id,referee_name
  )
  values(
    p_meeting_id,v_no,p_best_of,
    p_team_a_id,p_team_b_id,
    v_a_name,v_b_name,
    v_a_members,v_b_members,
    p_referee_member_id,v_referee_name
  )
  returning id into v_id;

  return v_id;
end $$;

grant execute on function public.admin_start_match_series_v57(uuid,uuid,uuid,int,uuid)
to authenticated;

-- 시리즈 종료 시 심판은 게임비 대상에서 제외
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

  if s.id is null then raise exception '시리즈를 찾을 수 없습니다.'; end if;
  if s.status<>'active' then raise exception '이미 종료된 시리즈입니다.'; end if;

  v_target:=case when s.best_of=3 then 2 else 3 end;

  select coalesce(max(set_no),0)+1 into v_set_no
  from public.series_sets
  where series_id=p_series_id;

  if v_set_no>s.best_of then raise exception '최대 세트 수를 초과했습니다.'; end if;

  v_side:=case when p_score_a>p_score_b then 'A' else 'B' end;

  insert into public.series_sets(
    series_id,set_no,score_a,score_b,winner_side,cold_game
  )
  values(
    p_series_id,v_set_no,p_score_a,p_score_b,v_side,
    abs(p_score_a-p_score_b)>=8
  );

  select
    count(*) filter(where winner_side='A'),
    count(*) filter(where winner_side='B')
  into v_a_wins,v_b_wins
  from public.series_sets
  where series_id=p_series_id;

  update public.match_series
  set team_a_wins=v_a_wins,
      team_b_wins=v_b_wins
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

    select case when exists(
      select 1 from public.series_sets ss
      where ss.series_id=p_series_id
        and ss.cold_game=true
        and ss.winner_side<>v_loser_side
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
      if s.referee_member_id is null or v_member_id<>s.referee_member_id then
        insert into public.game_dues(
          game_id,series_id,meeting_id,member_id,due_date,amount,status
        )
        values(
          null,p_series_id,s.meeting_id,v_member_id,v_meeting_date,v_fee,'unpaid'
        )
        on conflict(series_id,member_id) where series_id is not null
        do update set
          amount=excluded.amount,
          status='unpaid',
          paid_date=null,
          transaction_id=null;
      end if;
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
    'fee_amount',case when v_completed then v_fee else null end,
    'referee_name',s.referee_name
  );
end $$;

grant execute on function public.admin_record_series_set(uuid,int,int)
to authenticated;

-- 회원 포털에 현재 심판 표시
create or replace function public.get_member_portal_v53()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  m public.meetings;
  result jsonb;
  v_referee_name text;
begin
  select * into m
  from public.meetings
  where status='open' and meeting_date>=current_date
  order by meeting_date asc
  limit 1;

  if m.id is null then
    return jsonb_build_object(
      'meeting',null,
      'members','[]'::jsonb,
      'attending_count',0,
      'absent_count',0,
      'pending_count',0,
      'referee_name',null
    );
  end if;

  select referee_name into v_referee_name
  from public.match_series
  where meeting_id=m.id
  order by created_at desc
  limit 1;

  select jsonb_build_object(
    'meeting',jsonb_build_object('id',m.id,'date',m.meeting_date),
    'members',coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',x.id,
          'name',x.name,
          'position',x.position,
          'attending',a.attending
        )
        order by x.name
      ),
      '[]'::jsonb
    ),
    'attending_count',(
      select count(*) from public.attendance
      where meeting_id=m.id and attending=true
    ),
    'absent_count',(
      select count(*) from public.attendance
      where meeting_id=m.id and attending=false
    ),
    'pending_count',(
      select count(*) from public.members x2
      where x2.active
        and not exists(
          select 1 from public.attendance a2
          where a2.meeting_id=m.id and a2.member_id=x2.id
        )
    ),
    'referee_name',v_referee_name
  )
  into result
  from public.members x
  left join public.attendance a
    on a.meeting_id=m.id and a.member_id=x.id
  where x.active;

  return result;
end $$;

grant execute on function public.get_member_portal_v53()
to anon,authenticated;

-- 회원 실제 경기수: 심판으로 지정된 2팀 시리즈 제외
create or replace function public.get_my_member_dashboard(
  p_month date,
  p_member_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_start date:=date_trunc('month',p_month)::date;
  v_end date:=(date_trunc('month',p_month)+interval '1 month')::date;
  v_base jsonb;
  v_member public.members;
  v_paid boolean:=false;
  v_paid_date date;
  v_fee jsonb;
  v_total_due numeric:=0;
  v_paid_due numeric:=0;
  v_unpaid_due numeric:=0;
  v_game_count int:=0;
  v_game_dues jsonb;
begin
  if p_member_id is null or coalesce(p_pin,'') !~ '^[0-9]{4}$' then
    raise exception '회원 인증 정보가 올바르지 않습니다.';
  end if;

  select * into v_member
  from public.members
  where id=p_member_id
    and active=true
    and pin_hash=extensions.crypt(p_pin,pin_hash);

  if v_member.id is null then
    raise exception '회원 인증에 실패했습니다.';
  end if;

  select coalesce(f.paid,false),f.paid_date
  into v_paid,v_paid_date
  from public.fees f
  where f.member_id=v_member.id
    and f.fee_month=v_start;

  if not found then
    v_paid:=false;
    v_paid_date:=null;
  end if;

  select
    coalesce(sum(d.amount),0),
    coalesce(sum(d.amount) filter(where d.status='paid'),0),
    coalesce(sum(d.amount) filter(where d.status='unpaid'),0)
  into v_total_due,v_paid_due,v_unpaid_due
  from public.game_dues d
  where d.member_id=v_member.id
    and d.due_date>=v_start
    and d.due_date<v_end;

  with participated_events as (
    select 'G:'||g.id::text as event_key
    from public.games g
    join public.meetings mt on mt.id=g.meeting_id
    where mt.meeting_date>=v_start
      and mt.meeting_date<v_end
      and g.score_a is not null
      and g.score_b is not null
      and exists(
        select 1 from public.team_members tm
        where tm.member_id=v_member.id
          and tm.team_id in (g.team_a,g.team_b)
      )

    union

    select 'S:'||s.id::text
    from public.match_series s
    join public.meetings mt on mt.id=s.meeting_id
    where mt.meeting_date>=v_start
      and mt.meeting_date<v_end
      and s.status='completed'
      and s.referee_member_id is distinct from v_member.id
      and (
        v_member.id=any(coalesce(s.team_a_members,'{}'::uuid[]))
        or v_member.id=any(coalesce(s.team_b_members,'{}'::uuid[]))
      )

    union

    select 'T:'||tg.id::text
    from public.three_team_games tg
    join public.three_team_series ts on ts.id=tg.series_id
    join public.meetings mt on mt.id=ts.meeting_id
    where mt.meeting_date>=v_start
      and mt.meeting_date<v_end
      and tg.score_a is not null
      and tg.score_b is not null
      and (
        v_member.id=any(public.three_team_members(ts,tg.team_a_id))
        or v_member.id=any(public.three_team_members(ts,tg.team_b_id))
      )
  )
  select count(*) into v_game_count
  from participated_events;

  v_base:=public.get_member_dashboard(v_start);

  v_fee:=jsonb_build_object(
    'total',1,
    'paid',case when v_paid then 1 else 0 end,
    'unpaid',case when v_paid then 0 else 1 end,
    'rate',case when v_paid then 100 else 0 end,
    'members',jsonb_build_array(jsonb_build_object(
      'id',v_member.id,
      'name',v_member.name,
      'paid',v_paid,
      'paid_date',v_paid_date
    ))
  );

  v_game_dues:=jsonb_build_object(
    'total_amount',v_total_due,
    'paid_amount',v_paid_due,
    'unpaid_amount',v_unpaid_due,
    'game_count',v_game_count,
    'items',jsonb_build_array(jsonb_build_object(
      'id',v_member.id,
      'name',v_member.name,
      'total_amount',v_total_due,
      'paid_amount',v_paid_due,
      'unpaid_amount',v_unpaid_due,
      'game_count',v_game_count
    ))
  );

  v_base:=jsonb_set(v_base,'{fee}',v_fee,true);
  v_base:=jsonb_set(v_base,'{game_dues}',v_game_dues,true);
  return v_base;
end $$;

grant execute on function public.get_my_member_dashboard(date,uuid,text)
to anon,authenticated;

notify pgrst, 'reload schema';
