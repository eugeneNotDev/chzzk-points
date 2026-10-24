-- 무료 뽑기 최소 포인트 0P → 10P (빈 상자 없앰). 나머지 구간/확률은 0048 그대로.
--   10~50P 25% / 51~100P 35% / 101~150P 22% / 151~200P 11% / 201~300P 6.9% / 1,000P 0.1% — 평균 하루 약 99P

create or replace function public.free_box_open(p_channel_id text)
returns jsonb as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_roll double precision := random();
  v_points integer;
  v_balance bigint;
begin
  if not exists (select 1 from public.users where channel_id = p_channel_id and banned = false) then
    return jsonb_build_object('error', 'user_not_found');
  end if;
  if exists (select 1 from public.free_box_draws where channel_id = p_channel_id and draw_date = v_today) then
    return jsonb_build_object('error', 'already_opened');
  end if;

  -- 구간 뽑기(누적 확률) → 그 구간 안에서 균등하게 한 값.
  v_points := case
    when v_roll < 0.001 then 1000
    when v_roll < 0.251 then 10 + floor(random() * 41)::int     -- 10~50
    when v_roll < 0.601 then 51 + floor(random() * 50)::int     -- 51~100
    when v_roll < 0.821 then 101 + floor(random() * 50)::int    -- 101~150
    when v_roll < 0.931 then 151 + floor(random() * 50)::int    -- 151~200
    else 201 + floor(random() * 100)::int                       -- 201~300
  end;

  insert into public.free_box_draws (channel_id, draw_date, points) values (p_channel_id, v_today, v_points)
  on conflict (channel_id, draw_date) do nothing;
  if not found then
    -- 버튼 연타 등으로 동시에 두 번 들어온 경우 — 먼저 들어온 쪽만 인정.
    return jsonb_build_object('error', 'already_opened');
  end if;

  if v_points > 0 then
    insert into public.points_ledger (channel_id, amount, reason) values (p_channel_id, v_points, '무료 뽑기');
  end if;
  select balance into v_balance from public.users where channel_id = p_channel_id;

  return jsonb_build_object('points', v_points, 'jackpot', v_points >= 1000, 'balance', v_balance);
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.free_box_open(text) from public, anon, authenticated;
grant execute on function public.free_box_open(text) to service_role;
