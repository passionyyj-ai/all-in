-- ALLIN V4.1 추가 적용 SQL
-- 일반 패배 2,000원 / 8점 차 이상 콜드게임 4,000원
-- 동일 회원의 월 미납 게임비 합산 입금 처리

create or replace function public.admin_set_game_score(
  p_game_id uuid,
  p_score_a int,
  p_score_b int
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  g public.games;
  loser uuid;
  winner uuid;
  mem record;
  txdate date;
  fee_amount numeric(12,0);
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_score_a < 0 or p_score_b < 0 or p_score_a = p_score_b then raise exception 'invalid score'; end if;

  select * into g from public.games where id=p_game_id;
  if g.id is null then raise exception 'game not found'; end if;

  if exists(select 1 from public.game_dues where game_id=p_game_id and status='paid') then
    raise exception '이미 입금 처리된 게임비가 있어 경기 결과를 수정할 수 없습니다.';
  end if;

  delete from public.game_dues where game_id=p_game_id;

  winner:=case when p_score_a>p_score_b then g.team_a else g.team_b end;
  loser:=case when winner=g.team_a then g.team_b else g.team_a end;
  fee_amount:=case when abs(p_score_a-p_score_b)>=8 then 4000 else 2000 end;

  select meeting_date into txdate from public.meetings where id=g.meeting_id;

  update public.games
  set score_a=p_score_a,score_b=p_score_b,winner_team_id=winner
  where id=p_game_id;

  for mem in
    select m.*
    from public.members m
    join public.team_members tm on tm.member_id=m.id
    where tm.team_id=loser
  loop
    insert into public.game_dues(game_id,meeting_id,member_id,due_date,amount,status)
    values(p_game_id,g.meeting_id,mem.id,txdate,fee_amount,'unpaid')
    on conflict(game_id,member_id) do update
    set amount=excluded.amount,status='unpaid',paid_date=null,transaction_id=null;
  end loop;

  return true;
end $$;

grant execute on function public.admin_set_game_score(uuid,int,int) to authenticated;

create or replace function public.admin_mark_member_game_dues_paid(
  p_member_id uuid,
  p_month date,
  p_paid_date date
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_start date:=date_trunc('month',p_month)::date;
  v_end date:=(date_trunc('month',p_month)+interval '1 month')::date;
  v_amount numeric(12,0);
  v_name text;
  v_tx uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select name into v_name from public.members where id=p_member_id;

  select coalesce(sum(amount),0)
  into v_amount
  from public.game_dues
  where member_id=p_member_id
    and status='unpaid'
    and due_date>=v_start
    and due_date<v_end;

  if v_amount<=0 then raise exception '미납 게임비가 없습니다.'; end if;

  insert into public.transactions(tx_date,tx_type,category,target,amount,memo,source,ref_id)
  values(
    p_paid_date,'income','게임비',v_name,v_amount,
    to_char(v_start,'YYYY-MM')||' 게임비 합계 입금 확인',
    'game_payment',gen_random_uuid()
  )
  returning id into v_tx;

  update public.game_dues
  set status='paid',paid_date=p_paid_date,transaction_id=v_tx
  where member_id=p_member_id
    and status='unpaid'
    and due_date>=v_start
    and due_date<v_end;

  return true;
end $$;

grant execute on function public.admin_mark_member_game_dues_paid(uuid,date,date) to authenticated;

create or replace function public.get_member_dashboard(p_month date)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_start date:=date_trunc('month',p_month)::date;
  v_end date:=(date_trunc('month',p_month)+interval '1 month')::date;
  v_total int; v_paid int;
  v_income numeric; v_expense numeric; v_balance numeric;
  v_total_due numeric; v_paid_due numeric; v_unpaid_due numeric; v_unpaid_count int;
  v_result jsonb;
begin
  select count(*) into v_total from public.members where active=true;

  select count(*) into v_paid
  from public.fees f
  join public.members m on m.id=f.member_id and m.active=true
  where f.fee_month=v_start and f.paid=true;

  select
    coalesce(sum(amount) filter(where tx_type='income'),0),
    coalesce(sum(amount) filter(where tx_type='expense'),0)
  into v_income,v_expense
  from public.transactions
  where tx_date>=v_start and tx_date<v_end;

  select coalesce(sum(case when tx_type='income' then amount else -amount end),0)
  into v_balance
  from public.transactions;

  select
    coalesce(sum(amount),0),
    coalesce(sum(amount) filter(where status='paid'),0),
    coalesce(sum(amount) filter(where status='unpaid'),0),
    count(*) filter(where status='unpaid')
  into v_total_due,v_paid_due,v_unpaid_due,v_unpaid_count
  from public.game_dues
  where due_date>=v_start and due_date<v_end;

  select jsonb_build_object(
    'fee',jsonb_build_object(
      'total',v_total,'paid',v_paid,'unpaid',greatest(v_total-v_paid,0),
      'rate',case when v_total=0 then 0 else round(v_paid::numeric/v_total*100) end,
      'members',coalesce((
        select jsonb_agg(jsonb_build_object(
          'name',m.name,'paid',coalesce(f.paid,false),'paid_date',f.paid_date
        ) order by m.name)
        from public.members m
        left join public.fees f on f.member_id=m.id and f.fee_month=v_start
        where m.active=true
      ),'[]'::jsonb)
    ),
    'cash',jsonb_build_object(
      'income',v_income,'expense',v_expense,'balance',v_balance,
      'recent',coalesce((
        select jsonb_agg(x.obj order by x.tx_date desc,x.created_at desc)
        from (
          select t.tx_date,t.created_at,jsonb_build_object(
            'date',t.tx_date,'type',t.tx_type,'category',t.category,'amount',t.amount
          ) obj
          from public.transactions t
          where t.tx_date>=v_start and t.tx_date<v_end
          order by t.tx_date desc,t.created_at desc
          limit 20
        ) x
      ),'[]'::jsonb)
    ),
    'game_dues',jsonb_build_object(
      'total_amount',v_total_due,'paid_amount',v_paid_due,
      'unpaid_amount',v_unpaid_due,'unpaid_count',v_unpaid_count,
      'items',coalesce((
        select jsonb_agg(jsonb_build_object(
          'name',q.name,
          'total_amount',q.total_amount,
          'paid_amount',q.paid_amount,
          'unpaid_amount',q.unpaid_amount
        ) order by q.unpaid_amount desc,q.name)
        from (
          select
            m.name,
            sum(d.amount) total_amount,
            coalesce(sum(d.amount) filter(where d.status='paid'),0) paid_amount,
            coalesce(sum(d.amount) filter(where d.status='unpaid'),0) unpaid_amount
          from public.game_dues d
          join public.members m on m.id=d.member_id
          where d.due_date>=v_start and d.due_date<v_end
          group by m.id,m.name
        ) q
      ),'[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end $$;

grant execute on function public.get_member_dashboard(date) to anon,authenticated;
