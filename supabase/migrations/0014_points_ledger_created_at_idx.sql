-- 관리자 페이지 "포인트 로그"가 points_ledger를 created_at 내림차순으로 자주 조회하게 돼서
-- 인덱스를 걸어둔다 (channel_id 인덱스는 0012_perf_indexes.sql에서 이미 추가함).
create index if not exists points_ledger_created_at_idx on public.points_ledger (created_at desc);
