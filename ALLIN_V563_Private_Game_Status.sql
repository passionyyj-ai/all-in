-- ALLIN V5.6.3
-- 로그인 회원 본인의 게임비와 실제 참가 경기수만 조회

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
    coalesce(sum(d.amount) filter(where d.status='unpaid'),0)
  into v_total_due,v_paid_due,v_unpaid_due
  from public.game_dues d
  where d.member_id=v_member.id
    and d.due_date>=v_start
    and d.due_date<v_end;

  with participated_events as (
    -- 일반 단판: 실제 출전한 완료 경기
    select 'G:'||g.id::text as event_key
    from public.games g
    join public.meetings mt on mt.id=g.meeting_id
    where mt.meeting_date>=v_start
      and mt.meeting_date<v_end
      and g.score_a is not null
      and g.score_b is not null
      and exists(
        select 1
        from public.team_members tm
        where tm.member_id=v_member.id
          and tm.team_id in (g.team_a,g.team_b)
      )

    union

    -- 2팀 다전제: 참여한 완료 시리즈를 1경기로 계산
    select 'S:'||s.id::text
    from public.match_series s
    join public.meetings mt on mt.id=s.meeting_id
    where mt.meeting_date>=v_start
      and mt.meeting_date<v_end
      and s.status='completed'
      and (
        v_member.id=any(coalesce(s.team_a_members,'{}'::uuid[]))
        or v_member.id=any(coalesce(s.team_b_members,'{}'::uuid[]))
      )

    union

    -- 3팀 시리즈: 본인이 실제 출전한 완료 단판별 1경기
    select 'T:'||tg.id::text
    from public.three_team_games tg
    join public.three_team_series ts on ts.id=tg.series_id
    join public.meetings mt on mt.id=ts.meeting_id
    where mt.meeting_date>=v_start
      and mt.meeting_date<v_end
      and tg.score_a is not null
      and tg.score_b is not null
      and (
        v_member.id=any(public.three_team_members(ts,tg.team_a_id))
        or v_member.id=any(public.three_team_members(ts,tg.team_b_id))
      )
  )
  select count(*) into v_game_count
  from participated_events;

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
