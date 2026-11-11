-- 무료 뽑기: 구간별 확률(100~150P 82% 등) → 100~300P 사이 완전 랜덤(모든 금액 같은 확률). 황금 상자 1,000P 0.1%는 그대로.
--   평균 하루 약 140P → 약 200P
create or replace function public.free_box_open(p_channel_id text)
returns jsonb as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_points integer;
  v_balance bigint;
begin
  if not exists (select 1 from public.users where channel_id = p_channel_id and banned = false) then
    return jsonb_build_object('error', 'user_not_found');
  end if;
  if exists (select 1 from public.free_box_draws where channel_id = p_channel_id and draw_date = v_today) then
    return jsonb_build_object('error', 'already_opened');
  end if;

  v_points := case
    when random() < 0.001 then 1000
    else 100 + floor(random() * 201)::int    -- 100~300 균등
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
