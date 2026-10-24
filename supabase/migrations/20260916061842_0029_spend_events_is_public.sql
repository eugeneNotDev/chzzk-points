-- 오버레이(overlay.html) 표시용 "익명" 처리.
--
-- spend_events.channel_name은 사용 당시 이름을 스냅샷으로 남기는데, 이 값만 봐서는 그
-- 유저가 마이페이지에서 "비공개"로 설정해뒀는지 알 수 없어서, 비공개 유저가 상점 상품을
-- 써도 오버레이에 실명이 그대로 떴었음(랭킹은 비공개 처리가 이미 있었는데 여기만 빠짐).
-- channel_name과 같은 이유로 is_public도 사용 시점 스냅샷으로 같이 남겨서, overlay.html이
-- 이 값이 false면 이름 대신 "익명"으로 표시하게 함. 기본값 true는 이 컬럼이 생기기 전
-- 과거 행들(전부 실명으로 이미 노출됐던 행들) 해석을 그대로 유지하기 위함.
alter table public.spend_events add column if not exists is_public boolean not null default true;
