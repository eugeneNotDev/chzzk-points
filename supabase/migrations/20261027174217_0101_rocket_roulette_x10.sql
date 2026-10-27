-- 0101 — 양 로켓(크래시 게임) + 룰렛 x10
--
-- 룰렛: x10 칸 추가, 대신 x0을 늘리고 x1.2·x3·x5를 줄여서 기댓값은 그대로(96.55%).
--
-- 양 로켓: 발사하면 배수가 m(t) = e^(0.13·t)로 오르다가(t는 초, 소수 둘째 자리에서 버림)
-- 정해진 배수(crash_at)에서 터짐. 터지기 전에 내리면 베팅 × 그 순간 배수를 받음.
--  - crash_at은 발사할 때 DB가 정하고 화면엔 끝날 때까지 안 내려줌.
--    0.95 / (1 - random()) → "x배 이상 갈 확률 = 0.95 / x"라서 언제 내리든 기댓값 95%. 1 미만이면 바로 터짐(x1.00).
--  - 내리기 판정은 요청이 DB에 도착한 시각(now()) 기준.
--  - 자동 내리기(auto_at)를 정해두면, 그 배수가 crash_at보다 낮을 때 그 배수에서 내린 걸로 처리.
--  - 창을 닫고 떠난 판은 다음에 상태를 볼 때(rocket_sync/start) 정리됨(자동 내리기 없으면 터진 걸로).
--  - 발사할 때 베팅만큼 빼고(-bet), 내리면 받는 금액을 더함(+payout).
--  - 한 판 최대 1,000만P, 최대 배수 x200(포인트 기록 칸 integer 범위 때문).

update public.roulette_outcomes set weight = case multiplier
  when 0 then 1000 when 0.5 then 1700 when 1 then 4700 when 1.2 then 1300
  when 1.5 then 850 when 2 then 300 when 3 then 90 when 5 then 40 else weight end;
insert into public.roulette_outcomes (multiplier, weight)
select 10, 20 where not exists (select 1 from public.roulette_outcomes where multiplier = 10);

create table public.rocket_rounds (
  id bigint generated always as identity primary key,
  channel_id text not null,
  bet bigint not null check (bet >= 100),
  crash_at numeric(8, 2) not null,
  auto_at numeric(8, 2),
  started_at timestamptz not null default now(),
  status text not null default 'flying' check (status in ('flying', 'cashed', 'crashed')),
  cashed_at numeric(8, 2),
  payout bigint not null default 0,
  ended_at timestamptz
);
create index rocket_rounds_channel_started_idx on public.rocket_rounds (channel_id, started_at desc);
create unique index rocket_rounds_one_flying on public.rocket_rounds (channel_id) where status = 'flying';
alter table public.rocket_rounds enable row level security;
revoke all on public.rocket_rounds from anon, authenticated;

-- 경과 시간(초) → 배수
create or replace function public.rocket_mult(p_elapsed double precision)
returns numeric language sql immutable set search_path = public as $$
  select (floor(exp(0.13 * greatest(p_elapsed, 0)) * 100) / 100)::numeric
$$;

-- 배수 → 그 배수에 닿는 시각
create or replace function public.rocket_time_of(p_started timestamptz, p_mult numeric)
returns timestamptz language sql immutable set search_path = public as $$
  select p_started + make_interval(secs => (ln(p_mult) / 0.13)::double precision)
$$;

