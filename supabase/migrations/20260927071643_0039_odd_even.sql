-- 홀짝(미니게임). 가위바위보(0037)와 같은 규칙:
--   - 브론즈 등급 이상만, 최소 100P, 최대 제한 없음(보유 포인트까지)
--   - 한 판 하고 3초 안에는 다시 못 함(연타/스크립트 방지 — 화면 연출 + 결과 후 2초 대기라 정상적으로는 안 걸림)
--   - 카드(A=1 ~ 10)는 이 DB 함수가 뽑음. 화면은 받은 카드를 뒤집어 보여주는 연출만 함.
-- 홀(1,3,5,7,9)·짝(2,4,6,8,10) 각 50%. 맞히면 1.9배, 틀리면 0 → 평균 돌려받는 비율 95%.
-- 배당을 바꾸려면 아래 ODD_EVEN_WIN_MULTIPLIER 자리(1.9)만 고치면 됨 — 2 이상이면 포인트가 계속 불어나니 주의.
--
-- 포인트 기록은 순수 변동분 한 줄(맞히면 +0.9배, 틀리면 -건 포인트). 판 기록 전체는 odd_even_games에 남음.

create table if not exists public.odd_even_games (
  id bigint generated always as identity primary key,
  channel_id text not null references public.users (channel_id) on delete cascade,
  bet bigint not null check (bet > 0),
  pick text not null check (pick in ('odd', 'even')),
  card smallint not null check (card between 1 and 10),
  result text not null check (result in ('win', 'lose')),
  payout bigint not null check (payout >= 0),
  created_at timestamptz not null default now()
);
create index if not exists odd_even_games_channel_created_idx on public.odd_even_games (channel_id, created_at desc);

-- Edge Function(service_role)만 읽고 씀.
alter table public.odd_even_games enable row level security;

-- 홀짝 한 판. 실패하면 예외 메시지로 이유를 알려줌:
--   invalid_bet / invalid_pick / user_not_found / banned / tier_required / cooldown:<남은 초> / insufficient_balance
create or replace function public.odd_even_play(p_channel_id text, p_bet bigint, p_pick text)
returns jsonb as $$
declare
  v_balance bigint;
  v_max bigint;
  v_banned boolean;
  v_required bigint;
  v_last timestamptz;
  v_card int;
  v_result text;
  v_payout bigint;
  v_net bigint;
begin
  -- 상한 4억은 포인트 기록 칸(integer) 범위를 넘지 않게 하려는 기술적 한계일 뿐(실제로 닿을 일 없음).
  if p_bet is null or p_bet < 100 or p_bet > 400000000 then
    raise exception 'invalid_bet';
  end if;
  if p_pick is null or p_pick not in ('odd', 'even') then
    raise exception 'invalid_pick';
  end if;

  select balance, max_balance_reached, banned into v_balance, v_max, v_banned
  from public.users where channel_id = p_channel_id for update;
  if not found then raise exception 'user_not_found'; end if;
  if v_banned then raise exception 'banned'; end if;

  select coalesce(min(min_points), 0) into v_required from public.titles where kind = 'tier';
  if v_max < v_required then raise exception 'tier_required'; end if;

  select created_at into v_last from public.odd_even_games
  where channel_id = p_channel_id order by created_at desc limit 1;
  if v_last is not null and v_last > now() - interval '3 seconds' then
    raise exception 'cooldown:%', greatest(1, ceil(extract(epoch from (v_last + interval '3 seconds' - now())))::int);
  end if;

  if v_balance < p_bet then raise exception 'insufficient_balance'; end if;

  v_card := 1 + floor(random() * 10)::int;

  if (v_card % 2 = 1) = (p_pick = 'odd') then
    v_result := 'win';
    v_payout := floor(p_bet * 1.9)::bigint; -- ODD_EVEN_WIN_MULTIPLIER
  else
    v_result := 'lose';
    v_payout := 0;
  end if;
  v_net := v_payout - p_bet;

  insert into public.points_ledger (channel_id, amount, reason)
  values (
    p_channel_id,
    v_net,
    format('홀짝 %s (%s, %sP 걸음)', case v_result when 'win' then '맞힘' else '틀림' end,
           case p_pick when 'odd' then '홀' else '짝' end, p_bet)
  );

  insert into public.odd_even_games (channel_id, bet, pick, card, result, payout)
  values (p_channel_id, p_bet, p_pick, v_card, v_result, v_payout);

  select balance into v_balance from public.users where channel_id = p_channel_id;

  return jsonb_build_object(
    'card', v_card,
    'result', v_result,
    'payout', v_payout,
    'net', v_net,
    'balance', v_balance
  );
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.odd_even_play(text, bigint, text) from public, anon, authenticated;
grant execute on function public.odd_even_play(text, bigint, text) to service_role;
