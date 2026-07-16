-- ALLIN V5.6.5 참석/불참 저장 오류 수정
-- 원인: pgcrypto가 extensions 스키마에 있는데 set_my_attendance가 crypt()를
--       public 검색 경로에서 호출하여 function crypt(text,text) does not exist 발생

create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_my_attendance(
  p_meeting_id uuid,
  p_member_id uuid,
  p_pin text,
  p_attending boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_valid boolean;
begin
  if p_meeting_id is null or p_member_id is null then
    return jsonb_build_object(
      'ok',false,
      'message','모임 또는 회원 정보가 없습니다.'
    );
  end if;

  if coalesce(p_pin,'') !~ '^[0-9]{4}$' then
    return jsonb_build_object(
      'ok',false,
      'message','PIN은 4자리 숫자입니다.'
    );
  end if;

  select exists(
    select 1
    from public.members x
    join public.meetings m on m.id=p_meeting_id
    where x.id=p_member_id
      and x.active=true
      and m.status='open'
      and m.meeting_date>=current_date
      and x.pin_hash is not null
      and x.pin_hash=extensions.crypt(p_pin,x.pin_hash)
  )
  into v_valid;

  if not v_valid then
    return jsonb_build_object(
      'ok',false,
      'message','PIN이 올바르지 않거나 현재 응답 가능한 모임이 아닙니다.'
    );
  end if;

  insert into public.attendance(
    meeting_id,
    member_id,
    attending,
    updated_at
  )
  values(
    p_meeting_id,
    p_member_id,
    p_attending,
    now()
  )
  on conflict(meeting_id,member_id)
  do update set
    attending=excluded.attending,
    updated_at=excluded.updated_at;

  return jsonb_build_object(
    'ok',true,
    'attending',p_attending
  );
end;
$$;

grant execute on function public.set_my_attendance(uuid,uuid,text,boolean)
to anon,authenticated;

notify pgrst, 'reload schema';

-- 정상 설치 확인
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname='set_my_attendance';
