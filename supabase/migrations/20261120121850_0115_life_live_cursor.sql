-- 우진 키우기 방송 화면을 진행 화면(리모컨)과 맞추려고, 진행 화면이 지금 몇 번째 기록까지 보여주고 있는지 저장
-- (서버는 미리 몇 해씩 앞서 나가서, 방송 화면이 서버 기준으로 보여주면 진행 화면보다 앞서갔음)
alter table public.life_settings add column if not exists live_cursor integer;
