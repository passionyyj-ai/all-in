-- ALLIN V5.8.1: 대기 인원 및 심판
create or replace function public.admin_assign_member_team_v51(
 p_meeting_id uuid,p_member_id uuid,p_team_id uuid
) returns void
language plpgsql security definer set search_path=public
as $$
begin
 if not public.is_admin() then raise exception 'admin only'; end if;
 if exists(select 1 from public.match_series where meeting_id=p_meeting_id and status='active')
 or exists(select 1 from public.three_team_series where meeting_id=p_meeting_id and status='active')
 then raise exception '진행 중인 시리즈에서는 팀 또는 대기 상태를 변경할 수 없습니다.'; end if;
 if not exists(select 1 from public.attendance where meeting_id=p_meeting_id and member_id=p_member_id and attending=true)
 then raise exception '해당 회원은 현재 모임 참석자가 아닙니다.'; end if;
 if p_team_id is not null and not exists(select 1 from public.teams where id=p_team_id and meeting_id=p_meeting_id)
 then raise exception '선택한 팀이 현재 모임의 팀이 아닙니다.'; end if;

 delete from public.team_members tm using public.teams t
 where tm.team_id=t.id and t.meeting_id=p_meeting_id and tm.member_id=p_member_id;

 if p_team_id is not null then
   insert into public.team_members(team_id,member_id) values(p_team_id,p_member_id);
 end if;
end $$;
grant execute on function public.admin_assign_member_team_v51(uuid,uuid,uuid) to authenticated;

create or replace function public.admin_start_match_series_v57(
 p_meeting_id uuid,p_team_a_id uuid,p_team_b_id uuid,p_best_of int,p_referee_member_id uuid default null
) returns uuid
language plpgsql security definer set search_path=public
as $$
declare
 v_id uuid; v_no int; v_a_name text; v_b_name text;
 v_a_members uuid[]; v_b_members uuid[]; v_referee_name text;
 v_attendee_count int; v_waiting_count int;
begin
 if not public.is_admin() then raise exception 'admin only'; end if;
 if p_best_of not in (3,5) then raise exception '경기 방식은 3판 또는 5판이어야 합니다.'; end if;
 if p_team_a_id=p_team_b_id then raise exception '서로 다른 팀을 선택하세요.'; end if;
 if exists(select 1 from public.match_series where meeting_id=p_meeting_id and status='active')
 or exists(select 1 from public.three_team_series where meeting_id=p_meeting_id and status='active')
 then raise exception '이미 진행 중인 시리즈가 있습니다.'; end if;

 select count(*) into v_attendee_count from public.attendance
 where meeting_id=p_meeting_id and attending=true;

 select count(*) into v_waiting_count
 from public.attendance a
 where a.meeting_id=p_meeting_id and a.attending=true
 and not exists(
   select 1 from public.team_members tm join public.teams t on t.id=tm.team_id
   where t.meeting_id=p_meeting_id and tm.member_id=a.member_id
 );

 if v_attendee_count between 9 and 11 then
   if v_waiting_count=0 then raise exception '최소 1명을 대기 상태로 지정하세요.'; end if;
   if p_referee_member_id is null then raise exception '대기 인원 중에서 심판을 지정하세요.'; end if;
 elsif p_referee_member_id is not null then
   raise exception '심판 지정은 참석 인원이 9~11명인 경우에만 사용합니다.';
 end if;

 if p_referee_member_id is not null then
   select m.name into v_referee_name
   from public.members m join public.attendance a
   on a.member_id=m.id and a.meeting_id=p_meeting_id and a.attending=true
   where m.id=p_referee_member_id
   and not exists(
     select 1 from public.team_members tm join public.teams t on t.id=tm.team_id
     where t.meeting_id=p_meeting_id and tm.member_id=m.id
   );
   if v_referee_name is null then
     raise exception '심판은 팀에 배정되지 않은 대기 인원 중에서 선택해야 합니다.';
   end if;
 end if;

 select team_name into v_a_name from public.teams where id=p_team_a_id and meeting_id=p_meeting_id;
 select team_name into v_b_name from public.teams where id=p_team_b_id and meeting_id=p_meeting_id;
 if v_a_name is null or v_b_name is null then raise exception '선택한 팀을 찾을 수 없습니다.'; end if;

 select coalesce(array_agg(member_id order by member_id),'{}'::uuid[]) into v_a_members
 from public.team_members where team_id=p_team_a_id;
 select coalesce(array_agg(member_id order by member_id),'{}'::uuid[]) into v_b_members
 from public.team_members where team_id=p_team_b_id;
 if cardinality(v_a_members)=0 or cardinality(v_b_members)=0 then
   raise exception '팀원이 없는 팀은 시리즈를 시작할 수 없습니다.';
 end if;

 select coalesce(max(series_no),0)+1 into v_no from public.match_series where meeting_id=p_meeting_id;
 insert into public.match_series(
   meeting_id,series_no,best_of,team_a_source_id,team_b_source_id,
   team_a_name,team_b_name,team_a_members,team_b_members,referee_member_id,referee_name
 ) values(
   p_meeting_id,v_no,p_best_of,p_team_a_id,p_team_b_id,
   v_a_name,v_b_name,v_a_members,v_b_members,p_referee_member_id,v_referee_name
 ) returning id into v_id;
 return v_id;
end $$;
grant execute on function public.admin_start_match_series_v57(uuid,uuid,uuid,int,uuid) to authenticated;
notify pgrst,'reload schema';
