-- 포인트 구간 칭호(브론즈~다이아) 기준 포인트를 10배로 상향.
--
-- 기존: 브론즈 100 / 실버 1,000 / 골드 10,000 / 플래티넘 100,000 / 다이아 1,000,000
-- 변경: 브론즈 1,000 / 실버 10,000 / 골드 100,000 / 플래티넘 1,000,000 / 다이아 10,000,000
--
-- max_balance_reached는 그대로 두고 min_points만 올림 — 구간 칭호는 저장돼있지 않고
-- me/index.ts, ranking 뷰가 조회 시점마다 max_balance_reached 기준으로 다시 계산하므로,
-- 이 값이 바뀌는 순간부터 자동으로 새 기준이 적용됨(기존에 낮은 기준으로 달성했던 유저가
-- 새 기준엔 못 미치면 그 즉시 해당 구간 표시가 빠질 수 있음 — 기준 자체를 올리는 거라
-- 의도된 동작).

update public.titles set min_points = 1000 where id = 'title1';       -- 브론즈
update public.titles set min_points = 10000 where id = 'title2';      -- 실버
update public.titles set min_points = 100000 where id = 'title3';     -- 골드
update public.titles set min_points = 1000000 where id = 'title4';    -- 플래티넘
update public.titles set min_points = 10000000 where id = 'title5';   -- 다이아
