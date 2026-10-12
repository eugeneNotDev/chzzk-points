-- 방송 알림(웹 푸시). 앱(홈 화면 설치)에서 "방송 알림 받기"를 켠 기기 목록 + 방송 시작 때 자동 발송.
--
-- push_subscriptions: 기기(브라우저)마다 한 줄. endpoint/p256dh/auth는 브라우저가 준 값 그대로(push 함수만 읽고 씀).
-- 방송 시작 감지: live-tracker가 새 방송을 처음 보면 broadcast_sessions에 한 줄 넣음 → 아래 트리거가 push 함수를 부름
--   (live-tracker 코드는 안 건드림). push 함수가 notified_at을 채우면서 한 번만 보냄.
--   방송 시작 30분이 지나서야 발견된 경우(추적이 잠깐 멈췄다 돌아온 경우 등)는 늦은 알림이라 안 보냄.
-- 비밀값(VAPID 비밀키 vapid_keys, 트리거 인증 push_key)은 app_secrets에만 있고 이 파일엔 없음.

create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  channel_id text not null references public.users(channel_id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);
alter table public.push_subscriptions enable row level security;
create index if not exists push_subscriptions_channel_idx on public.push_subscriptions (channel_id);

alter table public.broadcast_sessions add column if not exists notified_at timestamptz;

create or replace function public.notify_live_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.closed_at is null and new.opened_at > now() - interval '30 minutes' then
    perform net.http_post(
      url := 'https://azowisiuyeohhfxxmewb.supabase.co/functions/v1/push',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-push-key', (select value from public.app_secrets where name = 'push_key')),
      body := jsonb_build_object('action', 'live', 'openDate', new.open_date)
    );
  end if;
  return new;
end;
$$;
revoke all on function public.notify_live_push() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'broadcast_sessions_live_push') then
    create trigger broadcast_sessions_live_push
      after insert on public.broadcast_sessions
      for each row execute function public.notify_live_push();
  end if;
end $$;
