-- ALLIN V5.5.2 회원 개인 회비 조회
-- 로그인한 회원의 PIN을 검증하고 본인 회비 정보만 반환합니다.

create or replace function public.get_my_member_dashboard(
  p_month date,
  p_member_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_start date:=date_trunc('month',p_month)::date;
  v_base jsonb;
  v_member public.members;
  v_paid boolean:=false;
  v_paid_date date;
  v_fee jsonb;
begin
  if p_member_id is null or coalesce(p_pin,'') !~ '^[0-9]{4}$' then
    raise exception '회원 인증 정보가 올바르지 않습니다.';
  end if;

  select * into v_member
  from public.members
  where id=p_member_id
    and active=true
    and pin_hash=extensions.crypt(p_pin,pin_hash);

  if v_member.id is null then
    raise exception '회원 인증에 실패했습니다.';
  end if;

  select coalesce(f.paid,false),f.paid_date
  into v_paid,v_paid_date
  from public.fees f
  where f.member_id=v_member.id
    and f.fee_month=v_start;

  if not found then
    v_paid:=false;
    v_paid_date:=null;
  end if;

  v_base:=public.get_member_dashboard(v_start);
  v_fee:=jsonb_build_object(
    'total',1,
    'paid',case when v_paid then 1 else 0 end,
    'unpaid',case when v_paid then 0 else 1 end,
    'rate',case when v_paid then 100 else 0 end,
    'members',jsonb_build_array(jsonb_build_object(
      'id',v_member.id,
      'name',v_member.name,
      'paid',v_paid,
      'paid_date',v_paid_date
    ))
  );

  return jsonb_set(v_base,'{fee}',v_fee,true);
end $$;

grant execute on function public.get_my_member_dashboard(date,uuid,text)
to anon,authenticated;

notify pgrst, 'reload schema';
