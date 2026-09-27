-- 후원 자동 적립.
--
-- 흐름: 방송 PC에서 돌리는 작은 프로그램(tools/donation-relay)이 치지직 공식 API로 후원 알림을 받아서
-- Edge Function donation-relay로 넘겨줌 → 이 파일의 record_donation()이 판단해서 포인트를 적립함.
--   - 익명이 아니고 1만 치즈 이상 + 사이트 가입자(밴 아님) → 금액의 10% 자동 적립 ("후원 적립: 10,000치즈")
--   - 익명 + 1만 치즈 이상 → 관리자 페이지 "후원 적립" 탭의 익명 목록에 대기(유진님이 리모컨 보고 유저를 골라 적립)
--   - 1만 치즈 미만 / 미가입자 → 적립 없음(기록만 남김)
-- 기준 금액(1만)과 비율(10%)을 바꾸려면 아래 DONATION_MIN_AMOUNT / DONATION_RATE_PERCENT 자리만 고치면 됨.
--
-- 테이블은 전부 서버(service_role) 전용 — 후원 메시지 같은 개인 정보가 있어서 브라우저에선 못 읽음.

-- 1) 유진님(채널 주인) 치지직 토큰 — 후원 알림 세션을 여는 데만 씀. 유진님이 사이트에 로그인할 때마다
--    oauth-callback이 새로 저장하고, 만료되면 donation-relay 함수가 refresh_token으로 갱신함.
--    (refresh_token은 일회용이라 갱신할 때마다 새 값으로 바꿔 저장해야 함 — 치지직 문서 기준 30일 유효.)
create table if not exists public.streamer_tokens (
  channel_id text primary key,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.streamer_tokens enable row level security;
revoke all on public.streamer_tokens from anon, authenticated;

-- 2) 서버 내부 설정값(비밀번호 해시 등). donation_relay_secret_sha256: 방송 PC 프로그램이 보내는 비밀번호의
--    SHA-256 해시 — 원문은 PC의 config.json에만 있고 여기엔 해시만 둠.
create table if not exists public.app_secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-- 3) 후원 기록. event_key는 PC 프로그램이 후원 알림 하나마다 붙이는 고유값 — 같은 알림을 두 번 보내도
--    (재전송 등) 한 번만 처리되게 함.
create table if not exists public.donations (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  donator_channel_id text,            -- 익명이면 null
  donator_nickname text,
  amount integer not null check (amount >= 0),
  donation_type text,                 -- CHAT / VIDEO
  message text,                      -- 익명 후원만 저장(관리자 확인용)
  is_anonymous boolean not null default false,
  -- credited(자동 적립) | anonymous_pending(익명, 관리자 확인 대기) | anonymous_credited(익명, 관리자가 적립)
  -- | dismissed(익명, 관리자가 무시) | below_min(기준 금액 미만) | not_member(미가입자/밴)
  status text not null,
  points integer not null default 0,
  credited_channel_id text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists donations_status_idx on public.donations (status, created_at desc);
alter table public.donations enable row level security;
revoke all on public.donations from anon, authenticated;

-- 적립 포인트 계산(기준 금액 미만이면 0). DONATION_MIN_AMOUNT = 10000, DONATION_RATE_PERCENT = 10
create or replace function public.donation_points(p_amount integer)
returns integer as $$
  select case when p_amount >= 10000 then (p_amount * 10) / 100 else 0 end;
$$ language sql immutable;

-- 후원 한 건 처리(idempotent). 결과: { status, points, channelId?, duplicate? }
create or replace function public.record_donation(
  p_event_key text,
  p_donator_channel_id text,
  p_donator_nickname text,
  p_amount integer,
  p_donation_type text,
  p_message text
) returns jsonb as $$
declare
  v_existing public.donations%rowtype;
  v_anonymous boolean;
  v_points integer;
  v_status text;
  v_member boolean;
begin
  if p_event_key is null or length(p_event_key) = 0 or length(p_event_key) > 100 then
    raise exception 'invalid_event_key';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 100000000 then
    raise exception 'invalid_amount';
  end if;

  select * into v_existing from public.donations where event_key = p_event_key;
  if found then
    return jsonb_build_object('status', v_existing.status, 'points', v_existing.points, 'duplicate', true);
  end if;

  v_anonymous := p_donator_channel_id is null or p_donator_channel_id = '' or p_donator_channel_id = 'anonymous';
  v_points := public.donation_points(p_amount);

  if v_points = 0 then
    v_status := 'below_min';
  elsif v_anonymous then
    v_status := 'anonymous_pending';
  else
    select exists (select 1 from public.users where channel_id = p_donator_channel_id and banned = false) into v_member;
    v_status := case when v_member then 'credited' else 'not_member' end;
  end if;

  insert into public.donations (event_key, donator_channel_id, donator_nickname, amount, donation_type, message,
                                is_anonymous, status, points, credited_channel_id, resolved_at)
  values (p_event_key, case when v_anonymous then null else p_donator_channel_id end,
          case when v_anonymous then null else left(p_donator_nickname, 100) end,
          p_amount, left(p_donation_type, 20),
          -- 메시지는 익명 후원만 남김(관리자가 누군지 찾을 때 참고용) — 나머지는 적립에 필요 없어서 안 남김.
          case when v_status = 'anonymous_pending' then left(p_message, 500) end, v_anonymous, v_status,
          case when v_status = 'credited' then v_points else 0 end,
          case when v_status = 'credited' then p_donator_channel_id end,
          case when v_status = 'credited' then now() end)
  on conflict (event_key) do nothing;
  if not found then
    -- 동시에 같은 알림이 두 번 들어온 경우 — 먼저 들어온 쪽이 처리함.
    select * into v_existing from public.donations where event_key = p_event_key;
    return jsonb_build_object('status', v_existing.status, 'points', v_existing.points, 'duplicate', true);
  end if;

  if v_status = 'credited' then
    insert into public.points_ledger (channel_id, amount, reason)
    values (p_donator_channel_id, v_points, format('후원 적립: %s치즈', to_char(p_amount, 'FM999,999,999')));
  end if;

  return jsonb_build_object('status', v_status, 'points', case when v_status = 'credited' then v_points else 0 end,
                            'channelId', case when v_status = 'credited' then p_donator_channel_id end);
end;
$$ language plpgsql security definer set search_path = public;

-- 익명 후원을 관리자가 유저에게 연결해서 적립. 결과: { points }
-- 실패: not_found / not_pending / user_not_found
create or replace function public.assign_anonymous_donation(p_donation_id bigint, p_channel_id text)
returns jsonb as $$
declare
  v_row public.donations%rowtype;
  v_points integer;
begin
  select * into v_row from public.donations where id = p_donation_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_row.status <> 'anonymous_pending' then raise exception 'not_pending'; end if;
  if not exists (select 1 from public.users where channel_id = p_channel_id and banned = false) then
    raise exception 'user_not_found';
  end if;

  v_points := public.donation_points(v_row.amount);
  insert into public.points_ledger (channel_id, amount, reason)
  values (p_channel_id, v_points, format('익명 후원 적립: %s치즈', to_char(v_row.amount, 'FM999,999,999')));

  update public.donations
  set status = 'anonymous_credited', points = v_points, credited_channel_id = p_channel_id, resolved_at = now()
  where id = p_donation_id;

  return jsonb_build_object('points', v_points);
end;
$$ language plpgsql security definer set search_path = public;

-- 익명 후원을 적립 없이 목록에서 치움(누군지 모르거나 미가입자일 때).
create or replace function public.dismiss_anonymous_donation(p_donation_id bigint)
returns void as $$
begin
  update public.donations set status = 'dismissed', resolved_at = now()
  where id = p_donation_id and status = 'anonymous_pending';
  if not found then raise exception 'not_pending'; end if;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.donation_points(integer) from public, anon, authenticated;
revoke execute on function public.record_donation(text, text, text, integer, text, text) from public, anon, authenticated;
revoke execute on function public.assign_anonymous_donation(bigint, text) from public, anon, authenticated;
revoke execute on function public.dismiss_anonymous_donation(bigint) from public, anon, authenticated;
grant execute on function public.donation_points(integer) to service_role;
grant execute on function public.record_donation(text, text, text, integer, text, text) to service_role;
grant execute on function public.assign_anonymous_donation(bigint, text) to service_role;
grant execute on function public.dismiss_anonymous_donation(bigint) to service_role;
