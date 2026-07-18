-- ALLIN V5.7.4
-- 4~8명: 심판 없음 / 9~11명: 심판 필수 / 12명 이상: 3팀
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
  v_id uuid; v_no int; v_a_name text; v_b_name text;
  v_a_members uuid[]; v_b_members uuid[]; v_referee_name text; v_attendee_count int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_best_of not in (3,5) then raise exception '경기 방식은 3판 또는 5판이어야 합니다.'; end if;
  if p_team_a_id=p_team_b_id then raise exception '서로 다른 팀을 선택하세요.'; end if;
  if exists(select 1 from public.match_series where meeting_id=p_meeting_id and status='active')
     or exists(select 1 from public.three_team_series where meeting_id=p_meeting_id and status='active') then
    raise exception '이미 진행 중인 시리즈가 있습니다.';
  end if;
  select count(*) into v_attendee_count from public.attendance where meeting_id=p_meeting_id and attending=true;
  if v_attendee_count between 9 and 11 and p_referee_member_id is null then
    raise exception '참석자가 9~11명일 때는 심판을 지정하세요.';
  end if;
  if (v_attendee_count<=8 or v_attendee_count>=12) and p_referee_member_id is not null then
    raise exception '현재 참석 인원에서는 심판을 지정하지 않습니다.';
  end if;
  if p_referee_member_id is not null then
    select m.name into v_referee_name
    from public.members m join public.attendance a on a.member_id=m.id and a.meeting_id=p_meeting_id and a.attending=true
    where m.id=p_referee_member_id;
    if v_referee_name is null then raise exception '심판은 현재 모임 참석자 중에서 선택해야 합니다.'; end if;
  end if;
  select team_name into v_a_name from public.teams where id=p_team_a_id and meeting_id=p_meeting_id;
  select team_name into v_b_name from public.teams where id=p_team_b_id and meeting_id=p_meeting_id;
  if v_a_name is null or v_b_name is null then raise exception '선택한 팀을 찾을 수 없습니다.'; end if;
  select coalesce(array_agg(member_id order by member_id),'{}'::uuid[]) into v_a_members from public.team_members where team_id=p_team_a_id;
  select coalesce(array_agg(member_id order by member_id),'{}'::uuid[]) into v_b_members from public.team_members where team_id=p_team_b_id;
  if cardinality(v_a_members)=0 or cardinality(v_b_members)=0 then raise exception '팀원이 없는 팀은 시리즈를 시작할 수 없습니다.'; end if;
  select coalesce(max(series_no),0)+1 into v_no from public.match_series where meeting_id=p_meeting_id;
  insert into public.match_series(meeting_id,series_no,best_of,team_a_source_id,team_b_source_id,team_a_name,team_b_name,team_a_members,team_b_members,referee_member_id,referee_name)
  values(p_meeting_id,v_no,p_best_of,p_team_a_id,p_team_b_id,v_a_name,v_b_name,v_a_members,v_b_members,p_referee_member_id,v_referee_name)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.admin_start_match_series_v57(uuid,uuid,uuid,int,uuid) to authenticated;
notify pgrst, 'reload schema';
