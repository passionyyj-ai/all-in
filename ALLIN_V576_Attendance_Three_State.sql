-- ALLIN V5.7.6
-- 총무 직접 수정: 참석 / 불참 / 미응답 3상태 저장

create or replace function public.admin_replace_attendance_v576(
  p_meeting_id uuid,
  p_attending_member_ids uuid[],
  p_absent_member_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_overlap_count int;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  if p_meeting_id is null then
    raise exception '모임 정보가 없습니다.';
  end if;

  select count(*) into v_overlap_count
  from unnest(coalesce(p_attending_member_ids,'{}'::uuid[])) a(id)
  join unnest(coalesce(p_absent_member_ids,'{}'::uuid[])) b(id)
    on a.id=b.id;

  if v_overlap_count>0 then
    raise exception '한 회원을 참석과 불참으로 동시에 지정할 수 없습니다.';
  end if;

  -- 선택하지 않은 회원은 미응답 상태가 되도록 해당 모임 응답을 먼저 초기화
  delete from public.attendance
  where meeting_id=p_meeting_id;

  -- 참석 저장
  insert into public.attendance(
    meeting_id,
    member_id,
    attending,
    updated_at
  )
  select
    p_meeting_id,
    m.id,
    true,
    now()
  from public.members m
  where m.active=true
    and m.id=any(coalesce(p_attending_member_ids,'{}'::uuid[]));

  -- 불참 저장
  insert into public.attendance(
    meeting_id,
    member_id,
    attending,
    updated_at
  )
  select
    p_meeting_id,
    m.id,
    false,
    now()
  from public.members m
  where m.active=true
    and m.id=any(coalesce(p_absent_member_ids,'{}'::uuid[]));

  return true;
end $$;

grant execute on function public.admin_replace_attendance_v576(uuid,uuid[],uuid[])
to authenticated;

create or replace function public.operation_replace_attendance_v576(
  p_operator_member_id uuid,
  p_operator_pin text,
  p_meeting_id uuid,
  p_attending_member_ids uuid[],
  p_absent_member_ids uuid[]
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

  return public.admin_replace_attendance_v576(
    p_meeting_id,
    p_attending_member_ids,
    p_absent_member_ids
  );
end $$;

grant execute on function public.operation_replace_attendance_v576(
  uuid,text,uuid,uuid[],uuid[]
) to anon,authenticated;

notify pgrst, 'reload schema';
