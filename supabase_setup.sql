-- 올인 족구단 v2 / Supabase 초기 설정
-- Supabase SQL Editor에서 전체 실행
create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  age int,
  phone text,
  position text not null check (position in ('공격','토스','좌수비','우수비')),
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  meeting_date date not null unique,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.attendance (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  attending boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(meeting_id,member_id)
);

create table if not exists public.club_settings (
  id int primary key default 1 check (id=1),
  monthly_fee numeric(12,0) not null default 20000
);
insert into public.club_settings(id,monthly_fee) values(1,20000) on conflict(id) do nothing;

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  tx_date date not null,
  tx_type text not null check(tx_type in ('income','expense')),
  category text not null,
  target text,
  amount numeric(12,0) not null check(amount>=0),
  memo text,
  source text not null default 'manual' check(source in ('manual','fee','game_payment')),
  ref_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.fees (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  fee_month date not null,
  paid boolean not null default false,
  paid_date date,
  transaction_id uuid references public.transactions(id) on delete set null,
  unique(member_id,fee_month)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  team_no int not null,
  team_name text not null,
  unique(meeting_id,team_no)
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  primary key(team_id,member_id)
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  team_a uuid not null references public.teams(id) on delete cascade,
  team_b uuid not null references public.teams(id) on delete cascade,
  winner_team_id uuid references public.teams(id) on delete set null,
  score_a int,
  score_b int,
  created_at timestamptz not null default now(),
  check(team_a<>team_b)
);

create table if not exists public.game_dues (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  due_date date not null,
  amount numeric(12,0) not null default 2000 check(amount>=0),
  status text not null default 'unpaid' check(status in ('unpaid','paid')),
  paid_date date,
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(game_id,member_id)
);

alter table public.games add column if not exists score_a int;
alter table public.games add column if not exists score_b int;


create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.admin_users where user_id=auth.uid()) $$;

alter table public.admin_users enable row level security;
alter table public.members enable row level security;
alter table public.meetings enable row level security;
alter table public.attendance enable row level security;
alter table public.club_settings enable row level security;
alter table public.transactions enable row level security;
alter table public.fees enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.games enable row level security;
alter table public.game_dues enable row level security;

-- 관리자만 직접 CRUD
do $$
declare t text;
begin
  foreach t in array array['admin_users','members','meetings','attendance','club_settings','transactions','fees','teams','team_members','games','game_dues']
  loop
    execute format('drop policy if exists admin_all on public.%I',t);
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',t);
  end loop;
end $$;

-- 회원 포털: 필요한 최소 정보만 반환
create or replace function public.get_member_portal()
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare m public.meetings; result jsonb;
begin
  select * into m from public.meetings
  where status='open' and meeting_date>=current_date
  order by meeting_date asc limit 1;
  if m.id is null then
    return jsonb_build_object('meeting',null,'members','[]'::jsonb,'attending_count',0);
  end if;
  select jsonb_build_object(
    'meeting',jsonb_build_object('id',m.id,'date',m.meeting_date),
    'members',coalesce(jsonb_agg(jsonb_build_object(
      'id',x.id,'name',x.name,'position',x.position,
      'attending',coalesce(a.attending,false)
    ) order by x.name),'[]'::jsonb),
    'attending_count',(select count(*) from public.attendance where meeting_id=m.id and attending)
  ) into result
  from public.members x
  left join public.attendance a on a.meeting_id=m.id and a.member_id=x.id
  where x.active;
  return result;
end $$;

create or replace function public.set_my_attendance(p_meeting_id uuid,p_member_id uuid,p_pin text,p_attending boolean)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare ok boolean;
begin
  if p_pin !~ '^[0-9]{4}$' then return jsonb_build_object('ok',false,'message','PIN은 4자리 숫자입니다.'); end if;
  select exists(
    select 1 from public.members x join public.meetings m on m.id=p_meeting_id
    where x.id=p_member_id and x.active and m.status='open' and m.meeting_date>=current_date
      and x.pin_hash=crypt(p_pin,x.pin_hash)
  ) into ok;
  if not ok then return jsonb_build_object('ok',false,'message','PIN이 올바르지 않습니다.'); end if;
  insert into public.attendance(meeting_id,member_id,attending,updated_at)
  values(p_meeting_id,p_member_id,p_attending,now())
  on conflict(meeting_id,member_id) do update set attending=excluded.attending,updated_at=now();
  return jsonb_build_object('ok',true);
