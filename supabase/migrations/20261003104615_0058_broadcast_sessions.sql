-- 방송 기록: 서버가 1분마다 치지직 방송 상태를 보고 시작/종료 시각을 남김(live-tracker 함수).
-- 후기 보상의 "방송 중 또는 종료 후 6시간 이내" 판정을 치지직 응답 하나에만 기대지 않게 하려는 용도.

create table if not exists broadcast_sessions (
  open_date text primary key,            -- 치지직 openDate 문자열("YYYY-MM-DD HH:MM:SS", KST) = 방송 키
  title text,
  opened_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  last_seen_live_at timestamptz not null default now(),
  closed_at timestamptz                  -- null이면 아직 방송 중(으로 보임)
);
create index if not exists broadcast_sessions_last_seen_idx on broadcast_sessions(last_seen_live_at desc);
alter table broadcast_sessions enable row level security;
revoke all on broadcast_sessions from anon, authenticated;

-- 1분마다 live-tracker 호출 + 예약 작업 실행 기록은 3일 지난 것부터 정리
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'live-tracker',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://azowisiuyeohhfxxmewb.supabase.co/functions/v1/live-tracker',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb
     ) $$
);
select cron.schedule(
  'cron-history-cleanup',
  '17 4 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '3 days' $$
);
