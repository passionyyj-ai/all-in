-- ALLIN V4.6 회비 납부 안정화 SQL
-- 기존 회비 테이블을 보존하면서 1/3/6/12개월 납부 기능을 재정비합니다.

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

-- 명시적 테이블 권한. RLS가 실제 접근 범위를 제한합니다.
grant select,insert,update,delete on public.fee_payments to authenticated;
grant select,insert,update,delete on public.fees to authenticated;
grant select,insert,update,delete on public.transactions to authenticated;
grant select,update on public.club_settings to authenticated;

insert into public.club_settings(id,monthly_fee)
values(1,20000)
on conflict(id) do nothing;

drop function if exists public.admin_save_fee_payment(uuid,uuid,date,int,date);

create function public.admin_save_fee_payment(
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
  v_member_name text;
  v_monthly_fee numeric(12,0);
  v_amount numeric(12,0);
  v_tx_id uuid;
  v_old_tx_id uuid;
  v_existing_payment uuid;
  i integer;
  v_month date;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  if p_member_id is null then
    raise exception '회원 정보가 없습니다.';
  end if;

  if p_start_month is null or p_paid_date is null then
    raise exception '적용 시작월과 실제 입금일은 필수입니다.';
  end if;

  if p_months_count not in (1,3,6,12) then
    raise exception '납부 기간은 1, 3, 6, 12개월만 가능합니다.';
  end if;

  select name
    into v_member_name
  from public.members
  where id=p_member_id and active=true;

  if v_member_name is null then
    raise exception '활성 회원을 찾을 수 없습니다.';
  end if;

  select monthly_fee
    into v_monthly_fee
  from public.club_settings
  where id=1;

  if v_monthly_fee is null or v_monthly_fee < 0 then
    raise exception '월 회비 설정을 확인하세요.';
  end if;

  v_amount := v_monthly_fee * p_months_count;

  -- 수정 시 기존 연결 월/수입을 먼저 해제
  if p_payment_id is not null then
    select transaction_id
      into v_old_tx_id
    from public.fee_payments
    where id=p_payment_id
    for update;

    if not found then
      raise exception '수정할 회비 납부 내역을 찾을 수 없습니다.';
    end if;

    update public.fees
       set paid=false,
           paid_date=null,
           transaction_id=null,
           payment_id=null
     where payment_id=p_payment_id;

    if v_old_tx_id is not null then
      delete from public.transactions where id=v_old_tx_id;
    end if;

    update public.fee_payments
       set member_id=p_member_id,
           start_month=date_trunc('month',p_start_month)::date,
           months_count=p_months_count,
           paid_date=p_paid_date,
           amount=v_amount,
           transaction_id=null
     where id=p_payment_id
     returning id into v_payment_id;
  else
    insert into public.fee_payments(
      member_id,start_month,months_count,paid_date,amount
    )
    values(
      p_member_id,
      date_trunc('month',p_start_month)::date,
      p_months_count,
      p_paid_date,
      v_amount
    )
    returning id into v_payment_id;
  end if;

  -- 이미 다른 다개월 납부가 차지한 월이 있는지 검사
  for i in 0..p_months_count-1 loop
    v_month := (date_trunc('month',p_start_month) + (i || ' months')::interval)::date;

    select payment_id
      into v_existing_payment
    from public.fees
    where member_id=p_member_id
      and fee_month=v_month
      and paid=true
      and payment_id is not null
      and payment_id<>v_payment_id
    limit 1;

    if v_existing_payment is not null then
      raise exception '% 월은 이미 다른 회비 납부에 연결되어 있습니다.', to_char(v_month,'YYYY-MM');
    end if;
  end loop;

  insert into public.transactions(
    tx_date,tx_type,category,target,amount,memo,source,ref_id
  )
  values(
    p_paid_date,
    'income',
    '월 회비',
    v_member_name,
    v_amount,
    to_char(date_trunc('month',p_start_month),'YYYY-MM') || ' 시작 ' ||
    case
      when p_months_count=1 then '1개월 일시납'
      when p_months_count=12 then '12개월 연납'
      else p_months_count || '개월 회비 납부'
    end,
    'fee',
    v_payment_id
  )
  returning id into v_tx_id;

  update public.fee_payments
     set transaction_id=v_tx_id
   where id=v_payment_id;

  for i in 0..p_months_count-1 loop
    v_month := (date_trunc('month',p_start_month) + (i || ' months')::interval)::date;

    insert into public.fees(
      member_id,fee_month,paid,paid_date,transaction_id,payment_id
    )
    values(
      p_member_id,v_month,true,p_paid_date,v_tx_id,v_payment_id
    )
    on conflict(member_id,fee_month)
    do update set
      paid=true,
      paid_date=excluded.paid_date,
      transaction_id=excluded.transaction_id,
      payment_id=excluded.payment_id;
  end loop;

  return v_payment_id;
exception
  when others then
    raise;
end;
$$;

drop function if exists public.admin_cancel_fee_payment(uuid);

create function public.admin_cancel_fee_payment(
  p_payment_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_tx_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  select transaction_id
    into v_tx_id
  from public.fee_payments
  where id=p_payment_id
  for update;

  if not found then
    raise exception '취소할 회비 납부 내역을 찾을 수 없습니다.';
  end if;

  update public.fees
     set paid=false,
         paid_date=null,
         transaction_id=null,
         payment_id=null
   where payment_id=p_payment_id;

  if v_tx_id is not null then
    delete from public.transactions where id=v_tx_id;
  end if;

  delete from public.fee_payments
  where id=p_payment_id;

  return true;
end;
$$;

grant execute on function public.admin_save_fee_payment(uuid,uuid,date,int,date) to authenticated;
grant execute on function public.admin_cancel_fee_payment(uuid) to authenticated;

-- PostgREST 함수 스키마 캐시 갱신
notify pgrst, 'reload schema';
