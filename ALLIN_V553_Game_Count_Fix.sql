-- ALLIN V5.5.3 게임횟수 계산 수정
-- 회원용: 로그인한 본인의 실제 게임비 확정 경기/시리즈 수
-- 총무용: 프런트에서 game_id / series_id / three_team_series_id를 모두 집계

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
  v_end date:=(date_trunc('month',p_month)+interval '1 month')::date;
  v_base jsonb;
  v_member public.members;
  v_paid boolean:=false;
  v_paid_date date;
  v_fee jsonb;
  v_total_due numeric:=0;
  v_paid_due numeric:=0;
  v_unpaid_due numeric:=0;
  v_game_count int:=0;
  v_game_dues jsonb;
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

  select
    coalesce(sum(d.amount),0),
    coalesce(sum(d.amount) filter(where d.status='paid'),0),
    coalesce(sum(d.amount) filter(where d.status='unpaid'),0),
    count(distinct case
      when d.three_team_series_id is not null then 'T:'||d.three_team_series_id::text
      when d.series_id is not null then 'S:'||d.series_id::text
      when d.game_id is not null then 'G:'||d.game_id::text
      else 'D:'||d.id::text
    end)
  into v_total_due,v_paid_due,v_unpaid_due,v_game_count
  from public.game_dues d
  where d.member_id=v_member.id
    and d.due_date>=v_start
    and d.due_date<v_end;

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

  v_game_dues:=jsonb_build_object(
    'total_amount',v_total_due,
    'paid_amount',v_paid_due,
    'unpaid_amount',v_unpaid_due,
    'game_count',v_game_count,
    'items',jsonb_build_array(jsonb_build_object(
      'id',v_member.id,
      'name',v_member.name,
      'total_amount',v_total_due,
      'paid_amount',v_paid_due,
      'unpaid_amount',v_unpaid_due,
      'game_count',v_game_count
    ))
  );

  v_base:=jsonb_set(v_base,'{fee}',v_fee,true);
  v_base:=jsonb_set(v_base,'{game_dues}',v_game_dues,true);

  return v_base;
end $$;

grant execute on function public.get_my_member_dashboard(date,uuid,text)
to anon,authenticated;

notify pgrst, 'reload schema';
