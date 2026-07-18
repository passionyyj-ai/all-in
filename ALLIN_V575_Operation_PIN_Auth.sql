-- ALLIN V5.7.5
-- 회원 PIN 기반 경기운영 전용 권한
-- 총무 Supabase 로그인 세션 없이 참석/팀/경기 운영 기능만 허용

-- 기존 관리자 권한 또는 검증된 operation wrapper 내부 호출만 관리자 함수 허용
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select
    coalesce(current_setting('app.operation_authorized',true),'')='on'
    or exists(
      select 1
      from public.admin_users
      where user_id=auth.uid()
    )
$$;

create or replace function public.operation_verify_member(
  p_member_id uuid,
  p_pin text
)
returns boolean
language sql
stable
security definer
set search_path=public,extensions
as $$
  select exists(
    select 1
    from public.members m
    where m.id=p_member_id
      and m.active=true
      and m.pin_hash is not null
      and m.pin_hash=extensions.crypt(p_pin,m.pin_hash)
  )
$$;

revoke all on function public.operation_verify_member(uuid,text) from public;
grant execute on function public.operation_verify_member(uuid,text) to anon,authenticated;

-- 경기운영 전용 데이터 조회
create or replace function public.operation_get_data(
  p_member_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_result jsonb;
begin
  if not public.operation_verify_member(p_member_id,p_pin) then
    raise exception '회원 인증에 실패했습니다.';
  end if;

  select jsonb_build_object(
    'members',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.name)
      from public.members x
      where x.active=true
    ),'[]'::jsonb),
    'meetings',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.meeting_date desc)
      from public.meetings x
    ),'[]'::jsonb),
    'attendance',coalesce((
      select jsonb_agg(to_jsonb(x))
      from public.attendance x
    ),'[]'::jsonb),
    'teams',coalesce((
      select jsonb_agg(to_jsonb(x))
      from public.teams x
    ),'[]'::jsonb),
    'team_members',coalesce((
      select jsonb_agg(to_jsonb(x))
      from public.team_members x
    ),'[]'::jsonb),
    'games',coalesce((
      select jsonb_agg(to_jsonb(x))
      from public.games x
    ),'[]'::jsonb),
    'match_series',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from public.match_series x
    ),'[]'::jsonb),
    'series_sets',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.set_no)
      from public.series_sets x
    ),'[]'::jsonb),
    'three_team_series',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from public.three_team_series x
    ),'[]'::jsonb),
    'three_team_games',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.game_no)
      from public.three_team_games x
    ),'[]'::jsonb),
    'settings',coalesce((
      select to_jsonb(x)
      from public.club_settings x
      where x.id=1
    ),jsonb_build_object('id',1,'monthly_fee',20000))
  )
  into v_result;

  return v_result;
end $$;

grant execute on function public.operation_get_data(uuid,text) to anon,authenticated;

