-- 관리자 포인트 로그에서 "spend:water"처럼 짧은 코드로만 보이던 걸 상품명이 그대로
-- 보이는 문구로 백필한다. 이후로는 spend-points 함수가 애초에 이 형식으로 기록한다
-- (0015 적용 시점 이후 신규 기록은 이미 새 형식으로 들어옴).
update points_ledger pl
set reason = '포인트 상점 사용: ' || si.name
from shop_items si
where pl.reason = 'spend:' || si.id;
