-- 방송 스케줄 달력 — 하루에 한 건(방송 또는 휴방). 읽기는 누구나(anon 포함), 쓰기는 admin-schedule 함수(service role, 관리자만).
-- start_time: "HH:MM"(한국 시간), null이면 시간 미정. kind='off'(휴방)면 시간/제목 없이도 됨.
create table if not exists public.broadcast_schedule (
  day date primary key,
  kind text not null check (kind in ('live', 'off')),
  start_time text check (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  title text not null default '' check (char_length(title) <= 30),
  memo text not null default '' check (char_length(memo) <= 200),
  updated_at timestamptz not null default now()
);
alter table public.broadcast_schedule enable row level security;
create policy broadcast_schedule_public_read on public.broadcast_schedule for select to public using (true);
revoke insert, update, delete on public.broadcast_schedule from anon, authenticated;
