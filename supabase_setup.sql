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
