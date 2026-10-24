-- 미션 후원 · 구독권 선물도 후원 자동 적립에 포함.
--
-- 치지직 공식 API(후원 이벤트)는 일반 후원(CHAT/VIDEO)만 보내줘서, 미션 후원과 구독권 선물은 방송 PC 프로그램이
-- 치지직 채팅창(시청자가 보는 것과 같은 읽기 전용 연결)에서 따로 받아 donation-relay로 넘김.
--
-- 미션 후원: 미션을 걸 때(또는 그룹 미션에 참여할 때) mission_pending으로 기록만 해두고,
--   스트리머가 "미션 성공"을 누르면(COMPLETED + success) 그때 일반 후원과 같은 규칙(1만 치즈 이상 10%)으로 적립.
--   실패·거절이면 치즈가 환불되니 mission_failed로 끝. 결과가 참여 기록보다 먼저 와도 되게 결과를 따로 저장해 둠.
-- 구독권 선물: 선물한 개수 × 1장 가격을 후원 금액으로 보고 record_donation(일반 후원과 같은 함수)으로 처리.

alter table public.donations add column if not exists mission_id text;
create index if not exists donations_mission_idx on public.donations (mission_id) where mission_id is not null;

create table if not exists public.donation_missions (
  mission_id text primary key,
  success boolean not null,
  resolved_at timestamptz not null default now()
);
alter table public.donation_missions enable row level security;

-- 이미 들어 있는 후원 한 줄(mission_pending)을 일반 후원 규칙대로 정산.
create or replace function public.settle_donation_row(p_id bigint, p_success boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.donations%rowtype;
  v_points integer;
  v_status text;
  v_member boolean;
begin
  select * into r from public.donations where id = p_id and status = 'mission_pending' for update;
  if not found then return; end if;

  if not p_success then
    update public.donations set status = 'mission_failed', message = null, resolved_at = now() where id = p_id;
    return;
  end if;

  v_points := public.donation_points(r.amount);
  if v_points = 0 then
    v_status := 'below_min';
  elsif r.is_anonymous then
    v_status := 'anonymous_pending';
  else
    select exists (select 1 from public.users where channel_id = r.donator_channel_id and banned = false) into v_member;
    v_status := case when v_member then 'credited' else 'not_member' end;
  end if;

  update public.donations
     set status = v_status,
         points = case when v_status = 'credited' then v_points else 0 end,
         credited_channel_id = case when v_status = 'credited' then r.donator_channel_id end,
         message = case when v_status = 'anonymous_pending' then r.message end,
         resolved_at = case when v_status = 'credited' then now() end
   where id = p_id;

  if v_status = 'credited' then
    insert into public.points_ledger (channel_id, amount, reason)
    values (r.donator_channel_id, v_points, format('미션 후원 적립: %s치즈', to_char(r.amount, 'FM999,999,999')));
  end if;
end;
$$;
revoke all on function public.settle_donation_row(bigint, boolean) from public, anon, authenticated;

-- 미션 참여(미션 건 사람 / 그룹 미션 참여자) 기록. 이미 결과가 나온 미션이면 바로 정산.
create or replace function public.record_mission_part(
  p_event_key text, p_mission_id text, p_donator_channel_id text, p_donator_nickname text,
  p_amount integer, p_donation_type text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_anonymous boolean;
  v_result public.donation_missions%rowtype;
  v_row public.donations%rowtype;
begin
  if p_event_key is null or length(p_event_key) = 0 or length(p_event_key) > 100 then raise exception 'invalid_event_key'; end if;
  if p_mission_id is null or length(p_mission_id) = 0 or length(p_mission_id) > 100 then raise exception 'invalid_mission_id'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 100000000 then raise exception 'invalid_amount'; end if;

  v_anonymous := p_donator_channel_id is null or p_donator_channel_id = '' or p_donator_channel_id = 'anonymous';

  insert into public.donations (event_key, mission_id, donator_channel_id, donator_nickname, amount, donation_type,
                                message, is_anonymous, status, points)
  values (p_event_key, p_mission_id,
          case when v_anonymous then null else p_donator_channel_id end,
          case when v_anonymous then null else left(p_donator_nickname, 100) end,
          p_amount, left(p_donation_type, 20), left(p_message, 500), v_anonymous, 'mission_pending', 0)
  on conflict (event_key) do nothing
  returning id into v_id;

  if v_id is not null then
    select * into v_result from public.donation_missions where mission_id = p_mission_id;
    if found then perform public.settle_donation_row(v_id, v_result.success); end if;
  end if;

  select * into v_row from public.donations where event_key = p_event_key;
  return jsonb_build_object('status', v_row.status, 'points', v_row.points, 'duplicate', v_id is null);
end;
$$;
revoke all on function public.record_mission_part(text, text, text, text, integer, text, text) from public, anon, authenticated;

-- 미션 결과(성공/실패). 같은 미션 결과가 여러 번 와도 한 번만 처리.
create or replace function public.resolve_mission(p_mission_id text, p_success boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted text;
  v_id bigint;
  v_credited integer := 0;
  v_points integer := 0;
begin
  if p_mission_id is null or length(p_mission_id) = 0 or length(p_mission_id) > 100 then raise exception 'invalid_mission_id'; end if;

  insert into public.donation_missions (mission_id, success) values (p_mission_id, p_success)
  on conflict (mission_id) do nothing
  returning mission_id into v_inserted;
  if v_inserted is null then
    return jsonb_build_object('status', 'already_resolved');
  end if;

  for v_id in select id from public.donations where mission_id = p_mission_id and status = 'mission_pending' order by id loop
    perform public.settle_donation_row(v_id, p_success);
  end loop;

  select count(*) filter (where status = 'credited'), coalesce(sum(points), 0)
    into v_credited, v_points
    from public.donations where mission_id = p_mission_id;
  return jsonb_build_object('status', case when p_success then 'mission_success' else 'mission_failed' end,
                            'credited', v_credited, 'points', v_points);
end;
$$;
revoke all on function public.resolve_mission(text, boolean) from public, anon, authenticated;

-- 일반 후원 처리 함수 — 구독권 선물(SUB_GIFT)이면 포인트 내역 문구만 다르게. 나머지는 0046 그대로.
create or replace function public.record_donation(p_event_key text, p_donator_channel_id text, p_donator_nickname text,
                                                  p_amount integer, p_donation_type text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
          case when v_status = 'anonymous_pending' then left(p_message, 500) end, v_anonymous, v_status,
          case when v_status = 'credited' then v_points else 0 end,
          case when v_status = 'credited' then p_donator_channel_id end,
          case when v_status = 'credited' then now() end)
  on conflict (event_key) do nothing;
  if not found then
    select * into v_existing from public.donations where event_key = p_event_key;
    return jsonb_build_object('status', v_existing.status, 'points', v_existing.points, 'duplicate', true);
  end if;

  if v_status = 'credited' then
    insert into public.points_ledger (channel_id, amount, reason)
    values (p_donator_channel_id, v_points,
            case when p_donation_type = 'SUB_GIFT'
                 then format('구독권 선물 적립: %s원 상당', to_char(p_amount, 'FM999,999,999'))
                 else format('후원 적립: %s치즈', to_char(p_amount, 'FM999,999,999')) end);
  end if;

  return jsonb_build_object('status', v_status, 'points', case when v_status = 'credited' then v_points else 0 end,
                            'channelId', case when v_status = 'credited' then p_donator_channel_id end);
end;
$$;
