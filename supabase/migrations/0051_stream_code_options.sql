-- 방송 코드 옵션 추가 (0047_stream_codes.sql 이어서).
--   1) 지속 시간을 관리자가 정함(분 단위). 비우면 무제한 — expires_at을 'infinity'로 넣어서 직접 종료하거나 선착순이 찰 때까지 유지.
--      (null 대신 infinity를 쓰는 이유: 기존 "expires_at > now()" 비교들이 그대로 맞게 동작함. 화면/오버레이로 보낼 땐
--       함수들이 null로 바꿔서 보냄 — _shared/stream-code.ts의 toStreamCode 참고.)
--   2) 랜덤 포인트 — points_max가 있으면 입력한 사람마다 points~points_max 사이에서 균등하게 따로 뽑음.
--      실제로 받은 포인트는 stream_code_redemptions.points에 남음(포인트 로그에도 그 금액으로 찍힘).

alter table public.stream_codes add column if not exists points_max integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stream_codes_points_max_check') then
    alter table public.stream_codes add constraint stream_codes_points_max_check
      check (points_max is null or (points_max > points and points_max <= 1000000));
  end if;
end $$;

-- 관리자: 코드 만들기(새 버전). p_minutes: 지속 시간(분, null = 무제한), p_points_max: 랜덤 최대(null = 고정 포인트).
-- 실패: invalid_code / invalid_points / invalid_points_max / invalid_max_uses / invalid_minutes
create or replace function public.create_stream_code(
  p_code text, p_points integer, p_max_uses integer, p_minutes integer, p_points_max integer
)
returns jsonb as $$
declare
  v_code text;
  v_row public.stream_codes%rowtype;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i integer;
begin
  if p_points is null or p_points <= 0 or p_points > 1000000 then raise exception 'invalid_points'; end if;
  if p_points_max is not null and (p_points_max <= p_points or p_points_max > 1000000) then raise exception 'invalid_points_max'; end if;
  if p_max_uses is not null and (p_max_uses <= 0 or p_max_uses > 100000) then raise exception 'invalid_max_uses'; end if;
  if p_minutes is not null and (p_minutes <= 0 or p_minutes > 100000) then raise exception 'invalid_minutes'; end if;

  v_code := public.stream_code_normalize(p_code);
  if v_code = '' then
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
  elsif length(v_code) < 2 or length(v_code) > 20 or v_code !~ '^[0-9A-Z가-힣]+$' then
    raise exception 'invalid_code';
  end if;

  -- 진행 중인 코드는 하나만 — 이전 건 종료.
  update public.stream_codes set ended_at = now()
  where ended_at is null and expires_at > now() and (max_uses is null or used_count < max_uses);

  insert into public.stream_codes (code, code_key, points, points_max, max_uses, expires_at)
  values (v_code, v_code, p_points, p_points_max, p_max_uses,
          case when p_minutes is null then 'infinity'::timestamptz else now() + make_interval(mins => p_minutes) end)
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'points', v_row.points, 'pointsMax', v_row.points_max,
                            'maxUses', v_row.max_uses, 'usedCount', v_row.used_count,
                            'createdAt', v_row.created_at,
                            'expiresAt', case when isfinite(v_row.expires_at) then v_row.expires_at end);
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.create_stream_code(text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.create_stream_code(text, integer, integer, integer, integer) to service_role;

-- 관리자: 지금 종료(무제한 코드도 끝낼 수 있게). 실패: not_active
create or replace function public.end_stream_code(p_id bigint)
returns void as $$
begin
  update public.stream_codes set ended_at = now()
  where id = p_id and ended_at is null and expires_at > now();
  if not found then raise exception 'not_active'; end if;
end;
$$ language plpgsql security definer set search_path = public;

-- 시청자: 코드 입력. 랜덤 코드면 이 사람 몫을 따로 뽑음. 결과는 0047과 같음(points = 실제로 받은 포인트).
create or replace function public.redeem_stream_code(p_channel_id text, p_code text)
returns jsonb as $$
declare
  v_key text;
  v_row public.stream_codes%rowtype;
  v_points integer;
  v_balance bigint;
begin
  if not exists (select 1 from public.users where channel_id = p_channel_id and banned = false) then
    return jsonb_build_object('error', 'user_not_found');
  end if;
  if (select count(*) from public.stream_code_failures
      where channel_id = p_channel_id and created_at > now() - interval '10 minutes') >= 10 then
    return jsonb_build_object('error', 'too_many_attempts');
  end if;

  v_key := public.stream_code_normalize(p_code);
  select * into v_row from public.stream_codes
  where code_key = v_key and length(v_key) between 1 and 20
  order by created_at desc limit 1
  for update;

  if not found then
    -- (0047에 있던 하루 지난 실패 기록 정리는 뺌 — 틀린 코드 입력 때만 쌓이는 작은 기록이라 그대로 둬도 됨.)
    insert into public.stream_code_failures (channel_id) values (p_channel_id);
    return jsonb_build_object('error', 'invalid_code');
  end if;
  if exists (select 1 from public.stream_code_redemptions where code_id = v_row.id and channel_id = p_channel_id) then
    return jsonb_build_object('error', 'already_redeemed');
  end if;
  if v_row.ended_at is not null or v_row.expires_at <= now() then
    return jsonb_build_object('error', 'expired');
  end if;
  if v_row.max_uses is not null and v_row.used_count >= v_row.max_uses then
    return jsonb_build_object('error', 'sold_out');
  end if;

  v_points := case when v_row.points_max is null then v_row.points
                   else v_row.points + floor(random() * (v_row.points_max - v_row.points + 1))::int end;

  insert into public.stream_code_redemptions (code_id, channel_id, points) values (v_row.id, p_channel_id, v_points);
  update public.stream_codes set used_count = used_count + 1 where id = v_row.id returning * into v_row;
  insert into public.points_ledger (channel_id, amount, reason)
  values (p_channel_id, v_points, format('방송 코드: %s', v_row.code));
  select balance into v_balance from public.users where channel_id = p_channel_id;

  return jsonb_build_object('ok', true, 'points', v_points, 'rank', v_row.used_count, 'usedCount', v_row.used_count,
                            'maxUses', v_row.max_uses, 'codeId', v_row.id, 'balance', v_balance);
end;
$$ language plpgsql security definer set search_path = public;