-- 내부 관리자 함수를 안전하게 호출하는 operation wrapper들
create or replace function public.operation_replace_attendance(
  p_operator_member_id uuid,
  p_operator_pin text,
  p_meeting_id uuid,
  p_member_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.operation_verify_member(p_operator_member_id,p_operator_pin) then
    raise exception '회원 인증에 실패했습니다.';
  end if;
  perform set_config('app.operation_authorized','on',true);
  return public.admin_replace_attendance(p_meeting_id,p_member_ids);
end $$;

create or replace function public.operation_generate_balanced_teams(
  p_operator_member_id uuid,
  p_operator_pin text,
  p_meeting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.operation_verify_member(p_operator_member_id,p_operator_pin) then
    raise exception '회원 인증에 실패했습니다.';
  end if;
  perform set_config('app.operation_authorized','on',true);
  return public.admin_generate_balanced_teams_v51(p_meeting_id);
end $$;

create or replace function public.operation_generate_random_teams(
  p_operator_member_id uuid,
  p_operator_pin text,
  p_meeting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.operation_verify_member(p_operator_member_id,p_operator_pin) then
    raise exception '회원 인증에 실패했습니다.';
  end if;
  perform set_config('app.operation_authorized','on',true);
  return public.admin_generate_random_teams_v51(p_meeting_id);
end $$;

create or replace function public.operation_assign_member_team(
  p_operator_member_id uuid,
  p_operator_pin text,
  p_meeting_id uuid,
  p_member_id uuid,
  p_team_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.operation_verify_member(p_operator_member_id,p_operator_pin) then
    raise exception '회원 인증에 실패했습니다.';
  end if;
  perform set_config('app.operation_authorized','on',true);
  return public.admin_assign_member_team_v51(p_meeting_id,p_member_id,p_team_id);
end $$;

create or replace function public.operation_start_match_series(
  p_operator_member_id uuid,
  p_operator_pin text,
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
begin
  if not public.operation_verify_member(p_operator_member_id,p_operator_pin) then
    raise exception '회원 인증에 실패했습니다.';
  end if;
  perform set_config('app.operation_authorized','on',true);
  return public.admin_start_match_series_v57(
    p_meeting_id,p_team_a_id,p_team_b_id,p_best_of,p_referee_member_id
  );
end $$;

create or replace function public.operation_record_series_set(
  p_operator_member_id uuid,
  p_operator_pin text,
  p_series_id uuid,
  p_score_a int,
  p_score_b int
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.operation_verify_member(p_operator_member_id,p_operator_pin) then
    raise exception '회원 인증에 실패했습니다.';
  end if;
  perform set_config('app.operation_authorized','on',true);
  return public.admin_record_series_set(p_series_id,p_score_a,p_score_b);
end $$;

create or replace function public.operation_cancel_match_series(
  p_operator_member_id uuid,
  p_operator_pin text,
  p_series_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.operation_verify_member(p_operator_member_id,p_operator_pin) then
    raise exception '회원 인증에 실패했습니다.';
  end if;
  perform set_config('app.operation_authorized','on',true);
  return public.admin_cancel_match_series(p_series_id);
end $$;

create or replace function public.operation_start_three_team_series(
  p_operator_member_id uuid,
  p_operator_pin text,
  p_meeting_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.operation_verify_member(p_operator_member_id,p_operator_pin) then
    raise exception '회원 인증에 실패했습니다.';
  end if;
  perform set_config('app.operation_authorized','on',true);
  return public.admin_start_three_team_series(p_meeting_id);
end $$;

create or replace function public.operation_record_three_team_game(
  p_operator_member_id uuid,
  p_operator_pin text,
  p_series_id uuid,
  p_score_a int,
  p_score_b int
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.operation_verify_member(p_operator_member_id,p_operator_pin) then
    raise exception '회원 인증에 실패했습니다.';
  end if;
  perform set_config('app.operation_authorized','on',true);
  return public.admin_record_three_team_game(p_series_id,p_score_a,p_score_b);
end $$;

create or replace function public.operation_cancel_three_team_series(
  p_operator_member_id uuid,
  p_operator_pin text,
  p_series_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.operation_verify_member(p_operator_member_id,p_operator_pin) then
    raise exception '회원 인증에 실패했습니다.';
  end if;
  perform set_config('app.operation_authorized','on',true);
  return public.admin_cancel_three_team_series(p_series_id);
end $$;

grant execute on function public.operation_replace_attendance(uuid,text,uuid,uuid[]) to anon,authenticated;
grant execute on function public.operation_generate_balanced_teams(uuid,text,uuid) to anon,authenticated;
grant execute on function public.operation_generate_random_teams(uuid,text,uuid) to anon,authenticated;
grant execute on function public.operation_assign_member_team(uuid,text,uuid,uuid,uuid) to anon,authenticated;
grant execute on function public.operation_start_match_series(uuid,text,uuid,uuid,uuid,int,uuid) to anon,authenticated;
grant execute on function public.operation_record_series_set(uuid,text,uuid,int,int) to anon,authenticated;
grant execute on function public.operation_cancel_match_series(uuid,text,uuid) to anon,authenticated;
grant execute on function public.operation_start_three_team_series(uuid,text,uuid) to anon,authenticated;
grant execute on function public.operation_record_three_team_game(uuid,text,uuid,int,int) to anon,authenticated;
grant execute on function public.operation_cancel_three_team_series(uuid,text,uuid) to anon,authenticated;

notify pgrst, 'reload schema';
