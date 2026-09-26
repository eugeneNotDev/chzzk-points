-- 칭호 꾸미기 + 관리자 커스텀 칭호 + 랭킹 뷰 정리.
--
-- 1) titles.kind: 칭호 종류를 컬럼으로 구분함. 지금까지는 min_points가 아주 크면 "구매 칭호"라고
--    숫자로 판정했는데, 관리자가 직접 주는 칭호(custom)가 생기면서 구분이 하나 더 필요해짐.
--      tier   = 포인트 구간 칭호(브론즈~다이아, 자동으로 붙음)
--      shop   = 상점에서 사는 칭호 (상품 1개당 칭호 1개, id가 상품 id와 같음)
--      custom = 관리자가 특정 유저한테 직접 지급한 칭호 (admin 함수의 grant-custom-title)
--    shop/custom은 둘 다 user_purchased_titles에 "보유" 기록이 생기고 마이페이지에서 장착하는
--    방식이라 min_points는 기존처럼 못 찍는 큰 값을 그대로 씀.
-- 2) 상점/커스텀 칭호도 색을 가짐(titles.color는 0022에서 이미 생김, 원래 구간 칭호만 썼음).
--    색이 없던 기존 칭호는 지금까지 보이던 기본 민트색으로 채움.
-- 3) 상점 상품이 이미 지워져서 연결이 끊겼고, 가진 사람도 없는 칭호 row 정리(테스트하면서
--    생긴 것들). 앞으로는 칭호 상품을 삭제하면 칭호 row도 같이 지워지게 바뀜(shop-items 함수).
-- 4) 랭킹 뷰에 장착 칭호 색(shop_title_color) 추가 + 잔액을 users.balance로 읽게 바꿈
--    (0032에서 잔액 칸이 생겨서 points_ledger 전체를 합산할 필요가 없어짐).

alter table public.titles add column if not exists kind text not null default 'shop';
alter table public.titles drop constraint if exists titles_kind_check;
alter table public.titles add constraint titles_kind_check check (kind in ('tier', 'shop', 'custom'));
update public.titles set kind = 'tier' where min_points < 1000000000;

update public.titles set color = '#00e5a0' where kind <> 'tier' and color is null;

delete from public.titles t
where t.kind = 'shop'
  and not exists (select 1 from public.shop_items s where s.grants_title_id = t.id)
  and not exists (select 1 from public.user_purchased_titles p where p.title_id = t.id)
  and not exists (select 1 from public.users u where u.selected_title_id = t.id);

drop view if exists public.ranking;
create view public.ranking as
select
  u.channel_id,
  case when u.is_public then u.channel_name else '비공개' end as channel_name,
  u.balance as total_points,
  u.is_public,
  case when u.is_public then tier.name end as tier_title_name,
  case when u.is_public then tier.color end as tier_title_color,
  case when u.is_public then shop.name end as shop_title_name,
  case when u.is_public then shop.color end as shop_title_color
from users u
left join lateral (
  select t.name, t.color from titles t
  where t.kind = 'tier' and t.min_points <= u.max_balance_reached
  order by t.min_points desc limit 1
) tier on true
left join titles shop on shop.id = u.selected_title_id
where u.banned = false
  and u.channel_id <> '37a1acfaa35d56311bf428dc96142e9f' -- OWNER_CHANNEL_ID (config.ts), 관리자 계정 제외 (0017 참고)
order by u.balance desc, u.created_at asc;

grant select on public.ranking to anon, authenticated;
