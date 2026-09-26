-- 룰렛(포인트 걸고 배율 뽑기).
--
-- 규칙:
--   - 브론즈 등급 이상(최고 보유 포인트가 가장 낮은 구간 칭호 기준 이상)만 참여 가능
--   - 최소 100P, 최대 제한 없음(보유 포인트까지)
--   - 한 번 돌리고 5초 안에는 다시 못 돌림(연타/스크립트 방지 — 화면 연출이 5초 넘게 걸려서
--     정상적으로 쓰는 사람은 걸릴 일 없음)
--   - 결과(배율)는 이 DB 함수가 정함. 화면은 받은 결과에 맞춰 멈추는 연출만 함.
--
-- 확률은 roulette_outcomes 테이블(가중치, 합계 기준)이라 Supabase 테이블 편집기에서 바로 조절 가능.
-- 처음 값(가중치 합 10000 = 100%):
--   x0 9% / x0.5 17% / x1 47% / x1.2 14% / x1.5 8.5% / x2 3% / x3 1% / x5 0.5%
--   → 잃음 26% · 본전 47% · 이득 27%, 평균 돌려받는 비율 약 96.6%
-- 평균 돌려받는 비율은 반드시 100% 아래로 둘 것 — 넘기면 많이 돌릴수록 포인트가 계속 불어남.
-- (지금 값이면 100P씩 100번 돌리면 평균 약 345P가 사라짐)
--
-- 포인트 기록은 "순수 변동분" 한 줄만 남김(예: 500P 걸어서 x1.5면 +250, x0.5면 -250, 본전이면 기록 없음).
-- 돌린 기록 전체(본전 포함)는 roulette_spins에 남음.

create table if not exists public.roulette_outcomes (
  multiplier numeric(4, 2) primary key check (multiplier >= 0 and multiplier <= 10),
  weight integer not null check (weight >= 0)
);

insert into public.roulette_outcomes (multiplier, weight) values
  (0, 900), (0.5, 1700), (1, 4700), (1.2, 1400), (1.5, 850), (2, 300), (3, 100), (5, 50)
on conflict (multiplier) do nothing;

create table if not exists public.roulette_spins (
  id bigint generated always as identity primary key,
  channel_id text not null references public.users (channel_id) on delete cascade,
  bet bigint not null check (bet > 0),
  multiplier numeric(4, 2) not null,
  payout bigint not null check (payout >= 0),
  created_at timestamptz not null default now()
);
create index if not exists roulette_spins_channel_created_idx on public.roulette_spins (channel_id, created_at desc);

-- 두 테이블 다 Edge Function(service_role)만 읽고 씀 — 정책 없이 RLS만 켜두면 anon은 접근 불가.
alter table public.roulette_outcomes enable row level security;
alter table public.roulette_spins enable row level security;

-- 룰렛 한 번 돌리기. 유저 행을 잠근 채로 자격/쿨타임/잔액 확인 → 배율 뽑기 → 기록까지 한 번에 처리해서
-- 같은 유저가 연타해도 한 줄로 세워짐. 실패하면 예외 메시지로 이유를 알려줌:
--   invalid_bet / user_not_found / banned / tier_required / cooldown:<남은 초> / insufficient_balance / no_outcomes
create or replace function public.roulette_spin(p_channel_id text, p_bet bigint)
returns jsonb as $$
declare
  v_balance bigint;
  v_max bigint;
  v_banned boolean;
  v_required bigint;
  v_last timestamptz;
  v_total bigint;
  v_roll bigint;
  v_mult numeric(4, 2);
  v_payout bigint;
  v_net bigint;
  o record;
begin
  -- 상한 4억은 포인트 기록 칸(integer) 범위를 넘지 않게 하려는 기술적 한계일 뿐(실제로 닿을 일 없음).
  if p_bet is null or p_bet < 100 or p_bet > 400000000 then
    raise exception 'invalid_bet';
  end if;

  select balance, max_balance_reached, banned into v_balance, v_max, v_banned
  from public.users where channel_id = p_channel_id for update;
  if not found then raise exception 'user_not_found'; end if;
  if v_banned then raise exception 'banned'; end if;

  select coalesce(min(min_points), 0) into v_required from public.titles where kind = 'tier';
  if v_max < v_required then raise exception 'tier_required'; end if;

  select created_at into v_last from public.roulette_spins
  where channel_id = p_channel_id order by created_at desc limit 1;
  if v_last is not null and v_last > now() - interval '5 seconds' then
    raise exception 'cooldown:%', greatest(1, ceil(extract(epoch from (v_last + interval '5 seconds' - now())))::int);
  end if;

  if v_balance < p_bet then raise exception 'insufficient_balance'; end if;

  select coalesce(sum(weight), 0) into v_total from public.roulette_outcomes where weight > 0;
  if v_total <= 0 then raise exception 'no_outcomes'; end if;

  v_roll := floor(random() * v_total)::bigint;
  for o in select multiplier, weight from public.roulette_outcomes where weight > 0 order by multiplier loop
    if v_roll < o.weight then
      v_mult := o.multiplier;
      exit;
    end if;
    v_roll := v_roll - o.weight;
  end loop;

  v_payout := floor(p_bet * v_mult)::bigint;
  v_net := v_payout - p_bet;

  if v_net <> 0 then
    insert into public.points_ledger (channel_id, amount, reason)
    values (p_channel_id, v_net, format('룰렛 x%s (%sP 걸음)', trim_scale(v_mult), p_bet));
  end if;

  insert into public.roulette_spins (channel_id, bet, multiplier, payout)
  values (p_channel_id, p_bet, v_mult, v_payout);

  select balance into v_balance from public.users where channel_id = p_channel_id;

  return jsonb_build_object(
    'multiplier', trim_scale(v_mult),
    'payout', v_payout,
    'net', v_net,
    'balance', v_balance
  );
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.roulette_spin(text, bigint) from public, anon, authenticated;
grant execute on function public.roulette_spin(text, bigint) to service_role;
