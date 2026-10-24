-- 포인트 달성 칭호(기존 칭호1~5)를 브론즈/실버/골드/플래티넘/다이아로 바꾸고, 장착 방식도
-- 자동으로 전환함.
--
-- 예전엔 장착 칭호 슬롯이 하나뿐이라 포인트 달성 칭호와 상점 구매 칭호가 같은 자리를 놓고
-- 경쟁했음(마이페이지에서 둘 중 하나만 골라서 장착). 이제 둘을 완전히 분리함:
--   - 포인트 달성 칭호(브론즈~다이아): users.max_balance_reached만 보고 조회 시점에 그때그때
--     자동으로 정해짐 — 따로 저장 안 하고 랭킹 뷰/me 함수가 매번 계산함. 유저가 직접
--     장착/해제하는 개념 자체가 없어짐(늘 최고 달성 구간이 그대로 붙음).
--   - 상점 구매 칭호: 기존 users.selected_title_id 컬럼을 그대로 씀. 이제부터는 오직 구매
--     칭호만 여기 들어갈 수 있음(달성 칭호는 자동이라 수동 장착 대상에서 빠짐) —
--     me/index.ts의 setSelectedTitle이 서버에서 검증함.
-- 화면엔 "[달성 칭호][구매 칭호] 이름" 형태로 두 배지를 따로 붙여서 보여줌.

alter table public.titles add column if not exists color text;

update public.titles set name = '브론즈', color = '#cd7f32' where id = 'title1';
update public.titles set name = '실버', color = '#c7ccd1' where id = 'title2';
update public.titles set name = '골드', color = '#f5c518' where id = 'title3';
update public.titles set name = '플래티넘', color = '#45e0c8' where id = 'title4';
update public.titles set name = '다이아', color = '#5dc8ff' where id = 'title5';

-- 기존에 포인트 달성 칭호를 수동으로 장착해둔 유저가 있으면 비움 — 이제 그 칭호들은 자동으로
-- 붙고, selected_title_id는 상점 구매 칭호 전용 슬롯이 됨(1,000,000,000은 shop-items
-- 함수의 PURCHASE_ONLY_MIN_POINTS=999,999,999,999를 안전하게 걸러내는 문턱값 — 실제
-- 달성 칭호 중 가장 큰 값이 1,000,000이라 충분히 여유 있음).
update public.users
set selected_title_id = null
where selected_title_id in (select id from public.titles where min_points < 1000000000);

-- 랭킹에 포인트 달성 칭호(자동, tier_title_*)와 상점 구매 칭호(장착, shop_title_name)를
-- 따로 내려줌. tier는 저장해두지 않고 매번 max_balance_reached 기준으로 다시 계산해서
-- 항상 최신 상태를 보장함. 기존 title_name 컬럼을 없애고 새 컬럼들로 바꾸는 거라(단순
-- create or replace로는 뷰 컬럼 이름/구성을 못 바꿈) drop 후 다시 만듦.
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
group by u.channel_id, u.channel_name, u.is_public, u.created_at, tier.name, tier.color, shop.name
order by total_points desc, u.created_at asc;

grant select on public.ranking to anon, authenticated;