-- 판 끝내기(잠근 뒤에만 부름)
create or replace function public.rocket_close(p_id bigint, p_status text, p_mult numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.rocket_rounds;
  v_payout bigint := 0;
begin
  select * into r from public.rocket_rounds where id = p_id;
  if r.status <> 'flying' then return; end if;
  if p_status = 'cashed' then
    v_payout := floor(r.bet * p_mult)::bigint;
    insert into public.points_ledger (channel_id, amount, reason)
    values (r.channel_id, v_payout, format('양 로켓 x%s에서 내림 (%sP 걸음)', to_char(p_mult, 'FM9990.00'), r.bet));
  end if;
  update public.rocket_rounds
  set status = p_status, cashed_at = case when p_status = 'cashed' then p_mult end, payout = v_payout, ended_at = now()
  where id = p_id;
end;
$$;

-- 시간이 다 된(자동 내리기 or 터짐) 판 정리
create or replace function public.rocket_settle_due(p_channel_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in select id, crash_at, auto_at, started_at from public.rocket_rounds
           where channel_id = p_channel_id and status = 'flying' for update loop
    if r.auto_at is not null and r.auto_at < r.crash_at then
      if now() >= public.rocket_time_of(r.started_at, r.auto_at) then
        perform public.rocket_close(r.id, 'cashed', r.auto_at);
      end if;
    elsif now() >= public.rocket_time_of(r.started_at, r.crash_at) then
      perform public.rocket_close(r.id, 'crashed', null);
    end if;
  end loop;
end;
$$;

-- 판 하나의 지금 상태(진행 중이면 crash_at은 안 내려줌)
create or replace function public.rocket_result(p_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'roundId', r.id,
    'status', r.status,
    'bet', r.bet,
    'autoAt', r.auto_at,
    'startedAt', r.started_at,
    'crashAt', case when r.status = 'flying' then null else r.crash_at end,
    'cashedAt', r.cashed_at,
    'payout', r.payout,
    'net', case when r.status = 'flying' then null else r.payout - r.bet end,
    'balance', u.balance,
    'serverNow', now()
  )
  from public.rocket_rounds r join public.users u on u.channel_id = r.channel_id
  where r.id = p_id
$$;

-- 화면 들어올 때: 끝난 판 정리 + 진행 중인 판(있으면)
create or replace function public.rocket_sync(p_channel_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  perform 1 from public.users where channel_id = p_channel_id for update;
  if not found then raise exception 'user_not_found'; end if;
  perform public.rocket_settle_due(p_channel_id);
  select id into v_id from public.rocket_rounds where channel_id = p_channel_id and status = 'flying';
  return jsonb_build_object('active', case when v_id is null then null else public.rocket_result(v_id) end, 'serverNow', now());
end;
$$;

create or replace function public.rocket_start(p_channel_id text, p_bet bigint, p_auto numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_balance bigint;
  v_max bigint;
  v_banned boolean;
  v_required bigint;
  v_auto numeric(8, 2);
  v_x double precision;
  v_crash numeric(8, 2);
  v_id bigint;
begin
  if p_bet is null or p_bet < 100 or p_bet > 10000000 then raise exception 'invalid_bet'; end if;
  v_auto := round(p_auto, 2);
  if v_auto is not null and (v_auto < 1.01 or v_auto > 200) then raise exception 'invalid_auto'; end if;

  select balance, max_balance_reached, banned into v_balance, v_max, v_banned
  from public.users where channel_id = p_channel_id for update;
  if not found then raise exception 'user_not_found'; end if;
  if v_banned then raise exception 'banned'; end if;

  select coalesce(min(min_points), 0) into v_required from public.titles where kind = 'tier';
  if v_max < v_required then raise exception 'tier_required'; end if;

  perform public.rocket_settle_due(p_channel_id);
  if exists (select 1 from public.rocket_rounds where channel_id = p_channel_id and status = 'flying') then
    raise exception 'round_active';
  end if;

  select balance into v_balance from public.users where channel_id = p_channel_id;
  if v_balance < p_bet then raise exception 'insufficient_balance'; end if;

  insert into public.points_ledger (channel_id, amount, reason)
  values (p_channel_id, -p_bet, format('양 로켓 발사 (%sP 걸음)', p_bet));

  v_x := 0.95 / (1 - random());
  v_crash := case when v_x < 1 then 1.00 else least(200, floor(v_x * 100) / 100) end;

  insert into public.rocket_rounds (channel_id, bet, crash_at, auto_at)
  values (p_channel_id, p_bet, v_crash, v_auto)
  returning id into v_id;

  return public.rocket_result(v_id);
end;
$$;

create or replace function public.rocket_cashout(p_channel_id text, p_round_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.rocket_rounds;
  v_m numeric;
begin
  perform 1 from public.users where channel_id = p_channel_id for update;
  if not found then raise exception 'user_not_found'; end if;
  select * into r from public.rocket_rounds where id = p_round_id and channel_id = p_channel_id for update;
  if not found then raise exception 'round_not_found'; end if;
  if r.status = 'flying' then
    v_m := public.rocket_mult(extract(epoch from (now() - r.started_at))::double precision);
    if r.auto_at is not null and r.auto_at < r.crash_at and v_m >= r.auto_at then
      perform public.rocket_close(r.id, 'cashed', r.auto_at);
    elsif v_m >= r.crash_at then
      perform public.rocket_close(r.id, 'crashed', null);
    else
      perform public.rocket_close(r.id, 'cashed', v_m);
    end if;
  end if;
  return public.rocket_result(r.id);
end;
$$;

-- 지켜보기(watch)용: 시간이 됐으면 정리하고 상태 반환
create or replace function public.rocket_settle(p_channel_id text, p_round_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.users where channel_id = p_channel_id for update;
  if not found then raise exception 'user_not_found'; end if;
  if not exists (select 1 from public.rocket_rounds where id = p_round_id and channel_id = p_channel_id) then
    raise exception 'round_not_found';
  end if;
  perform public.rocket_settle_due(p_channel_id);
  return public.rocket_result(p_round_id);
end;
$$;

revoke execute on function public.rocket_mult(double precision) from public, anon, authenticated;
revoke execute on function public.rocket_time_of(timestamptz, numeric) from public, anon, authenticated;
revoke execute on function public.rocket_close(bigint, text, numeric) from public, anon, authenticated;
revoke execute on function public.rocket_settle_due(text) from public, anon, authenticated;
revoke execute on function public.rocket_result(bigint) from public, anon, authenticated;
revoke execute on function public.rocket_sync(text) from public, anon, authenticated;
revoke execute on function public.rocket_start(text, bigint, numeric) from public, anon, authenticated;
revoke execute on function public.rocket_cashout(text, bigint) from public, anon, authenticated;
revoke execute on function public.rocket_settle(text, bigint) from public, anon, authenticated;
