-- 요청사항: "계정을 비공개로 설정하면 랭킹에서 이름뿐 아니라 칭호(구간/구매)도 안 보이게".
-- 지금까지는 is_public=false면 channel_name만 "비공개"로 가려지고, 구간 칭호(tier_title_*)와
-- 구매 칭호(shop_title_name)는 그대로 내려가고 있었음 — 이름은 가려놓고 칭호는 그대로 보이면
-- 비공개 설정이 반쪽짜리로 느껴지므로, 비공개일 땐 이 세 컬럼도 전부 null로 내림.
-- 0023에서 복원한 관리자(채널 주인) 계정 제외 조건은 그대로 유지.
drop view if exists public.ranking;
create view public.ranking as
select
  u.channel_id,
  case when u.is_public then u.channel_name else '비공개' end as channel_name,
  coalesce(sum(pl.amount), 0) as total_points,
  u.is_public,
  case when u.is_public then tier.name end as tier_title_name,
  case when u.is_public then tier.color end as tier_title_color,
  case when u.is_public then shop.name end as shop_title_name
from users u
left join points_ledger pl on pl.channel_id = u.channel_id
left join lateral (
  select t.name, t.color from titles t
  where t.min_points <= u.max_balance_reached and t.min_points < 1000000000
  order by t.min_points desc limit 1
) tier on true
left join titles shop on shop.id = u.selected_title_id
where u.banned = false
  and u.channel_id <> '37a1acfaa35d56311bf428dc96142e9f' -- OWNER_CHANNEL_ID (config.ts), 관리자 계정 제외 (0017 참고)
group by u.channel_id, u.channel_name, u.is_public, u.created_at, tier.name, tier.color, shop.name
order by total_points desc, u.created_at asc;
grant select on public.ranking to anon, authenticated;
