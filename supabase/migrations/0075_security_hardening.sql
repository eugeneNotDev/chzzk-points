-- 보안 점검(2026-10-20) 후속 — 연타·대량 호출로 포인트를 더 받거나 저장소·DB를 낭비하는 구멍 막기.
--  1) 호출 횟수 제한(rate_limit_hit): 키별로 "N초 동안 M번까지" — 함수들이 로그인 계정·IP 단위로 씀
--  2) 게시판 사진: 업로드 주소를 받은 사람만 그 사진을 글에 붙일 수 있게(board_uploads), 같은 사진을 두 글에 못 붙이게
--  3) 게시판 활동 보상: 동시에 여러 번 보내도 하루 한도를 넘지 않게 한 번에 잠그고 처리(board_grant_activity)
--  4) 상점: 동시 구매로 한정 수량 초과·쿨타임 무시가 안 되게(shop_purchase_claim / shop_purchase_release)
--  5) 포인트 내역 계산(ledger_balance_after): 내 기록만 계산하게
-- 전부 서버 함수(service_role) 전용 — anon/authenticated는 실행 못 함.

-- 1) 호출 횟수 제한 ----------------------------------------------------------
create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;

create or replace function public.rate_limit_hit(p_key text, p_window_sec integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_sec) * p_window_sec);
  v_hits integer;
begin
  insert into public.rate_limits (key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  -- 가끔 지난 기록 정리(하루 지난 것)
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end;
$$;

-- 2) 게시판 사진 업로드 주인 ---------------------------------------------------
create table if not exists public.board_uploads (
  path text primary key,
  channel_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists board_uploads_owner_idx on public.board_uploads (channel_id, created_at);
alter table public.board_uploads enable row level security;

-- 이미 글에 붙어 있는 사진은 원래 글쓴이 것으로 등록(기존 글 수정 때 계속 쓸 수 있게)
insert into public.board_uploads (path, channel_id, created_at)
select i.storage_path, p.channel_id, coalesce(p.created_at, now())
from public.board_images i join public.board_posts p on p.id = i.post_id
on conflict (path) do nothing;

-- 같은 사진 파일을 두 글에 못 붙이게(남의 사진을 내 글에 붙였다 지워서 같이 지우는 것 방지)
create unique index if not exists board_images_storage_path_key on public.board_images (storage_path);

-- 게시판 사진 저장소는 이미지 파일만(크기 5MB는 이미 설정됨)
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
where id = 'board-images';

-- 3) 게시판 활동 보상 — 사람별로 잠그고 한도 확인 + 기록 + 포인트를 한 번에 ----------------
-- 돌려주는 값: 'ok' | 'daily_limit' | 'per_post_limit' | 'duplicate'
create or replace function public.board_grant_activity(
  p_channel text, p_kind text, p_target bigint, p_post bigint, p_kst_date date,
  p_amount integer, p_daily integer, p_per_post integer, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_on_post integer;
begin
  perform pg_advisory_xact_lock(hashtext('board_activity:' || p_channel));
  select count(*) into v_used from public.board_activity_rewards
   where channel_id = p_channel and kind = p_kind and kst_date = p_kst_date;
  if v_used >= p_daily then return jsonb_build_object('reason', 'daily_limit'); end if;
  if p_kind = 'comment' and p_post is not null and p_per_post is not null then
    select count(*) into v_on_post from public.board_activity_rewards
     where channel_id = p_channel and kind = 'comment' and post_id = p_post;
    if v_on_post >= p_per_post then return jsonb_build_object('reason', 'per_post_limit'); end if;
  end if;
  begin
    insert into public.board_activity_rewards (channel_id, kind, target_id, post_id, kst_date, amount)
    values (p_channel, p_kind, p_target, p_post, p_kst_date, p_amount);
  exception when unique_violation then
    return jsonb_build_object('reason', 'duplicate');
  end;
  insert into public.points_ledger (channel_id, amount, reason) values (p_channel, p_amount, p_reason);
  return jsonb_build_object('reason', 'ok', 'used', v_used + 1);
end;
$$;

-- 4) 상점 — 같은 사람·같은 상품은 한 번에 하나씩 처리, 한정 수량은 자리 먼저 잡고 결제 ------------
create table if not exists public.shop_purchase_claims (
  id bigint generated always as identity primary key,
  channel_id text not null,
  item_id text not null,
  claimed_at timestamptz not null default now()
);
create index if not exists shop_purchase_claims_idx on public.shop_purchase_claims (channel_id, item_id, claimed_at desc);
alter table public.shop_purchase_claims enable row level security;

-- 돌려주는 값: { ok: true, claimId } | { error: 'cooldown', retryAfterSeconds } | { error: 'sold_out' }
create or replace function public.shop_purchase_claim(p_channel text, p_item text, p_cooldown_sec integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz;
  v_left numeric;
  v_claim bigint;
  v_limited boolean;
begin
  perform pg_advisory_xact_lock(hashtext('shop:' || p_channel || ':' || p_item));
  if coalesce(p_cooldown_sec, 0) > 0 then
    select max(claimed_at) into v_last from public.shop_purchase_claims
     where channel_id = p_channel and item_id = p_item;
    if v_last is not null then
      v_left := p_cooldown_sec - extract(epoch from (now() - v_last));
      if v_left > 0 then return jsonb_build_object('error', 'cooldown', 'retryAfterSeconds', ceil(v_left)); end if;
    end if;
  end if;
  select stock_limit is not null into v_limited from public.shop_items where id = p_item;
  if v_limited then
    update public.shop_items set sold_count = sold_count + 1
     where id = p_item and sold_count < stock_limit;
    if not found then return jsonb_build_object('error', 'sold_out'); end if;
  end if;
  insert into public.shop_purchase_claims (channel_id, item_id) values (p_channel, p_item) returning id into v_claim;
  return jsonb_build_object('ok', true, 'claimId', v_claim);
end;
$$;

-- 결제가 실패하면 잡아둔 자리(쿨타임·수량)를 되돌림
create or replace function public.shop_purchase_release(p_claim bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item text;
begin
  delete from public.shop_purchase_claims where id = p_claim returning item_id into v_item;
  if v_item is not null then
    update public.shop_items set sold_count = greatest(0, sold_count - 1)
     where id = v_item and stock_limit is not null;
  end if;
end;
$$;

-- 5) 포인트 내역의 "그때 잔액" — 요청한 사람 기록만 계산(관리자는 p_channel 없이 전체) ----------------
drop function if exists public.ledger_balance_after(bigint[]);
create or replace function public.ledger_balance_after(p_ids bigint[], p_channel text default null)
returns table(id bigint, channel_id text, balance_after bigint)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.channel_id,
         (select coalesce(sum(l2.amount), 0)
          from public.points_ledger l2
          where l2.channel_id = l.channel_id
            and (l2.created_at < l.created_at or (l2.created_at = l.created_at and l2.id <= l.id)))::bigint
  from public.points_ledger l
  where l.id = any(p_ids[1:100])
    and (p_channel is null or l.channel_id = p_channel);
$$;

-- 서버 함수 전용
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.board_grant_activity(text, text, bigint, bigint, date, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function public.shop_purchase_claim(text, text, integer) from public, anon, authenticated;
revoke all on function public.shop_purchase_release(bigint) from public, anon, authenticated;
revoke all on function public.ledger_balance_after(bigint[], text) from public, anon, authenticated;
revoke all on public.rate_limits, public.board_uploads, public.shop_purchase_claims from anon, authenticated;
