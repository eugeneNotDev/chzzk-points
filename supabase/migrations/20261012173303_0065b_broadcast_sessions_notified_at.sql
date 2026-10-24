-- 방송 알림 2/4: 방송 시작 알림을 이미 보냈는지 표시
set lock_timeout = '5s';
alter table public.broadcast_sessions add column if not exists notified_at timestamptz;
