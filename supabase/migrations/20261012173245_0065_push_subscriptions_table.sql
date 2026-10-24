-- 방송 알림(웹 푸시) 1/4: 구독 정보 테이블. (예전 0065_push_notifications.sql 하나에 있던 걸 실제 DB 적용 단위대로 나눔)
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
