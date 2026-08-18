-- ALLIN V5.9.5
-- 회원 실력 기반 포지션 균형 편성 + 3팀 1:1:1 재경기 게임비 2배 보장

alter table public.members
  add column if not exists skill_level smallint not null default 3;

alter table public.members
  drop constraint if exists members_skill_level_check;

alter table public.members
  add constraint members_skill_level_check
  check (skill_level between 1 and 5);

comment on column public.members.skill_level is
  '팀 균형 편성용 실력 등급: 1 입문, 2 초급, 3 중급, 4 상급, 5 최상급';

create or replace function public.admin_generate_balanced_teams_v51(
  p_meeting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_count int;
  v_team_count int;
  v_team_no int;
  v_team_id uuid;
  v_min_skill int;
  v_max_skill int;
  r record;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  if exists(select 1 from public.match_series where meeting_id=p_meeting_id and status='active')
     or exists(select 1 from public.three_team_series where meeting_id=p_meeting_id and status='active') then
    raise exception '진행 중인 시리즈가 있어 팀을 다시 편성할 수 없습니다.';
  end if;

  select count(*) into v_count
  from public.attendance
  where meeting_id=p_meeting_id and attending=true;

  if v_count<4 then
    raise exception '팀 편성에는 최소 4명의 참석자가 필요합니다.';
  end if;

  v_team_count:=case when v_count>=12 then 3 else 2 end;

  delete from public.teams where meeting_id=p_meeting_id;

  drop table if exists pg_temp.allin_team_balance;
  create temporary table allin_team_balance(
    team_id uuid primary key,
    team_no int not null,
    member_count int not null default 0,
    skill_total int not null default 0,
    attack_count int not null default 0,
    toss_count int not null default 0,
    left_count int not null default 0,
    right_count int not null default 0
  ) on commit drop;

  for v_team_no in 1..v_team_count loop
    insert into public.teams(meeting_id,team_no,team_name)
    values(p_meeting_id,v_team_no,v_team_no||'팀')
    returning id into v_team_id;

    insert into allin_team_balance(team_id,team_no)
    values(v_team_id,v_team_no);
  end loop;

  -- 실력이 높은 선수부터 배치하고, 매 순서마다 인원수를 먼저 맞춘 뒤
  -- 같은 주 포지션 수와 현재 실력 합계를 합산한 점수가 가장 낮은 팀을 선택합니다.
  for r in
    select a.member_id,m.position,coalesce(m.skill_level,3)::int as skill_level
    from public.attendance a
    join public.members m on m.id=a.member_id
    where a.meeting_id=p_meeting_id and a.attending=true
    order by coalesce(m.skill_level,3) desc, random()
  loop
    select b.team_id into v_team_id
    from allin_team_balance b
    order by
      b.member_count,
      (case r.position
        when '공격' then b.attack_count
        when '토스' then b.toss_count
        when '좌수비' then b.left_count
        when '우수비' then b.right_count
        else 0
      end)*6+b.skill_total,
      b.skill_total,
      random()
    limit 1;

    insert into public.team_members(team_id,member_id)
    values(v_team_id,r.member_id);

    update allin_team_balance
    set member_count=member_count+1,
        skill_total=skill_total+r.skill_level,
        attack_count=attack_count+case when r.position='공격' then 1 else 0 end,
        toss_count=toss_count+case when r.position='토스' then 1 else 0 end,
        left_count=left_count+case when r.position='좌수비' then 1 else 0 end,
        right_count=right_count+case when r.position='우수비' then 1 else 0 end
    where team_id=v_team_id;
  end loop;

  select min(skill_total),max(skill_total)
  into v_min_skill,v_max_skill
  from allin_team_balance;

  return jsonb_build_object(
    'team_count',v_team_count,
    'mode','position_skill_balanced',
    'assigned_count',v_count,
    'min_skill_total',v_min_skill,
    'max_skill_total',v_max_skill,
    'skill_gap',v_max_skill-v_min_skill
  );
end
$$;

grant execute on function public.admin_generate_balanced_teams_v51(uuid)
to authenticated;

-- V5.9.2의 수동 게임비 트리거가 3팀 재경기 2배 금액을 다시
-- 기본 금액으로 덮어쓰지 않도록 보정합니다.
create or replace function public.apply_manual_series_fee_v592()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.status='completed' and new.manual_fee_amount is not null then
    if tg_table_name='three_team_series' and coalesce(new.reset_count,0)>0 then
      new.fee_amount:=new.manual_fee_amount*2;
    else
      new.fee_amount:=new.manual_fee_amount;
    end if;
  end if;
  return new;
end
$$;

create or replace function public.apply_manual_game_due_fee_v592()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_fee numeric(12,0);
  v_reset_count int:=0;
begin
  if new.series_id is not null then
    select manual_fee_amount into v_fee
    from public.match_series where id=new.series_id;
  elsif new.three_team_series_id is not null then
    select manual_fee_amount,coalesce(reset_count,0)
    into v_fee,v_reset_count
    from public.three_team_series where id=new.three_team_series_id;
  end if;

  if v_fee is not null then
    new.amount:=v_fee*case when v_reset_count>0 then 2 else 1 end;
  end if;
  return new;
end
$$;

notify pgrst,'reload schema';
