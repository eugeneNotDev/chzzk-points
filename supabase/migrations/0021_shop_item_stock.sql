-- 상품 한정 수량(재고) 기능. 처음엔 칭호 상품 등록 화면에서만 입력받지만(shop.html), 컬럼
-- 자체는 어떤 shop_items row에도 걸 수 있게 범용으로 둔다(추후 일반 상품에도 열어줄 수 있게).
--
-- stock_limit: null이면 무제한(기존 상품 전부 이 상태). 값이 있으면 그 개수만큼만 판매 가능.
-- sold_count: 지금까지 이 상품이 팔린(사용된) 횟수. spend-points가 구매 성공마다 1씩 늘린다.
-- 다 팔렸다고 상품을 지우거나 비활성화하는 게 아니라 "품절" 상태로만 표시하고 구매만 막는다
-- (재고를 다시 늘리고 싶으면 관리자가 stock_limit을 그냥 다시 수정하면 됨).

alter table public.shop_items
  add column if not exists stock_limit integer,
  add column if not exists sold_count integer not null default 0,
  add constraint shop_items_stock_limit_positive check (stock_limit is null or stock_limit > 0),
  add constraint shop_items_sold_count_non_negative check (sold_count >= 0);
