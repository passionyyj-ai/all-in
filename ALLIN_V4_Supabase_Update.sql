-- ALLIN V4 추가 적용 SQL
-- 기존 supabase_setup.sql 실행 완료 DB에 이 파일만 1회 실행해도 됩니다.

create extension if not exists pgcrypto with schema extensions;

alter table public.members add column if not exists birth_year int;
update public.members
set birth_year = extract(year from current_date)::int - age
where birth_year is null and age is not null;

create or replace function public.admin_create_member_v40(
  p_name text,p_birth_year int,p_phone text,p_position text,p_pin text
)
returns uuid language plpgsql security definer set search_path=public,extensions
as $$
declare new_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN must be 4 digits'; end if;
  if p_birth_year is not null and (p_birth_year < 1930 or p_birth_year > extract(year from current_date)::int) then raise exception 'invalid birth year'; end if;
  insert into public.members(name,birth_year,phone,position,pin_hash)
  values(p_name,p_birth_year,p_phone,p_position,extensions.crypt(p_pin,extensions.gen_salt('bf')))
  returning id into new_id;
  return new_id;
end $$;
grant execute on function public.admin_create_member_v40(text,int,text,text,text) to authenticated;

create or replace function public.admin_generate_random_teams(p_meeting_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_count int;v_team_count int;v_team_no int;v_team_id uuid;r record;v_idx int:=0;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if exists(select 1 from public.games where meeting_id=p_meeting_id) then raise exception '경기가 등록된 모임은 팀을 다시 생성할 수 없습니다.'; end if;
  delete from public.teams where meeting_id=p_meeting_id;
  select count(*) into v_count from public.attendance where meeting_id=p_meeting_id and attending=true;
  v_team_count:=floor(v_count/4.0)::int;
  if v_team_count<1 then return jsonb_build_object('team_count',0,'mode','random'); end if;
  for v_team_no in 1..v_team_count loop
    insert into public.teams(meeting_id,team_no,team_name) values(p_meeting_id,v_team_no,v_team_no||'팀');
  end loop;
  for r in select member_id from public.attendance where meeting_id=p_meeting_id and attending=true order by random() limit (v_team_count*4)
  loop
    v_idx:=v_idx+1;
    select id into v_team_id from public.teams where meeting_id=p_meeting_id and team_no=((v_idx-1)/4)+1;
    insert into public.team_members(team_id,member_id) values(v_team_id,r.member_id);
  end loop;
  return jsonb_build_object('team_count',v_team_count,'mode','random');
end $$;
grant execute on function public.admin_generate_random_teams(uuid) to authenticated;

create or replace function public.get_member_dashboard(p_month date)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_start date:=date_trunc('month',p_month)::date;v_end date:=(date_trunc('month',p_month)+interval '1 month')::date;
v_total int;v_paid int;v_income numeric;v_expense numeric;v_balance numeric;v_total_due numeric;v_paid_due numeric;v_unpaid_due numeric;v_unpaid_count int;v_result jsonb;
begin
  select count(*) into v_total from public.members where active=true;
  select count(*) into v_paid from public.fees f join public.members m on m.id=f.member_id and m.active=true where f.fee_month=v_start and f.paid=true;
  select coalesce(sum(amount) filter(where tx_type='income'),0),coalesce(sum(amount) filter(where tx_type='expense'),0) into v_income,v_expense from public.transactions where tx_date>=v_start and tx_date<v_end;
  select coalesce(sum(case when tx_type='income' then amount else -amount end),0) into v_balance from public.transactions;
  select coalesce(sum(amount),0),coalesce(sum(amount) filter(where status='paid'),0),coalesce(sum(amount) filter(where status='unpaid'),0),count(*) filter(where status='unpaid') into v_total_due,v_paid_due,v_unpaid_due,v_unpaid_count from public.game_dues where due_date>=v_start and due_date<v_end;
  select jsonb_build_object(
    'fee',jsonb_build_object('total',v_total,'paid',v_paid,'unpaid',greatest(v_total-v_paid,0),'rate',case when v_total=0 then 0 else round(v_paid::numeric/v_total*100) end,
      'members',coalesce((select jsonb_agg(jsonb_build_object('name',m.name,'paid',coalesce(f.paid,false),'paid_date',f.paid_date) order by m.name) from public.members m left join public.fees f on f.member_id=m.id and f.fee_month=v_start where m.active=true),'[]'::jsonb)),
    'cash',jsonb_build_object('income',v_income,'expense',v_expense,'balance',v_balance,
      'recent',coalesce((select jsonb_agg(x.obj order by x.tx_date desc,x.created_at desc) from (select t.tx_date,t.created_at,jsonb_build_object('date',t.tx_date,'type',t.tx_type,'category',t.category,'amount',t.amount) obj from public.transactions t where t.tx_date>=v_start and t.tx_date<v_end order by t.tx_date desc,t.created_at desc limit 20)x),'[]'::jsonb)),
    'game_dues',jsonb_build_object('total_amount',v_total_due,'paid_amount',v_paid_due,'unpaid_amount',v_unpaid_due,'unpaid_count',v_unpaid_count,
      'items',coalesce((select jsonb_agg(jsonb_build_object('due_date',d.due_date,'name',m.name,'amount',d.amount,'status',d.status) order by d.due_date desc,m.name) from public.game_dues d join public.members m on m.id=d.member_id where d.due_date>=v_start and d.due_date<v_end),'[]'::jsonb))
  ) into v_result;
  return v_result;
end $$;
grant execute on function public.get_member_dashboard(date) to anon,authenticated;
