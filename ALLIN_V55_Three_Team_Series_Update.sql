-- ALLIN V5.5 / Studio V4.3
-- 3팀 단판 승자연전 시리즈 + 1:1:1 초기화 + 게임비 2,000/4,000원
-- Supabase SQL Editor에서 전체 실행하세요.

create table if not exists public.three_team_series (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  series_no int not null,
  team_1_id uuid not null,
  team_2_id uuid not null,
  team_3_id uuid not null,
  team_1_name text not null,
  team_2_name text not null,
  team_3_name text not null,
  team_1_members uuid[] not null,
  team_2_members uuid[] not null,
  team_3_members uuid[] not null,
  cycle_no int not null default 1,
  reset_count int not null default 0,
  phase text not null default 'preliminary'
    check (phase in ('preliminary','loser_final','completed')),
  status text not null default 'active'
    check (status in ('active','completed','cancelled')),
  champion_team_id uuid,
  champion_name text,
  final_loser_team_id uuid,
  final_loser_name text,
  fee_amount numeric(12,0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(meeting_id,series_no)
);

create unique index if not exists uq_three_team_active_meeting
on public.three_team_series(meeting_id)
where status='active';

create table if not exists public.three_team_games (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.three_team_series(id) on delete cascade,
  cycle_no int not null,
  game_no int not null,
  phase text not null check(phase in ('preliminary','loser_final')),
  team_a_id uuid not null,
  team_b_id uuid not null,
  team_a_name text not null,
  team_b_name text not null,
  score_a int check(score_a is null or score_a>=0),
  score_b int check(score_b is null or score_b>=0),
  winner_team_id uuid,
  loser_team_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(series_id,game_no),
  check(team_a_id<>team_b_id),
  check(
    (score_a is null and score_b is null)
    or
    (score_a is not null and score_b is not null and score_a<>score_b)
  )
);

alter table public.game_dues
  add column if not exists three_team_series_id uuid
  references public.three_team_series(id) on delete cascade;

create unique index if not exists uq_game_dues_three_team_series_member
on public.game_dues(three_team_series_id,member_id)
where three_team_series_id is not null;

alter table public.three_team_series enable row level security;
alter table public.three_team_games enable row level security;

drop policy if exists admin_all on public.three_team_series;
create policy admin_all on public.three_team_series
for all to authenticated
using(public.is_admin())
with check(public.is_admin());

drop policy if exists admin_all on public.three_team_games;
create policy admin_all on public.three_team_games
for all to authenticated
using(public.is_admin())
with check(public.is_admin());

create or replace function public.three_team_members(
  p_series public.three_team_series,
  p_team_id uuid
)
returns uuid[]
language sql
stable
set search_path=public
as $$
  select case
    when p_team_id=p_series.team_1_id then p_series.team_1_members
    when p_team_id=p_series.team_2_id then p_series.team_2_members
    when p_team_id=p_series.team_3_id then p_series.team_3_members
    else '{}'::uuid[]
  end
$$;

create or replace function public.three_team_name(
  p_series public.three_team_series,
  p_team_id uuid
)
returns text
language sql
stable
set search_path=public
as $$
  select case
    when p_team_id=p_series.team_1_id then p_series.team_1_name
    when p_team_id=p_series.team_2_id then p_series.team_2_name
    when p_team_id=p_series.team_3_id then p_series.team_3_name
    else null
  end
$$;

create or replace function public.admin_start_three_team_series(
  p_meeting_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  s_id uuid;
  v_no int;
  t1 record;
  t2 record;
  t3 record;
  m1 uuid[];
  m2 uuid[];
  m3 uuid[];
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  if exists(select 1 from public.match_series where meeting_id=p_meeting_id and status='active')
     or exists(select 1 from public.three_team_series where meeting_id=p_meeting_id and status='active') then
    raise exception '이미 진행 중인 시리즈가 있습니다.';
  end if;

  if (select count(*) from public.teams where meeting_id=p_meeting_id)<>3 then
    raise exception '3팀 단판 시리즈는 정확히 3개 팀일 때만 시작할 수 있습니다.';
  end if;

  select * into t1 from public.teams where meeting_id=p_meeting_id order by team_no limit 1 offset 0;
  select * into t2 from public.teams where meeting_id=p_meeting_id order by team_no limit 1 offset 1;
  select * into t3 from public.teams where meeting_id=p_meeting_id order by team_no limit 1 offset 2;

  select coalesce(array_agg(member_id order by member_id),'{}'::uuid[]) into m1
  from public.team_members where team_id=t1.id;
  select coalesce(array_agg(member_id order by member_id),'{}'::uuid[]) into m2
  from public.team_members where team_id=t2.id;
  select coalesce(array_agg(member_id order by member_id),'{}'::uuid[]) into m3
  from public.team_members where team_id=t3.id;

  if cardinality(m1)=0 or cardinality(m2)=0 or cardinality(m3)=0 then
    raise exception '팀원이 없는 팀은 시리즈를 시작할 수 없습니다.';
  end if;

  select coalesce(max(series_no),0)+1 into v_no
  from public.three_team_series where meeting_id=p_meeting_id;

  insert into public.three_team_series(
    meeting_id,series_no,
    team_1_id,team_2_id,team_3_id,
    team_1_name,team_2_name,team_3_name,
    team_1_members,team_2_members,team_3_members
  )
  values(
    p_meeting_id,v_no,
    t1.id,t2.id,t3.id,
    t1.team_name,t2.team_name,t3.team_name,
    m1,m2,m3
  )
  returning id into s_id;

  insert into public.three_team_games(
    series_id,cycle_no,game_no,phase,
    team_a_id,team_b_id,team_a_name,team_b_name
  )
  values(
    s_id,1,1,'preliminary',
    t1.id,t2.id,t1.team_name,t2.team_name
  );

  return s_id;
end $$;

grant execute on function public.admin_start_three_team_series(uuid) to authenticated;

create or replace function public.admin_record_three_team_game(
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
  s public.three_team_series;
  g public.three_team_games;
  g1 public.three_team_games;
  g2 public.three_team_games;
  v_winner uuid;
  v_loser uuid;
  v_third uuid;
  v_next_no int;
  v_count int;
  v_wins1 int;
  v_wins2 int;
  v_wins3 int;
  v_champion uuid;
  v_final_a uuid;
  v_final_b uuid;
  v_final_loser uuid;
  v_fee numeric(12,0);
  v_members uuid[];
  v_member uuid;
  v_date date;
  v_reset boolean:=false;
  v_completed boolean:=false;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_score_a<0 or p_score_b<0 or p_score_a=p_score_b then
    raise exception '올바른 단판 점수를 입력하세요.';
  end if;

  select * into s
  from public.three_team_series
  where id=p_series_id
  for update;

  if s.id is null then raise exception '3팀 시리즈를 찾을 수 없습니다.'; end if;
  if s.status<>'active' then raise exception '이미 종료된 시리즈입니다.'; end if;

  select * into g
  from public.three_team_games
  where series_id=p_series_id
    and score_a is null
    and score_b is null
  order by game_no
  limit 1
  for update;

  if g.id is null then raise exception '입력할 예정 경기가 없습니다.'; end if;

  v_winner:=case when p_score_a>p_score_b then g.team_a_id else g.team_b_id end;
  v_loser:=case when p_score_a>p_score_b then g.team_b_id else g.team_a_id end;

  update public.three_team_games
  set score_a=p_score_a,
      score_b=p_score_b,
      winner_team_id=v_winner,
      loser_team_id=v_loser,
      completed_at=now()
  where id=g.id;

  select coalesce(max(game_no),0)+1 into v_next_no
  from public.three_team_games
  where series_id=p_series_id;

  if g.phase='loser_final' then
    v_final_loser:=v_loser;
    v_fee:=case when s.reset_count>0 then 4000 else 2000 end;
    v_members:=public.three_team_members(s,v_final_loser);

    select meeting_date into v_date
    from public.meetings where id=s.meeting_id;

    update public.three_team_series
    set status='completed',
        phase='completed',
        final_loser_team_id=v_final_loser,
        final_loser_name=public.three_team_name(s,v_final_loser),
        fee_amount=v_fee,
        completed_at=now()
    where id=s.id;

    foreach v_member in array v_members loop
      insert into public.game_dues(
        game_id,series_id,three_team_series_id,
        meeting_id,member_id,due_date,amount,status
      )
      values(
        null,null,s.id,s.meeting_id,v_member,v_date,v_fee,'unpaid'
      )
      on conflict(three_team_series_id,member_id)
      where three_team_series_id is not null
      do update set
        amount=excluded.amount,
        status='unpaid',
        paid_date=null,
        transaction_id=null;
    end loop;

    v_completed:=true;
  else
    select count(*) into v_count
    from public.three_team_games
    where series_id=s.id and cycle_no=s.cycle_no
      and phase='preliminary' and score_a is not null;

    if v_count=1 then
      if v_winner not in (s.team_1_id,s.team_2_id) then
        raise exception '첫 경기 팀 정보가 올바르지 않습니다.';
      end if;
      v_third:=s.team_3_id;

      insert into public.three_team_games(
        series_id,cycle_no,game_no,phase,
        team_a_id,team_b_id,team_a_name,team_b_name
      )
      values(
        s.id,s.cycle_no,v_next_no,'preliminary',
        v_winner,v_third,
        public.three_team_name(s,v_winner),
        public.three_team_name(s,v_third)
      );

    elsif v_count=2 then
      select * into g1 from public.three_team_games
      where series_id=s.id and cycle_no=s.cycle_no and phase='preliminary'
      order by game_no limit 1 offset 0;
      select * into g2 from public.three_team_games
      where series_id=s.id and cycle_no=s.cycle_no and phase='preliminary'
      order by game_no limit 1 offset 1;

      if g2.winner_team_id=g1.winner_team_id then
        v_champion:=g1.winner_team_id;
        v_final_a:=g1.loser_team_id;
        v_final_b:=g2.loser_team_id;

        update public.three_team_series
        set champion_team_id=v_champion,
            champion_name=public.three_team_name(s,v_champion),
            phase='loser_final'
        where id=s.id;

        insert into public.three_team_games(
          series_id,cycle_no,game_no,phase,
          team_a_id,team_b_id,team_a_name,team_b_name
        )
        values(
          s.id,s.cycle_no,v_next_no,'loser_final',
          v_final_a,v_final_b,
          public.three_team_name(s,v_final_a),
          public.three_team_name(s,v_final_b)
        );
      else
        insert into public.three_team_games(
          series_id,cycle_no,game_no,phase,
          team_a_id,team_b_id,team_a_name,team_b_name
        )
        values(
          s.id,s.cycle_no,v_next_no,'preliminary',
          g1.loser_team_id,g2.winner_team_id,
          public.three_team_name(s,g1.loser_team_id),
          public.three_team_name(s,g2.winner_team_id)
        );
      end if;

    elsif v_count=3 then
      select
        count(*) filter(where winner_team_id=s.team_1_id),
        count(*) filter(where winner_team_id=s.team_2_id),
        count(*) filter(where winner_team_id=s.team_3_id)
      into v_wins1,v_wins2,v_wins3
      from public.three_team_games
      where series_id=s.id and cycle_no=s.cycle_no
        and phase='preliminary' and score_a is not null;

      if v_wins1=1 and v_wins2=1 and v_wins3=1 then
        v_reset:=true;

        update public.three_team_series
        set reset_count=reset_count+1,
            cycle_no=cycle_no+1,
            champion_team_id=null,
            champion_name=null,
            phase='preliminary'
        where id=s.id
        returning * into s;

        insert into public.three_team_games(
          series_id,cycle_no,game_no,phase,
          team_a_id,team_b_id,team_a_name,team_b_name
        )
        values(
          s.id,s.cycle_no,v_next_no,'preliminary',
          s.team_1_id,s.team_2_id,s.team_1_name,s.team_2_name
        );
      else
        v_champion:=case
          when v_wins1=2 then s.team_1_id
          when v_wins2=2 then s.team_2_id
          when v_wins3=2 then s.team_3_id
          else null
        end;

        if v_champion is null then
          raise exception '3팀 승수 계산에 실패했습니다.';
        end if;

        select x into v_final_a
        from unnest(array[s.team_1_id,s.team_2_id,s.team_3_id]) x
        where x<>v_champion order by x limit 1;

        select x into v_final_b
        from unnest(array[s.team_1_id,s.team_2_id,s.team_3_id]) x
        where x<>v_champion and x<>v_final_a limit 1;

        update public.three_team_series
        set champion_team_id=v_champion,
            champion_name=public.three_team_name(s,v_champion),
            phase='loser_final'
        where id=s.id;

        insert into public.three_team_games(
          series_id,cycle_no,game_no,phase,
          team_a_id,team_b_id,team_a_name,team_b_name
        )
        values(
          s.id,s.cycle_no,v_next_no,'loser_final',
          v_final_a,v_final_b,
          public.three_team_name(s,v_final_a),
          public.three_team_name(s,v_final_b)
        );
      end if;
    end if;
  end if;

  select * into s from public.three_team_series where id=p_series_id;

  return jsonb_build_object(
    'completed',v_completed,
    'reset',v_reset,
    'cycle_no',s.cycle_no,
    'reset_count',s.reset_count,
    'phase',s.phase,
    'champion_name',s.champion_name,
    'final_loser_name',s.final_loser_name,
    'fee_amount',s.fee_amount
  );
end $$;

grant execute on function public.admin_record_three_team_game(uuid,int,int) to authenticated;

create or replace function public.admin_cancel_three_team_series(
  p_series_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  s public.three_team_series;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select * into s from public.three_team_series
  where id=p_series_id for update;

  if s.id is null then raise exception '시리즈를 찾을 수 없습니다.'; end if;
  if s.status='completed' then raise exception '종료된 시리즈는 취소할 수 없습니다.'; end if;

  delete from public.three_team_series where id=p_series_id;
  return true;
end $$;

grant execute on function public.admin_cancel_three_team_series(uuid) to authenticated;

notify pgrst, 'reload schema';
