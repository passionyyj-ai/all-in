-- ALLIN V5.3 회원 포털 개선
-- 회원 이름 + 개인 PIN 로그인 / 참석·불참·미응답 구분

create or replace function public.member_login_v53(p_name text, p_pin text)
returns jsonb
language plpgsql security definer set search_path=public, extensions
as $$
declare x public.members;
begin
  if coalesce(trim(p_name),'')='' or p_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok',false,'message','회원 이름과 개인 PIN 4자리를 확인하세요.');
  end if;
  select * into x from public.members
   where active and name=trim(p_name) and pin_hash=extensions.crypt(p_pin,pin_hash)
   order by created_at asc limit 1;
  if x.id is null then
    return jsonb_build_object('ok',false,'message','등록된 회원 이름 또는 PIN이 올바르지 않습니다.');
  end if;
  return jsonb_build_object('ok',true,'member',jsonb_build_object('id',x.id,'name',x.name,'position',x.position));
end $$;

create or replace function public.get_member_portal_v53()
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare m public.meetings; result jsonb;
begin
  select * into m from public.meetings
  where status='open' and meeting_date>=current_date
  order by meeting_date asc limit 1;
  if m.id is null then
    return jsonb_build_object('meeting',null,'members','[]'::jsonb,'attending_count',0,'absent_count',0,'pending_count',0);
  end if;
  select jsonb_build_object(
    'meeting',jsonb_build_object('id',m.id,'date',m.meeting_date),
    'members',coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'position',x.position,'attending',a.attending) order by x.name),'[]'::jsonb),
    'attending_count',(select count(*) from public.attendance where meeting_id=m.id and attending=true),
    'absent_count',(select count(*) from public.attendance where meeting_id=m.id and attending=false),
    'pending_count',(select count(*) from public.members x2 where x2.active and not exists(select 1 from public.attendance a2 where a2.meeting_id=m.id and a2.member_id=x2.id))
  ) into result
  from public.members x
  left join public.attendance a on a.meeting_id=m.id and a.member_id=x.id
  where x.active;
  return result;
end $$;

grant execute on function public.member_login_v53(text,text) to anon, authenticated;
grant execute on function public.get_member_portal_v53() to anon, authenticated;
notify pgrst, 'reload schema';
