-- ALLIN V5.3.2 회원 로그인 복구
-- pgcrypto 함수의 extensions 스키마를 명시하고 PostgREST 캐시를 갱신합니다.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.member_login_v53(
  p_name text,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  x public.members;
begin
  if coalesce(trim(p_name), '') = ''
     or coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    return jsonb_build_object(
      'ok', false,
      'message', '회원 이름과 개인 PIN 4자리를 확인하세요.'
    );
  end if;

  select *
    into x
  from public.members
  where active = true
    and trim(name) = trim(p_name)
    and pin_hash = extensions.crypt(p_pin, pin_hash)
  order by created_at asc
  limit 1;

  if x.id is null then
    return jsonb_build_object(
      'ok', false,
      'message', '등록된 회원 이름 또는 PIN이 올바르지 않습니다.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'member', jsonb_build_object(
      'id', x.id,
      'name', x.name,
      'position', x.position
    )
  );
end;
$function$;

grant execute on function public.member_login_v53(text, text)
to anon, authenticated;

notify pgrst, 'reload schema';

-- 함수 설치 확인
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'member_login_v53';
