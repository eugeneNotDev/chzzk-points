-- 양 로켓: 출발하자마자 터짐(x1.00) 5% → 1%. 줄인 만큼 전 구간에 고르게 — 터질 배수 = 0.99 / (1 - 난수).
--   x배 이상 갈 확률 = 0.99 / x (예전 0.95 / x). 1%는 남겨야 자동 1.01배만 걸어도 무조건 이기는 일이 없음.
--   평균 환급 95% → 99%.
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

  v_x := 0.99 / (1 - random());
  v_crash := case when v_x < 1 then 1.00 else least(200, floor(v_x * 100) / 100) end;

  insert into public.rocket_rounds (channel_id, bet, crash_at, auto_at, ledger_id)
  values (p_channel_id, p_bet, v_crash, v_auto, v_lid)
  returning id into v_id;

  return public.rocket_result(v_id);
end;
$function$;
