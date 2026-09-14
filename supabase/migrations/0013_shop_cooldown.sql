-- 포인트 상점 상품별 쿨타임. 같은 유저가 같은 상품을 연속으로 빠르게 눌러서 오버레이/방송
-- 화면이 도배되는 걸 막는다. 0이면 쿨타임 없음(기존 동작과 동일) — cost/requires_live처럼
-- 이것도 Table Editor에서 상품별로 바로 조정 가능하다.
alter table public.shop_items add column if not exists cooldown_seconds integer not null default 0;

-- 테스트용 "물 마시기"에 10초 쿨타임 적용 (연타 테스트하기 좋은 값 — 실제 운영값은 나중에 조정).
update public.shop_items set cooldown_seconds = 10 where id = 'water';
