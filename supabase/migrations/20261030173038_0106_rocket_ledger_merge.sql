-- 양 로켓 포인트 기록을 한 판에 한 줄로 합침.
-- 발사할 때 "-건 포인트" 한 줄을 남기고, 판이 끝나면 그 줄을 순이익(받은 포인트 - 건 포인트)과 결과 문구로 바꾸고
-- 시각도 끝난 시각으로 옮김. (전엔 발사 -500P / 내림 +535P 두 줄이라 실제 +35P인지 한눈에 안 보였음)
-- 지난 기록도 같은 방식으로 합침 — 잔액은 그대로.

alter table public.rocket_rounds add column if not exists ledger_id bigint;

create or replace function public.rocket_start(p_channel_id text, p_bet bigint, p_auto numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance bigint;
  v_max bigint;
  v_banned boolean;
  v_required bigint;
  v_auto numeric(8, 2);
  v_x double precision;
  v_crash numeric(8, 2);
  v_id bigint;
  v_lid bigint;
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
  values (p_channel_id, -p_bet, format('양 로켓 비행 중 (%sP 걸음)', p_bet))
  returning id into v_lid;

  v_x := 0.95 / (1 - random());
  v_crash := case when v_x < 1 then 1.00 else least(200, floor(v_x * 100) / 100) end;

  insert into public.rocket_rounds (channel_id, bet, crash_at, auto_at, ledger_id)
  values (p_channel_id, p_bet, v_crash, v_auto, v_lid)
  returning id into v_id;

  return public.rocket_result(v_id);
end;
$function$;

create or replace function public.rocket_close(p_id bigint, p_status text, p_mult numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.rocket_rounds;
  v_payout bigint := 0;
  v_reason text;
begin
  select * into r from public.rocket_rounds where id = p_id;
  if r.status <> 'flying' then return; end if;
  if p_status = 'cashed' then
    v_payout := floor(r.bet * p_mult)::bigint;
    v_reason := format('양 로켓 x%s에서 내림 (%sP 걸음)', to_char(p_mult, 'FM9990.00'), r.bet);
  else
    v_reason := format('양 로켓 x%s에서 폭발 (%sP 걸음)', to_char(r.crash_at, 'FM9990.00'), r.bet);
  end if;

  if r.ledger_id is not null then
    -- 발사 때 남긴 줄을 순이익으로 바꿈(잔액은 트리거가 차이만큼 반영)
    update public.points_ledger
    set amount = v_payout - r.bet, reason = v_reason, created_at = now()
    where id = r.ledger_id;
    update public.users set max_balance_reached = greatest(max_balance_reached, balance) where channel_id = r.channel_id;
    insert into public.ranking_pings default values;
  elsif p_status = 'cashed' then
    insert into public.points_ledger (channel_id, amount, reason) values (r.channel_id, v_payout, v_reason);
  end if;

  update public.rocket_rounds
  set status = p_status, cashed_at = case when p_status = 'cashed' then p_mult end, payout = v_payout, ended_at = now()
  where id = p_id;
end;
$function$;

-- 지난 기록 합치기
do $$
declare
  v_before numeric;
  v_after numeric;
begin
  lock table public.rocket_rounds in exclusive mode;
  select sum(balance) into v_before from public.users;

  update public.rocket_rounds r set ledger_id = l.id
  from public.points_ledger l
  where r.ledger_id is null and l.channel_id = r.channel_id and l.created_at = r.started_at
    and l.reason like '양 로켓 발사 (%' and l.amount = -r.bet;

  -- 내림 줄 지우기(트리거가 잔액에서 뺌) → 아래에서 발사 줄을 순이익으로 바꾸며 다시 더함
  delete from public.points_ledger l
  using public.rocket_rounds r
  where r.status = 'cashed' and r.ledger_id is not null
    and l.channel_id = r.channel_id and l.created_at = r.ended_at
    and l.reason like '양 로켓 x%에서 내림 (%' and l.amount = r.payout;

  update public.points_ledger l
  set amount = r.payout - r.bet,
      created_at = r.ended_at,
      reason = case when r.status = 'cashed'
                    then format('양 로켓 x%s에서 내림 (%sP 걸음)', to_char(r.cashed_at, 'FM9990.00'), r.bet)
                    else format('양 로켓 x%s에서 폭발 (%sP 걸음)', to_char(r.crash_at, 'FM9990.00'), r.bet) end
  from public.rocket_rounds r
  where r.ledger_id = l.id and r.status <> 'flying';

  -- 아직 나는 중인 판은 문구만
  update public.points_ledger l
  set reason = format('양 로켓 비행 중 (%sP 걸음)', r.bet)
  from public.rocket_rounds r
  where r.ledger_id = l.id and r.status = 'flying';

  select sum(balance) into v_after from public.users;
  if v_before is distinct from v_after then
    raise exception 'balance mismatch: % -> %', v_before, v_after;
  end if;
end $$;
