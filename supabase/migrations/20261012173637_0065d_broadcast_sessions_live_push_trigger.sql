-- 방송 알림 4/4: broadcast_sessions에 새 방송이 들어오면 알림
create trigger broadcast_sessions_live_push
  after insert on public.broadcast_sessions
  for each row execute function public.notify_live_push();
