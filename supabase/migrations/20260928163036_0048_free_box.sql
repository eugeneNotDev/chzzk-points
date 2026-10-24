-- 무료 뽑기(선물 상자) — 하루 한 번(한국 시간 자정 초기화) 공짜로 열어서 0~300P, 아주 낮은 확률(0.1%)로 1,000P.
-- 미니게임 메뉴의 freebox.html → free-box 함수 → free_box_open(). 결과는 여기서 정하고 화면은 연출만 함.
--
-- 확률(합 100%) — 평균 하루 약 98P:
--   0~50P 25% / 51~100P 35% / 101~150P 22% / 151~200P 11% / 201~300P 6.9% / 1,000P 0.1%
-- 확률표는 화면에 안 보여줌(룰렛 등 다른 미니게임과 같음). 바꾸려면 아래 free_box_open()의 구간만 고치면 됨.

create table if not exists public.free_box_draws (
  channel_id text not null,
  draw_date date not null,            -- 한국 시간 기준 날짜(하루 한 번 판정용)
  points integer not null check (points >= 0),
  created_at timestamptz not null default now(),
  primary key (channel_id, draw_date)
);
create index if not exists free_box_draws_recent_idx on public.free_box_draws (channel_id, draw_date desc);
alter table public.free_box_draws enable row level security;
revoke all on public.free_box_draws from anon, authenticated;

-- 상자 열기. 결과 jsonb — 성공 { points, jackpot, balance } / 실패 { error }: already_opened(오늘 이미 염) / user_not_found(미가입·밴)
-- 실패도 예외 대신 결과로 돌려줌(다른 미니게임 함수들과 같은 방식).
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
    when v_roll < 0.251 then floor(random() * 51)::int          -- 0~50
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
