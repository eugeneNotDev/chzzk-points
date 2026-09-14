-- 포인트 상점에서 칭호를 "구매"로도 잠금해제할 수 있게 하는 기능 + 상품별 오버레이 알림 on/off.
--
-- 1) shop_items.grants_title_id: 이 값이 채워진 상품을 사용(구매)하면 해당 칭호가 영구
--    잠금해제된다. 기존 성취 방식(users.max_balance_reached, 0016_titles.sql)과는 별개의
--    경로 — 둘 중 하나만 만족해도 그 칭호는 unlocked로 취급한다. 완전히 구매 전용 칭호를
--    만들고 싶으면 titles.min_points를 현실적으로 못 찍을 큰 값으로 두면 됨(테이블 구조를
--    더 안 건드리려고 이렇게 함 — min_points를 nullable로 바꾸는 것보다 단순).
--    null이면 기존처럼 그냥 소모성 상품(지금까지의 모든 상품이 여기 해당).
-- 2) shop_items.show_on_overlay: 기본 true(기존 동작 그대로 유지). false면 spend-points가
--    이 상품을 사용했을 때 spend_events에 기록을 안 남겨서 오버레이(overlay.html)에 안 뜬다.
--    칭호 구매처럼 "방송 화면에 굳이 안 떠도 되는" 상품에 체크 해제해서 쓰라고 만듦.
-- 3) user_purchased_titles: 유저가 "구매"로 잠금해제한 칭호 기록. 성취 방식과 별개 경로라
--    따로 테이블로 둔다 — 한 유저가 같은 칭호를 두 번 살 수 없게 (channel_id, title_id)를
--    기본키로 묶어서 막는다.

alter table public.shop_items
  add column if not exists grants_title_id text references public.titles(id) on delete set null,
  add column if not exists show_on_overlay boolean not null default true;

create table if not exists public.user_purchased_titles (
  channel_id text not null references public.users(channel_id) on delete cascade,
  title_id text not null references public.titles(id) on delete cascade,
  purchased_at timestamptz not null default now(),
  primary key (channel_id, title_id)
);

-- 이 테이블은 Edge Function(서비스 롤)만 읽고 쓴다 — me(본인 소유 칭호 조회), spend-points
-- (구매 기록). shop_items/titles와 달리 프론트가 anon으로 직접 읽을 일이 없고(개인별 구매
-- 내역이라 공개할 이유가 없음), RLS는 켜두되 공개 정책은 열지 않는다(서비스 롤은 RLS를
-- 우회하므로 Edge Function 동작에는 영향 없음).
alter table public.user_purchased_titles enable row level security;