end $$;

-- 관리자용 보안 함수
create or replace function public.admin_create_member(p_name text,p_age int,p_phone text,p_position text,p_pin text)
returns uuid language plpgsql security definer set search_path=public
as $$
declare new_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN must be 4 digits'; end if;
  insert into public.members(name,age,phone,position,pin_hash)
  values(p_name,p_age,p_phone,p_position,crypt(p_pin,gen_salt('bf'))) returning id into new_id;
  return new_id;
end $$;

create or replace function public.admin_set_member_pin(p_member_id uuid,p_pin text)
returns boolean language plpgsql security definer set search_path=public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN must be 4 digits'; end if;
  update public.members set pin_hash=crypt(p_pin,gen_salt('bf')) where id=p_member_id;
  return found;
end $$;

create or replace function public.admin_replace_attendance(p_meeting_id uuid,p_member_ids uuid[])
returns boolean language plpgsql security definer set search_path=public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  insert into public.attendance(meeting_id,member_id,attending,updated_at)
  select p_meeting_id,id,(id=any(p_member_ids)),now() from public.members where active
  on conflict(meeting_id,member_id) do update set attending=excluded.attending,updated_at=now();
  return true;
end $$;

create or replace function public.admin_set_fee(p_member_id uuid,p_month date,p_paid boolean)
returns boolean language plpgsql security definer set search_path=public
as $$
declare f public.fees; mem public.members; amt numeric; tx uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into mem from public.members where id=p_member_id;
  select monthly_fee into amt from public.club_settings where id=1;
  select * into f from public.fees where member_id=p_member_id and fee_month=date_trunc('month',p_month)::date;
  if p_paid then
    if f.paid then return true; end if;
    insert into public.transactions(tx_date,tx_type,category,target,amount,memo,source)
    values(current_date,'income','월 회비',mem.name,amt,to_char(p_month,'YYYY-MM')||' 회비','fee') returning id into tx;
    insert into public.fees(member_id,fee_month,paid,paid_date,transaction_id)
    values(p_member_id,date_trunc('month',p_month)::date,true,current_date,tx)
    on conflict(member_id,fee_month) do update set paid=true,paid_date=current_date,transaction_id=tx;
  else
    if f.transaction_id is not null then delete from public.transactions where id=f.transaction_id; end if;
    insert into public.fees(member_id,fee_month,paid,paid_date,transaction_id)
    values(p_member_id,date_trunc('month',p_month)::date,false,null,null)
    on conflict(member_id,fee_month) do update set paid=false,paid_date=null,transaction_id=null;
  end if;
  return true;
end $$;

