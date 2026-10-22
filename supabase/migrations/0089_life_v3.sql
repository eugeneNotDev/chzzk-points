-- 유진 키우기 v3: 인생 진행을 서버 함수(life-game, TypeScript 엔진)로 옮김.
-- DB는 판 저장(life_lives)·도감(life_found)·포인트 결제만 담당. 예전 life_runs/life_* 함수는 더 이상 안 씀(테스트 기록뿐이라 그대로 둠).
create table if not exists public.life_lives (
  id bigserial primary key,
  channel_id text not null references public.users(channel_id) on delete cascade,
  world_no integer,
  is_test boolean not null default false,
  house text not null,
  spent integer not null default 0,
  points_used integer not null default 0,
  status text not null default 'playing' check (status in ('playing', 'ended')),
  age integer not null default 0,
  state jsonb not null,
  log jsonb not null default '[]'::jsonb,
  ver integer not null default 0,
  title text,
  special boolean not null default false,
  kst_date date not null default (now() at time zone 'Asia/Seoul')::date,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index if not exists life_lives_one_playing on public.life_lives (channel_id) where status = 'playing';
create index if not exists life_lives_channel on public.life_lives (channel_id, created_at desc);
create index if not exists life_lives_today on public.life_lives (kst_date, is_test, created_at desc);
alter table public.life_lives enable row level security;

create table if not exists public.life_found (
  channel_id text not null references public.users(channel_id) on delete cascade,
  is_test boolean not null,
  kind text not null,
  ref_id text not null,
  first_life_id bigint,
  first_at timestamptz not null default now(),
  primary key (channel_id, is_test, kind, ref_id)
);
alter table public.life_found enable row level security;

-- 새 판 시작: 진행 중 판·하루 횟수·포인트 확인 → 차감 → 저장을 한 번에
create or replace function public.life_begin(p_channel_id text, p_house text, p_test boolean, p_state jsonb, p_log jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.life_settings; h public.life_houses; u public.users; used int; rid bigint; wno int;
begin
  select * into s from public.life_settings;
  select * into h from public.life_houses where id = p_house;
  if not found then return jsonb_build_object('error', 'bad_house'); end if;
  select * into u from public.users where channel_id = p_channel_id for update;
  if not found or u.banned then return jsonb_build_object('error', 'user_not_found'); end if;
  if exists (select 1 from public.life_lives where channel_id = p_channel_id and status = 'playing') then
    return jsonb_build_object('error', 'in_progress');
  end if;
  if not p_test then
    select count(*) into used from public.life_lives
     where channel_id = p_channel_id and not is_test and kst_date = (now() at time zone 'Asia/Seoul')::date;
    if used >= s.daily_limit then return jsonb_build_object('error', 'daily_limit'); end if;
    if h.price > 0 then
      if u.balance < h.price then return jsonb_build_object('error', 'insufficient_balance'); end if;
      insert into public.points_ledger (channel_id, amount, reason) values (p_channel_id, -h.price, '유진 키우기 · ' || h.name);
    end if;
    wno := nextval('public.life_world_seq');
  end if;
  insert into public.life_lives (channel_id, world_no, is_test, house, spent, age, state, log)
  values (p_channel_id, wno, p_test, h.id, case when p_test then 0 else h.price end, coalesce((p_state->>'age')::int, 0), p_state, p_log)
  returning id into rid;
  return jsonb_build_object('id', rid, 'worldNo', wno, 'balance', (select balance from public.users where channel_id = p_channel_id));
end $$;

-- 포인트로 상점 물건 사기: 횟수·잔액 확인 → 차감 → 바뀐 판 저장(ver가 다르면 전부 취소)
create or replace function public.life_pay(p_channel_id text, p_life_id bigint, p_ver int, p_amount int, p_reason text,
                                           p_state jsonb, p_log jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.life_settings; l public.life_lives; u public.users;
begin
  select * into s from public.life_settings;
  select * into l from public.life_lives where id = p_life_id and channel_id = p_channel_id for update;
  if not found or l.status <> 'playing' then return jsonb_build_object('error', 'not_playing'); end if;
  if l.ver <> p_ver then return jsonb_build_object('error', 'busy'); end if;
  if l.points_used >= s.item_limit then return jsonb_build_object('error', 'item_limit'); end if;
  if not l.is_test and p_amount > 0 then
    select * into u from public.users where channel_id = p_channel_id for update;
    if u.balance < p_amount then return jsonb_build_object('error', 'insufficient_balance'); end if;
    insert into public.points_ledger (channel_id, amount, reason) values (p_channel_id, -p_amount, '유진 키우기 · ' || p_reason);
  end if;
  update public.life_lives
     set state = p_state, log = p_log, ver = ver + 1, points_used = points_used + 1,
         spent = spent + case when l.is_test then 0 else p_amount end
   where id = p_life_id;
  return jsonb_build_object('ok', true, 'balance', (select balance from public.users where channel_id = p_channel_id));
end $$;

revoke all on function public.life_begin(text, text, boolean, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.life_pay(text, bigint, int, int, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.life_begin(text, text, boolean, jsonb, jsonb) to service_role;
grant execute on function public.life_pay(text, bigint, int, int, text, jsonb, jsonb) to service_role;
