-- =========================================================
-- ALLIN V5.9 - 심판 기능 제거
-- =========================================================
-- 적용 원칙
-- 1. 참석자는 팀 또는 대기로 관리
-- 2. 심판 선택 및 필수 조건 없음
-- 3. 대기자는 시리즈 팀 명단에 포함되지 않으므로 게임비/경기횟수 제외
-- 4. 기존 referee 컬럼은 과거 데이터 및 함수 호환을 위해 유지하되 새 시리즈에는 NULL 저장

create or replace function public.admin_start_match_series_v59(
  p_meeting_id uuid,
  p_team_a_id uuid,
  p_team_b_id uuid,
  p_best_of int
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
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  if p_best_of not in (3,5) then
    raise exception '경기 방식은 3판 또는 5판이어야 합니다.';
  end if;

  if p_team_a_id=p_team_b_id then
    raise exception '서로 다른 팀을 선택하세요.';
  end if;

  if exists(
      select 1 from public.match_series
      where meeting_id=p_meeting_id and status='active'
    )
    or exists(
      select 1 from public.three_team_series
      where meeting_id=p_meeting_id and status='active'
    ) then
    raise exception '이미 진행 중인 시리즈가 있습니다.';
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

  select coalesce(max(series_no),0)+1
  into v_no
  from public.match_series
  where meeting_id=p_meeting_id;

  insert into public.match_series(
    meeting_id,
    series_no,
    best_of,
    team_a_source_id,
    team_b_source_id,
    team_a_name,
    team_b_name,
    team_a_members,
    team_b_members,
    referee_member_id,
    referee_name
  )
  values(
    p_meeting_id,
    v_no,
    p_best_of,
    p_team_a_id,
    p_team_b_id,
    v_a_name,
    v_b_name,
    v_a_members,
    v_b_members,
    null,
    null
  )
  returning id into v_id;

  return v_id;
end $$;

grant execute on function public.admin_start_match_series_v59(uuid,uuid,uuid,int)
to authenticated;

create or replace function public.operation_start_match_series_v59(
  p_operator_member_id uuid,
  p_operator_pin text,
  p_meeting_id uuid,
  p_team_a_id uuid,
  p_team_b_id uuid,
  p_best_of int
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

  return public.admin_start_match_series_v59(
    p_meeting_id,
    p_team_a_id,
    p_team_b_id,
    p_best_of
  );
end $$;

grant execute on function public.operation_start_match_series_v59(
  uuid,text,uuid,uuid,uuid,int
) to anon,authenticated;

-- 진행 중이 아닌 과거 시리즈의 심판 표시는 정리하되 경기 기록은 보존
update public.match_series
set referee_member_id=null,
    referee_name=null
where status<>'active'
  and (referee_member_id is not null or referee_name is not null);

notify pgrst,'reload schema';
