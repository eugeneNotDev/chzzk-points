-- Supabase 성능 어드바이저가 지적한 인덱스 누락 보완.
-- points_ledger/spend_events 둘 다 channel_id로 필터링하는 조회(잔액 합산, 유저별 이벤트 등)가
-- 잦은데 FK 컬럼에 커버링 인덱스가 없었음 — 지금 데이터량에선 체감 차이 없지만 나중에
-- 행이 많아지면 순차 스캔이 느려지니 미리 걸어둠.
create index if not exists points_ledger_channel_id_idx on public.points_ledger (channel_id);
create index if not exists spend_events_channel_id_idx on public.spend_events (channel_id);
