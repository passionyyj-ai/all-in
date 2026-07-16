-- ALLIN V5.1 DB UPDATE
-- 참석자 전원 강제 팀 배분 + 관리자 직접 팀 지정

create or replace function public.admin_generate_random_teams_v51(p_meeting_id uuid)
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
  if exists(select 1 from public.match_series where meeting_id=p_meeting_id and status='active') then
    raise exception '진행 중인 시리즈가 있어 팀을 다시 편성할 수 없습니다.';
  end if;

  delete from public.teams where meeting_id=p_meeting_id;
  select count(*) into v_count from public.attendance where meeting_id=p_meeting_id and attending=true;
  if v_count=0 then return jsonb_build_object('team_count',0,'mode','random','assigned_count',0); end if;

  v_team_count:=greatest(1,least(4,floor(v_count/4.0)::int));
  for v_team_no in 1..v_team_count loop
    insert into public.teams(meeting_id,team_no,team_name)
    values(p_meeting_id,v_team_no,chr(64+v_team_no)||'팀');
  end loop;

  for r in select member_id from public.attendance where meeting_id=p_meeting_id and attending=true order by random() loop
    v_idx:=v_idx+1;
    select id into v_team_id from public.teams
      where meeting_id=p_meeting_id and team_no=(((v_idx-1)%v_team_count)+1);
    insert into public.team_members(team_id,member_id) values(v_team_id,r.member_id);
  end loop;

  return jsonb_build_object('team_count',v_team_count,'mode','random','assigned_count',v_count);
end $$;
grant execute on function public.admin_generate_random_teams_v51(uuid) to authenticated;

create or replace function public.admin_generate_balanced_teams_v51(p_meeting_id uuid)
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
  v_idx int:=0;
  r record;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if exists(select 1 from public.match_series where meeting_id=p_meeting_id and status='active') then
    raise exception '진행 중인 시리즈가 있어 팀을 다시 편성할 수 없습니다.';
  end if;

  delete from public.teams where meeting_id=p_meeting_id;
  select count(*) into v_count from public.attendance where meeting_id=p_meeting_id and attending=true;
  if v_count=0 then return jsonb_build_object('team_count',0,'mode','balanced','assigned_count',0); end if;

  v_team_count:=greatest(1,least(4,floor(v_count/4.0)::int));
  for v_team_no in 1..v_team_count loop
    insert into public.teams(meeting_id,team_no,team_name)
    values(p_meeting_id,v_team_no,chr(64+v_team_no)||'팀');
  end loop;

  -- 포지션별 무작위 정렬 후 라운드로빈 배치하여 전원을 균등 배분
  for r in
    select a.member_id,m.position
    from public.attendance a
    join public.members m on m.id=a.member_id
    where a.meeting_id=p_meeting_id and a.attending=true
    order by case m.position when '공격' then 1 when '토스' then 2 when '좌수비' then 3 when '우수비' then 4 else 5 end, random()
  loop
    v_idx:=v_idx+1;
    select id into v_team_id from public.teams
      where meeting_id=p_meeting_id and team_no=(((v_idx-1)%v_team_count)+1);
    insert into public.team_members(team_id,member_id) values(v_team_id,r.member_id);
  end loop;

  return jsonb_build_object('team_count',v_team_count,'mode','balanced','assigned_count',v_count);
end $$;
grant execute on function public.admin_generate_balanced_teams_v51(uuid) to authenticated;

create or replace function public.admin_assign_member_team_v51(
  p_meeting_id uuid,
  p_member_id uuid,
  p_team_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if exists(select 1 from public.match_series where meeting_id=p_meeting_id and status='active') then
    raise exception '진행 중인 시리즈에서는 팀을 변경할 수 없습니다.';
  end if;
  if not exists(select 1 from public.attendance where meeting_id=p_meeting_id and member_id=p_member_id and attending=true) then
    raise exception '해당 회원은 현재 모임 참석자가 아닙니다.';
  end if;
  if not exists(select 1 from public.teams where id=p_team_id and meeting_id=p_meeting_id) then
    raise exception '선택한 팀이 현재 모임의 팀이 아닙니다.';
  end if;

  delete from public.team_members tm
  using public.teams t
  where tm.team_id=t.id and t.meeting_id=p_meeting_id and tm.member_id=p_member_id;

  insert into public.team_members(team_id,member_id) values(p_team_id,p_member_id);
end $$;
grant execute on function public.admin_assign_member_team_v51(uuid,uuid,uuid) to authenticated;
