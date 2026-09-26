-- 0035에서 넣은 "상점에서 산 칭호를 회수하면 재고 자동 복구"를 다시 뺌 — 나중에 관리하기 번거로울 것 같다는
-- 결정. 재고는 이제 상점 수정 창의 "남은 수량"으로만 직접 조절함(품절이면 0, 1로 고치면 다시 팔림).
-- user_purchased_titles.source(상점 구매 'purchase' / 관리자 지급 'admin')는 어떻게 얻은 칭호인지
-- 기록으로 남겨두는 용도로 그대로 둠(재고와는 이제 상관없음).

drop trigger if exists user_purchased_titles_restock on public.user_purchased_titles;
drop function if exists public.restock_title_item_on_revoke();
