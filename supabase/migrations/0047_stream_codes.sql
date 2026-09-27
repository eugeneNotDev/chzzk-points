-- 방송 코드(쿠폰) — 방송 중에 유진님이 코드를 뿌리면, 시청자가 출석체크 페이지에서 10분 안에 입력해서 포인트를 받음.
-- 다시보기로 코드를 보고 나중에 입력하는 걸 막으려고 유효 시간은 10분 고정. 한 사람은 코드 하나에 한 번만.
-- 선착순 인원(max_uses)을 정하면 그 인원이 차는 순간 마감. 진행 중인 코드는 한 번에 하나만(새로 만들면 이전 건 종료).
--
-- 흐름: 관리자 페이지 "방송 코드" 탭 → admin-stream-codes 함수 → create_stream_code()
--       시청자 출석체크 페이지 → stream-code 함수 → redeem_stream_code()
--       오버레이(overlay.html?key=...)는 stream-code 함수 GET으로 지금 코드를 받아오고, 이후 변화(새 코드/인원/종료)는
--       Realtime broadcast(채널 이름에 오버레이 키가 들어감)로 받음. 코드 자체는 DB에서 브라우저가 직접 못 읽음 —
--       overlay.html이 공개 파일이라, 키 없이 누구나 열어서 방송을 안 보고 코드를 알아내는 걸 막기 위함.
--
-- 테이블은 전부 서버(service_role) 전용.

create table if not exists public.stream_codes (
  id bigint generated always as identity primary key,
  code text not null,                 -- 화면 표시용(대문자로 정리된 값)
  code_key text not null,             -- 비교용(대문자, 공백 제거) — 시청자가 소문자/띄어쓰기로 쳐도 맞게
  points integer not null check (points > 0 and points <= 1000000),
  max_uses integer check (max_uses is null or (max_uses > 0 and max_uses <= 100000)),  -- null = 무제한
  used_count integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz                -- 관리자가 "지금 종료"했거나 새 코드를 만들어서 끝난 시각
);
create index if not exists stream_codes_key_idx on public.stream_codes (code_key, created_at desc);
create index if not exists stream_codes_created_idx on public.stream_codes (created_at desc);
alter table public.stream_codes enable row level security;
revoke all on public.stream_codes from anon, authenticated;

create table if not exists public.stream_code_redemptions (
  code_id bigint not null references public.stream_codes(id) on delete cascade,
  channel_id text not null,
  points integer not null,
  created_at timestamptz not null default now(),
  primary key (code_id, channel_id)
);
alter table public.stream_code_redemptions enable row level security;
revoke all on public.stream_code_redemptions from anon, authenticated;

-- 틀린 코드 입력 기록 — 랜덤 코드를 마구 넣어보는 걸 막으려고 10분에 10번까지만 허용.
create table if not exists public.stream_code_failures (
  id bigint generated always as identity primary key,
  channel_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists stream_code_failures_idx on public.stream_code_failures (channel_id, created_at desc);
alter table public.stream_code_failures enable row level security;
revoke all on public.stream_code_failures from anon, authenticated;

-- 코드 정리: 앞뒤/중간 공백 제거 + 대문자.
create or replace function public.stream_code_normalize(p_code text)
returns text as $$
  select upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
$$ language sql immutable set search_path = public;

-- 관리자: 코드 만들기. p_code가 비었으면 랜덤 6자리(헷갈리는 0/O/1/I 제외). 진행 중인 코드가 있으면 먼저 종료함.
-- 실패: invalid_code(형식) / invalid_points / invalid_max_uses
create or replace function public.create_stream_code(p_code text, p_points integer, p_max_uses integer)
returns jsonb as $$
declare
  v_code text;
  v_row public.stream_codes%rowtype;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i integer;
begin
  if p_points is null or p_points <= 0 or p_points > 1000000 then raise exception 'invalid_points'; end if;
  if p_max_uses is not null and (p_max_uses <= 0 or p_max_uses > 100000) then raise exception 'invalid_max_uses'; end if;

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

  insert into public.stream_codes (code, code_key, points, max_uses, expires_at)
  values (v_code, v_code, p_points, p_max_uses, now() + interval '10 minutes')
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'points', v_row.points, 'maxUses', v_row.max_uses,
                            'usedCount', v_row.used_count, 'createdAt', v_row.created_at, 'expiresAt', v_row.expires_at);
end;
$$ language plpgsql security definer set search_path = public;

-- 관리자: 지금 종료. 실패: not_active
create or replace function public.end_stream_code(p_id bigint)
returns void as $$
begin
  update public.stream_codes set ended_at = now()
  where id = p_id and ended_at is null and expires_at > now();
  if not found then raise exception 'not_active'; end if;
end;
$$ language plpgsql security definer set search_path = public;

-- 시청자: 코드 입력. 결과 jsonb — 성공 { ok, points, rank, usedCount, maxUses, codeId, balance }
-- 실패 { error }: invalid_code(없는 코드) / expired(시간 지남·종료) / sold_out(선착순 마감) / already_redeemed
--                / too_many_attempts(10분에 10번 넘게 틀림) / user_not_found(미가입·밴)
-- 실패도 예외 대신 결과로 돌려줌 — 틀린 입력 기록(stream_code_failures)이 롤백되지 않게.
create or replace function public.redeem_stream_code(p_channel_id text, p_code text)
returns jsonb as $$
declare
  v_key text;
  v_row public.stream_codes%rowtype;
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
    insert into public.stream_code_failures (channel_id) values (p_channel_id);
    delete from public.stream_code_failures where created_at < now() - interval '1 day';
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

  insert into public.stream_code_redemptions (code_id, channel_id, points) values (v_row.id, p_channel_id, v_row.points);
  update public.stream_codes set used_count = used_count + 1 where id = v_row.id returning * into v_row;
  insert into public.points_ledger (channel_id, amount, reason)
  values (p_channel_id, v_row.points, format('방송 코드: %s', v_row.code));
  select balance into v_balance from public.users where channel_id = p_channel_id;

  return jsonb_build_object('ok', true, 'points', v_row.points, 'rank', v_row.used_count, 'usedCount', v_row.used_count,
                            'maxUses', v_row.max_uses, 'codeId', v_row.id, 'balance', v_balance);
end;
$$ language plpgsql security definer set search_path = public;

-- 오버레이 키(overlay.html?key=...) — 방송 코드를 오버레이에 띄울 때만 씀. 관리자 페이지에서 주소를 복사할 수 있음.
insert into public.app_secrets (name, value)
values ('overlay_key', replace(gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

revoke execute on function public.stream_code_normalize(text) from public, anon, authenticated;
revoke execute on function public.create_stream_code(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.end_stream_code(bigint) from public, anon, authenticated;
revoke execute on function public.redeem_stream_code(text, text) from public, anon, authenticated;
grant execute on function public.stream_code_normalize(text) to service_role;
grant execute on function public.create_stream_code(text, integer, integer) to service_role;
grant execute on function public.end_stream_code(bigint) to service_role;
grant execute on function public.redeem_stream_code(text, text) to service_role;