create or replace function public.admin_generate_teams(p_meeting_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare n int; i int; t uuid; p text; mid uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  delete from public.teams where meeting_id=p_meeting_id;
  select min(c) into n from (
    select p.position,count(*) c from (values('공격'),('토스'),('좌수비'),('우수비')) p(position)
    left join public.members m on m.position=p.position and m.id in
      (select member_id from public.attendance where meeting_id=p_meeting_id and attending)
    group by p.position
  ) z;
  n:=coalesce(n,0);
  for i in 1..n loop
    insert into public.teams(meeting_id,team_no,team_name) values(p_meeting_id,i,i||'팀') returning id into t;
    foreach p in array array['공격','토스','좌수비','우수비'] loop
      select m.id into mid from public.members m
      where m.position=p and m.id in (select member_id from public.attendance where meeting_id=p_meeting_id and attending)
        and not exists(select 1 from public.team_members tm join public.teams tt on tt.id=tm.team_id where tt.meeting_id=p_meeting_id and tm.member_id=m.id)
      order by random() limit 1;
      insert into public.team_members(team_id,member_id) values(t,mid);
    end loop;
  end loop;
  return jsonb_build_object('team_count',n);
end $$;

create or replace function public.admin_set_game_score(p_game_id uuid,p_score_a int,p_score_b int)
returns boolean language plpgsql security definer set search_path=public
as $$
declare g public.games; loser uuid; winner uuid; mem record; txdate date;
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
  select meeting_date into txdate from public.meetings where id=g.meeting_id;
  update public.games set score_a=p_score_a,score_b=p_score_b,winner_team_id=winner where id=p_game_id;
  for mem in select m.* from public.members m join public.team_members tm on tm.member_id=m.id where tm.team_id=loser loop
    insert into public.game_dues(game_id,meeting_id,member_id,due_date,amount,status)
    values(p_game_id,g.meeting_id,mem.id,txdate,2000,'unpaid')
    on conflict(game_id,member_id) do nothing;
  end loop;
  return true;
end $$;

create or replace function public.admin_clear_game_result(p_game_id uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if exists(select 1 from public.game_dues where game_id=p_game_id and status='paid') then
    raise exception '입금 처리된 게임비가 있어 결과를 취소할 수 없습니다.';
  end if;
  delete from public.game_dues where game_id=p_game_id;
  update public.games set score_a=null,score_b=null,winner_team_id=null where id=p_game_id;
  return true;
end $$;

create or replace function public.admin_mark_game_due_paid(p_due_id uuid,p_paid_date date)
returns boolean language plpgsql security definer set search_path=public
as $$
declare d public.game_dues; mem public.members; tx uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into d from public.game_dues where id=p_due_id for update;
  if d.id is null then raise exception 'due not found'; end if;
  if d.status='paid' then return true; end if;
  select * into mem from public.members where id=d.member_id;
  insert into public.transactions(tx_date,tx_type,category,target,amount,memo,source,ref_id)
  values(p_paid_date,'income','게임비',mem.name,d.amount,'게임비 입금 확인','game_payment',d.id)
  returning id into tx;
  update public.game_dues set status='paid',paid_date=p_paid_date,transaction_id=tx where id=p_due_id;
  return true;
end $$;

create or replace function public.admin_cancel_game_due_paid(p_due_id uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
declare d public.game_dues;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into d from public.game_dues where id=p_due_id for update;
  if d.transaction_id is not null then delete from public.transactions where id=d.transaction_id; end if;
  update public.game_dues set status='unpaid',paid_date=null,transaction_id=null where id=p_due_id;
  return true;
end $$;

create or replace function public.admin_delete_game(p_game_id uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if exists(select 1 from public.game_dues where game_id=p_game_id and status='paid') then
    raise exception '입금 처리된 게임비가 있어 경기를 삭제할 수 없습니다.';
  end if;
  delete from public.game_dues where game_id=p_game_id;
  delete from public.games where id=p_game_id;
  return true;
end $$;

-- anon은 테이블 직접 접근 불가, 두 RPC만 실행
revoke all on all tables in schema public from anon;
grant execute on function public.get_member_portal() to anon, authenticated;
grant execute on function public.set_my_attendance(uuid,uuid,text,boolean) to anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_create_member(text,int,text,text,text) to authenticated;
grant execute on function public.admin_set_member_pin(uuid,text) to authenticated;
grant execute on function public.admin_replace_attendance(uuid,uuid[]) to authenticated;
grant execute on function public.admin_set_fee(uuid,date,boolean) to authenticated;
grant execute on function public.admin_generate_teams(uuid) to authenticated;
grant execute on function public.admin_set_game_score(uuid,int,int) to authenticated;
grant execute on function public.admin_clear_game_result(uuid) to authenticated;
grant execute on function public.admin_mark_game_due_paid(uuid,date) to authenticated;
grant execute on function public.admin_cancel_game_due_paid(uuid) to authenticated;
grant execute on function public.admin_delete_game(uuid) to authenticated;

-- Realtime용 publication 추가(이미 들어가 있으면 예외 방지)
do $$ begin
  alter publication supabase_realtime add table public.attendance;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.meetings;
exception when duplicate_object then null; end $$;

-- 중요: Supabase Dashboard > Authentication > Users에서 관리자 계정을 먼저 생성한 뒤
-- 아래 이메일을 실제 관리자 이메일로 바꾸고 1회 실행하세요.
-- insert into public.admin_users(user_id)
-- select id from auth.users where email='YOUR_ADMIN_EMAIL@example.com'
-- on conflict do nothing;

-- V3.1 관리자 계정: Supabase Authentication > Users에서 admin@allin.club / 1111 생성 후 실행
insert into public.admin_users(user_id)
select id from auth.users where email='admin@allin.club'
on conflict do nothing;


-- ===== V3.5 회비 다개월/연납 기능 =====
-- ===== V3.5 회비 다개월/연납 및 납부 수정 =====

create table if not exists public.fee_payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  start_month date not null,
  months_count int not null check(months_count in (1,3,6,12)),
  paid_date date not null,
  amount numeric(12,0) not null check(amount>=0),
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.fees
  add column if not exists payment_id uuid references public.fee_payments(id) on delete set null;

alter table public.fee_payments enable row level security;

drop policy if exists admin_all on public.fee_payments;
create policy admin_all on public.fee_payments
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create or replace function public.admin_save_fee_payment(
  p_payment_id uuid,
  p_member_id uuid,
  p_start_month date,
  p_months_count int,
  p_paid_date date
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_payment_id uuid;
  v_tx_id uuid;
  v_member public.members;
  v_fee numeric;
  v_amount numeric;
  i int;
  v_month date;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_months_count not in (1,3,6,12) then raise exception 'invalid months_count'; end if;

  select * into v_member from public.members where id=p_member_id;
  if v_member.id is null then raise exception 'member not found'; end if;

  select monthly_fee into v_fee from public.club_settings where id=1;
  v_amount := v_fee * p_months_count;

  if p_payment_id is not null then
    select transaction_id into v_tx_id from public.fee_payments where id=p_payment_id for update;
    if not found then raise exception 'payment not found'; end if;

    update public.fees
       set paid=false, paid_date=null, transaction_id=null, payment_id=null
     where payment_id=p_payment_id;

    if v_tx_id is not null then
      delete from public.transactions where id=v_tx_id;
    end if;

    v_payment_id := p_payment_id;
  else
    v_payment_id := gen_random_uuid();
  end if;

  insert into public.transactions(tx_date,tx_type,category,target,amount,memo,source,ref_id)
  values(
    p_paid_date,
    'income',
    '회비',
    v_member.name,
    v_amount,
    to_char(date_trunc('month',p_start_month),'YYYY-MM')||' 시작 '||p_months_count||'개월 회비',
    'fee',
    v_payment_id
  )
  returning id into v_tx_id;

  insert into public.fee_payments(id,member_id,start_month,months_count,paid_date,amount,transaction_id)
  values(v_payment_id,p_member_id,date_trunc('month',p_start_month)::date,p_months_count,p_paid_date,v_amount,v_tx_id)
  on conflict(id) do update set
    member_id=excluded.member_id,
    start_month=excluded.start_month,
    months_count=excluded.months_count,
    paid_date=excluded.paid_date,
    amount=excluded.amount,
    transaction_id=excluded.transaction_id;

  for i in 0..p_months_count-1 loop
    v_month := (date_trunc('month',p_start_month) + make_interval(months=>i))::date;

    if exists(
      select 1 from public.fees
      where member_id=p_member_id
        and fee_month=v_month
        and paid=true
        and payment_id is distinct from v_payment_id
    ) then
      raise exception '% 월은 이미 납부 처리되어 있습니다.', to_char(v_month,'YYYY-MM');
    end if;

    insert into public.fees(member_id,fee_month,paid,paid_date,transaction_id,payment_id)
    values(p_member_id,v_month,true,p_paid_date,v_tx_id,v_payment_id)
    on conflict(member_id,fee_month) do update set
      paid=true,
      paid_date=p_paid_date,
      transaction_id=v_tx_id,
      payment_id=v_payment_id;
  end loop;

  return v_payment_id;
end;
$$;

create or replace function public.admin_cancel_fee_payment(p_payment_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_tx_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select transaction_id into v_tx_id
  from public.fee_payments
  where id=p_payment_id
  for update;

  if not found then raise exception 'payment not found'; end if;

  update public.fees
     set paid=false,
         paid_date=null,
         transaction_id=null,
         payment_id=null
   where payment_id=p_payment_id;

  delete from public.fee_payments where id=p_payment_id;

  if v_tx_id is not null then
    delete from public.transactions where id=v_tx_id;
  end if;

  return true;
end;
$$;

grant execute on function public.admin_save_fee_payment(uuid,uuid,date,int,date) to authenticated;
grant execute on function public.admin_cancel_fee_payment(uuid) to authenticated;

-- ===== V4 출생연도 / 랜덤 팀 / 회원 조회 대시보드 =====

alter table public.members add column if not exists birth_year int;
update public.members
set birth_year = extract(year from current_date)::int - age
where birth_year is null and age is not null;

create or replace function public.admin_create_member_v40(
  p_name text,
  p_birth_year int,
  p_phone text,
  p_position text,
  p_pin text
)
returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare new_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN must be 4 digits'; end if;
  if p_birth_year is not null and (p_birth_year < 1930 or p_birth_year > extract(year from current_date)::int) then
    raise exception 'invalid birth year';
  end if;
  insert into public.members(name,birth_year,phone,position,pin_hash)
  values(p_name,p_birth_year,p_phone,p_position,extensions.crypt(p_pin,extensions.gen_salt('bf')))
  returning id into new_id;
  return new_id;
end $$;

grant execute on function public.admin_create_member_v40(text,int,text,text,text) to authenticated;

create or replace function public.admin_generate_random_teams(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count int;
  v_team_count int;
  v_team_no int;
  v_team_id uuid;
  r record;
  v_idx int := 0;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  if exists(
    select 1 from public.games g
    join public.teams t on t.id in (g.team_a,g.team_b)
    where t.meeting_id=p_meeting_id
  ) then
    raise exception '경기가 등록된 모임은 팀을 다시 생성할 수 없습니다.';
  end if;

  delete from public.teams where meeting_id=p_meeting_id;

  select count(*) into v_count
  from public.attendance
  where meeting_id=p_meeting_id and attending=true;

  v_team_count := floor(v_count / 4.0)::int;

  if v_team_count < 1 then
    return jsonb_build_object('team_count',0,'mode','random');
  end if;

  for v_team_no in 1..v_team_count loop
    insert into public.teams(meeting_id,team_no,team_name)
    values(p_meeting_id,v_team_no,v_team_no||'팀')
    returning id into v_team_id;
  end loop;

  for r in
    select a.member_id, row_number() over(order by random()) as rn
    from public.attendance a
    where a.meeting_id=p_meeting_id and a.attending=true
    order by random()
    limit (v_team_count*4)
  loop
    v_idx := v_idx + 1;
    select id into v_team_id
    from public.teams
    where meeting_id=p_meeting_id
      and team_no=((v_idx-1)/4)+1;

    insert into public.team_members(team_id,member_id)
    values(v_team_id,r.member_id);
  end loop;

  return jsonb_build_object('team_count',v_team_count,'mode','random');
end $$;

grant execute on function public.admin_generate_random_teams(uuid) to authenticated;

create or replace function public.get_member_dashboard(p_month date)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_start date := date_trunc('month',p_month)::date;
  v_end date := (date_trunc('month',p_month)+interval '1 month')::date;
  v_total int;
  v_paid int;
  v_income numeric;
  v_expense numeric;
  v_balance numeric;
  v_total_due numeric;
  v_paid_due numeric;
  v_unpaid_due numeric;
  v_unpaid_count int;
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
      'total',v_total,
      'paid',v_paid,
      'unpaid',greatest(v_total-v_paid,0),
      'rate',case when v_total=0 then 0 else round(v_paid::numeric/v_total*100) end,
      'members',coalesce((
        select jsonb_agg(jsonb_build_object(
          'name',m.name,
          'paid',coalesce(f.paid,false),
          'paid_date',f.paid_date
        ) order by m.name)
        from public.members m
        left join public.fees f on f.member_id=m.id and f.fee_month=v_start
        where m.active=true
      ),'[]'::jsonb)
    ),
    'cash',jsonb_build_object(
      'income',v_income,
      'expense',v_expense,
      'balance',v_balance,
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
      'total_amount',v_total_due,
      'paid_amount',v_paid_due,
      'unpaid_amount',v_unpaid_due,
      'unpaid_count',v_unpaid_count,
      'items',coalesce((
        select jsonb_agg(jsonb_build_object(
          'due_date',d.due_date,
          'name',m.name,
          'amount',d.amount,
          'status',d.status
        ) order by d.due_date desc,m.name)
        from public.game_dues d
        join public.members m on m.id=d.member_id
        where d.due_date>=v_start and d.due_date<v_end
      ),'[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end $$;

grant execute on function public.get_member_dashboard(date) to anon,authenticated;


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
