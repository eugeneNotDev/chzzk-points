-- 0022_title_tiers.sql에서 ranking 뷰를 칭호 배지용으로 다시 만들면서, 0017에서 추가했던
-- "관리자(채널 주인) 계정 제외" 조건을 실수로 빠뜨렸음(그 사이 버전을 기준으로 다시 짜다가
-- 놓침). 그 결과 관리자 계정이 다시 랭킹에 노출되고 있었음 — 이번에 그 조건만 복원함.
-- 나머지 컬럼 구성(tier_title_name/color, shop_title_name)은 0022 그대로 유지.
drop view if exists public.ranking;
create view public.ranking as
select
  u.channel_id,
  case when u.is_public then u.channel_name else '비공개' end as channel_name,
  coalesce(sum(pl.amount), 0) as total_points,
  u.is_public,
  tier.name as tier_title_name,
  tier.color as tier_title_color,
  shop.name as shop_title_name
from users u
left join points_ledger pl on pl.channel_id = u.channel_id
left join lateral (
  select t.name, t.color
  from titles t
  where t.min_points <= u.max_balance_reached and t.min_points < 1000000000
  order by t.min_points desc
  limit 1
) tier on true
left join titles shop on shop.id = u.selected_title_id
where u.banned = false
  and u.channel_id <> '37a1acfaa35d56311bf428dc96142e9f' -- OWNER_CHANNEL_ID (config.ts), 관리자 계정 제외 (0017 참고)
group by u.channel_id, u.channel_name, u.is_public, u.created_at, tier.name, tier.color, shop.name
order by total_points desc, u.created_at asc;

grant select on public.ranking to anon, authenticated;
