-- ALLIN V5.9.6
-- 팀 수 직접 선택(자동/2팀/3팀) + 기존 대기 인원 유지

create or replace function public.admin_generate_balanced_teams_v596(
  p_meeting_id uuid,
  p_team_count int default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_count int;
  v_team_count int;
  v_team_no int;
  v_team_id uuid;
  v_min_skill int;
  v_max_skill int;
  v_had_teams boolean;
  v_excluded_ids uuid[] := '{}'::uuid[];
  r record;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_team_count is not null and p_team_count not in (2,3) then
    raise exception '팀 수는 2팀 또는 3팀만 선택할 수 있습니다.';
  end if;
  if exists(select 1 from public.match_series where meeting_id=p_meeting_id and status='active')
     or exists(select 1 from public.three_team_series where meeting_id=p_meeting_id and status='active') then
    raise exception '진행 중인 시리즈가 있어 팀을 다시 편성할 수 없습니다.';
  end if;

  select exists(select 1 from public.teams where meeting_id=p_meeting_id) into v_had_teams;
  if v_had_teams then
    select coalesce(array_agg(a.member_id),'{}'::uuid[]) into v_excluded_ids
    from public.attendance a
    where a.meeting_id=p_meeting_id and a.attending=true
      and not exists(
        select 1 from public.team_members tm
        join public.teams t on t.id=tm.team_id
        where t.meeting_id=p_meeting_id and tm.member_id=a.member_id
      );
  end if;

  select count(*) into v_count
  from public.attendance a
  where a.meeting_id=p_meeting_id and a.attending=true
    and not (a.member_id=any(v_excluded_ids));

  v_team_count:=coalesce(p_team_count,case when v_count>=12 then 3 else 2 end);
  if v_count < v_team_count*2 then
    raise exception '%팀 편성에는 대기자를 제외하고 최소 %명이 필요합니다.',v_team_count,v_team_count*2;
  end if;

  delete from public.teams where meeting_id=p_meeting_id;
  drop table if exists pg_temp.allin_team_balance_v596;
  create temporary table allin_team_balance_v596(
    team_id uuid primary key, team_no int not null,
    member_count int not null default 0, skill_total int not null default 0,
    attack_count int not null default 0, toss_count int not null default 0,
    left_count int not null default 0, right_count int not null default 0
  ) on commit drop;

  for v_team_no in 1..v_team_count loop
    insert into public.teams(meeting_id,team_no,team_name)
    values(p_meeting_id,v_team_no,v_team_no||'팀') returning id into v_team_id;
    insert into allin_team_balance_v596(team_id,team_no) values(v_team_id,v_team_no);
  end loop;

  for r in
    select a.member_id,m.position,coalesce(m.skill_level,3)::int as skill_level
    from public.attendance a join public.members m on m.id=a.member_id
    where a.meeting_id=p_meeting_id and a.attending=true
      and not (a.member_id=any(v_excluded_ids))
    order by coalesce(m.skill_level,3) desc,random()
  loop
    select b.team_id into v_team_id from allin_team_balance_v596 b
    order by b.member_count,
      (case r.position when '공격' then b.attack_count when '토스' then b.toss_count
       when '좌수비' then b.left_count when '우수비' then b.right_count else 0 end)*6+b.skill_total,
      b.skill_total,random() limit 1;
    insert into public.team_members(team_id,member_id) values(v_team_id,r.member_id);
    update allin_team_balance_v596 set
      member_count=member_count+1, skill_total=skill_total+r.skill_level,
      attack_count=attack_count+case when r.position='공격' then 1 else 0 end,
      toss_count=toss_count+case when r.position='토스' then 1 else 0 end,
      left_count=left_count+case when r.position='좌수비' then 1 else 0 end,
      right_count=right_count+case when r.position='우수비' then 1 else 0 end
    where team_id=v_team_id;
  end loop;

  select min(skill_total),max(skill_total) into v_min_skill,v_max_skill from allin_team_balance_v596;
  return jsonb_build_object('team_count',v_team_count,'mode','position_skill_balanced',
    'assigned_count',v_count,'excluded_count',cardinality(v_excluded_ids),
    'min_skill_total',v_min_skill,'max_skill_total',v_max_skill,'skill_gap',v_max_skill-v_min_skill);
end $$;

create or replace function public.admin_generate_random_teams_v596(
  p_meeting_id uuid,
  p_team_count int default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count int; v_team_count int; v_team_no int; v_team_id uuid; v_idx int:=0;
  v_had_teams boolean; v_excluded_ids uuid[] := '{}'::uuid[]; r record;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_team_count is not null and p_team_count not in (2,3) then raise exception '팀 수는 2팀 또는 3팀만 선택할 수 있습니다.'; end if;
  if exists(select 1 from public.match_series where meeting_id=p_meeting_id and status='active')
     or exists(select 1 from public.three_team_series where meeting_id=p_meeting_id and status='active') then
    raise exception '진행 중인 시리즈가 있어 팀을 다시 편성할 수 없습니다.';
  end if;
  select exists(select 1 from public.teams where meeting_id=p_meeting_id) into v_had_teams;
  if v_had_teams then
    select coalesce(array_agg(a.member_id),'{}'::uuid[]) into v_excluded_ids
    from public.attendance a where a.meeting_id=p_meeting_id and a.attending=true
      and not exists(select 1 from public.team_members tm join public.teams t on t.id=tm.team_id
                     where t.meeting_id=p_meeting_id and tm.member_id=a.member_id);
  end if;
  select count(*) into v_count from public.attendance a
  where a.meeting_id=p_meeting_id and a.attending=true and not (a.member_id=any(v_excluded_ids));
  v_team_count:=coalesce(p_team_count,case when v_count>=12 then 3 else 2 end);
  if v_count < v_team_count*2 then
    raise exception '%팀 편성에는 대기자를 제외하고 최소 %명이 필요합니다.',v_team_count,v_team_count*2;
  end if;
  delete from public.teams where meeting_id=p_meeting_id;
  for v_team_no in 1..v_team_count loop
    insert into public.teams(meeting_id,team_no,team_name) values(p_meeting_id,v_team_no,v_team_no||'팀');
  end loop;
  for r in select a.member_id from public.attendance a
    where a.meeting_id=p_meeting_id and a.attending=true and not (a.member_id=any(v_excluded_ids)) order by random()
  loop
    v_idx:=v_idx+1;
    select id into v_team_id from public.teams where meeting_id=p_meeting_id and team_no=(((v_idx-1)%v_team_count)+1);
    insert into public.team_members(team_id,member_id) values(v_team_id,r.member_id);
  end loop;
  return jsonb_build_object('team_count',v_team_count,'mode','random','assigned_count',v_count,
    'excluded_count',cardinality(v_excluded_ids));
end $$;

create or replace function public.operation_generate_balanced_teams_v596(
  p_operator_member_id uuid,p_operator_pin text,p_meeting_id uuid,p_team_count int default null
)
returns jsonb language plpgsql security definer set search_path=public
as $$ begin
  if not public.operation_verify_member(p_operator_member_id,p_operator_pin) then raise exception '회원 인증에 실패했습니다.'; end if;
  perform set_config('app.operation_authorized','on',true);
  return public.admin_generate_balanced_teams_v596(p_meeting_id,p_team_count);
end $$;

create or replace function public.operation_generate_random_teams_v596(
  p_operator_member_id uuid,p_operator_pin text,p_meeting_id uuid,p_team_count int default null
)
returns jsonb language plpgsql security definer set search_path=public
as $$ begin
  if not public.operation_verify_member(p_operator_member_id,p_operator_pin) then raise exception '회원 인증에 실패했습니다.'; end if;
  perform set_config('app.operation_authorized','on',true);
  return public.admin_generate_random_teams_v596(p_meeting_id,p_team_count);
end $$;

grant execute on function public.admin_generate_balanced_teams_v596(uuid,int) to authenticated;
grant execute on function public.admin_generate_random_teams_v596(uuid,int) to authenticated;
grant execute on function public.operation_generate_balanced_teams_v596(uuid,text,uuid,int) to anon,authenticated;
grant execute on function public.operation_generate_random_teams_v596(uuid,text,uuid,int) to anon,authenticated;
notify pgrst,'reload schema';
