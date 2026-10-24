-- 특수 칭호 — 랭킹에서 장착 칭호 "앞"에 항상 붙는 칭호(유저가 장착/해제하는 게 아님).
--  1) 지난달 1위: 매달 1일 0시(KST)에 지난달 마지막 순간의 보유 포인트 1등에게 자동으로 붙음(한 명만).
--     저장해두는 값 없이 매번 계산함 — 지금 잔액에서 이번 달에 쌓인 points_ledger 합계를 빼면 지난달 말 잔액이
--     나옴(전 유저에서 잔액 = 기록 합계라 정확함). 2026-11-01 0시(KST) 전에는 아무에게도 안 붙음(다음 달부터 적용).
--  2) 관리자 특수 칭호(예: 도박중독): 관리자가 유저 상세 모달에서 이름·꾸미기를 정해 지급/회수 — user_special_titles.
-- 비공개 유저는 기존 규칙대로 공개 랭킹에서 칭호를 가림(관리자 랭킹은 그대로 보임).

create table if not exists public.user_special_titles (
  id bigint generated always as identity primary key,
  channel_id text not null,
  name text not null check (char_length(name) between 1 and 20),
  color text not null,
  granted_at timestamptz not null default now()
);
create index if not exists user_special_titles_channel_idx on public.user_special_titles (channel_id);
alter table public.user_special_titles enable row level security;
revoke all on public.user_special_titles from anon, authenticated;

-- 지난달 1위 channel_id (없으면 null). 순서/대상은 public.ranking과 같음(밴·관리자 계정 제외, 동점이면 먼저 가입한 사람).
create or replace function public.last_month_champion()
returns text as $$
  with b as (
    select (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as m
  )
  select u.channel_id
  from public.users u
  cross join b
  left join lateral (
    select coalesce(sum(l.amount), 0) as s
    from public.points_ledger l
    where l.channel_id = u.channel_id and l.created_at >= b.m
  ) x on true
  where now() >= timestamptz '2026-11-01 00:00:00+09'
    and u.banned = false
    and u.channel_id <> '37a1acfaa35d56311bf428dc96142e9f' -- OWNER_CHANNEL_ID (config.ts)
    and (u.balance - x.s) > 0
  order by (u.balance - x.s) desc, u.created_at asc
  limit 1;
$$ language sql stable security definer set search_path = public;

-- 유저별 특수 칭호 목록(앞에서부터 표시할 순서: 지난달 1위 → 관리자 지급 순).
create or replace function public.ranking_special_titles()
returns table (channel_id text, titles jsonb) as $$
  with items as (
    select c.cid as channel_id, 0 as ord, 0::bigint as sid, '지난달 1위'::text as name, 'shine-crown-d4af37'::text as color
    from (select public.last_month_champion() as cid) c
    where c.cid is not null
    union all
    select s.channel_id, 1, s.id, s.name, s.color from public.user_special_titles s
  )
  select i.channel_id, jsonb_agg(jsonb_build_object('name', i.name, 'color', i.color) order by i.ord, i.sid)
  from items i
  group by i.channel_id;
$$ language sql stable security definer set search_path = public;
revoke all on function public.last_month_champion() from public, anon, authenticated;
revoke all on function public.ranking_special_titles() from public, anon, authenticated;
grant execute on function public.last_month_champion() to service_role;
grant execute on function public.ranking_special_titles() to service_role;

-- 공개 랭킹 뷰에 special_titles 열 추가(맨 끝). 나머지는 기존 정의 그대로.
-- 뷰 안에서 위 함수를 부르면 anon이 실행 권한이 없어 막히고(권한은 호출한 사람 기준), 함수를 anon에 열면 비공개 유저의
-- channel_id→칭호가 그대로 노출됨 — 그래서 뷰 안에 같은 계산을 CTE로 직접 넣음(함수는 관리자 랭킹 함수용으로만 남김).
create or replace view public.ranking as
 WITH champ AS (
   SELECT u2.channel_id AS cid
   FROM users u2
   CROSS JOIN (SELECT (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') AS m) b
   LEFT JOIN LATERAL (
     SELECT COALESCE(sum(l.amount), 0) AS s
     FROM points_ledger l
     WHERE l.channel_id = u2.channel_id AND l.created_at >= b.m
   ) x ON true
   WHERE now() >= timestamptz '2026-11-01 00:00:00+09'
     AND u2.banned = false
     AND u2.channel_id <> '37a1acfaa35d56311bf428dc96142e9f'
     AND (u2.balance - x.s) > 0
   ORDER BY (u2.balance - x.s) DESC, u2.created_at ASC
   LIMIT 1
 ), sp AS (
   SELECT i.channel_id,
          jsonb_agg(jsonb_build_object('name', i.name, 'color', i.color) ORDER BY i.ord, i.sid) AS titles
   FROM (
     SELECT c.cid AS channel_id, 0 AS ord, 0::bigint AS sid, '지난달 1위'::text AS name, 'shine-crown-d4af37'::text AS color FROM champ c
     UNION ALL
     SELECT s.channel_id, 1, s.id, s.name, s.color FROM user_special_titles s
   ) i
   GROUP BY i.channel_id
 )
 SELECT
        CASE WHEN u.is_public THEN u.channel_id ELSE u.rank_key::text END AS channel_id,
        CASE WHEN u.is_public THEN u.channel_name ELSE '비공개'::text END AS channel_name,
    u.balance AS total_points,
    u.is_public,
        CASE WHEN u.is_public THEN tier.name ELSE NULL::text END AS tier_title_name,
        CASE WHEN u.is_public THEN tier.color ELSE NULL::text END AS tier_title_color,
        CASE WHEN u.is_public THEN shop.name ELSE NULL::text END AS shop_title_name,
        CASE WHEN u.is_public THEN shop.color ELSE NULL::text END AS shop_title_color,
        CASE WHEN u.is_public THEN sp.titles ELSE NULL::jsonb END AS special_titles
   FROM users u
     LEFT JOIN LATERAL ( SELECT t.name,
            t.color
           FROM titles t
          WHERE t.kind = 'tier'::text AND t.min_points <= u.max_balance_reached
          ORDER BY t.min_points DESC
         LIMIT 1) tier ON true
     LEFT JOIN titles shop ON shop.id = u.selected_title_id
     LEFT JOIN sp ON sp.channel_id = u.channel_id
  WHERE u.banned = false AND u.channel_id <> '37a1acfaa35d56311bf428dc96142e9f'::text
  ORDER BY u.balance DESC, u.created_at;
