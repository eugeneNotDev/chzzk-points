-- 그림 후원 — 시청자가 사이트에서 그림을 그리면 코드(6자리)를 받고, 치지직 후원 메시지에 그 코드를 넣어
-- 3,000치즈 이상 후원하면 방송 화면(overlay.html)에 그림이 뜸.
--
-- 흐름: drawings 함수(그림 저장·코드 발급·내 그림 상태·관리자 끄기) → donation-relay 함수가 후원 메시지에서 코드를 찾아
--       맞으면 status='shown'으로 바꾸고 오버레이로 Realtime broadcast(방송 코드와 같은 키 채널, _shared/stream-code.ts).
-- 금액 기준(3,000)·표시 시간·코드 유효 시간은 drawings 함수와 donation-relay의 DRAWING_* 상수.
-- 테이블은 서버(service_role) 전용 — 누가 그렸는지·후원자 이름이 들어있어서 브라우저에선 직접 못 읽음.
-- 그림 파일은 공개 버킷 drawings(경로가 무작위라 주소를 모르면 못 찾음 — 방송에 나가는 그림이라 공개여도 됨).

create table if not exists public.drawings (
  id bigint generated always as identity primary key,
  code text not null unique,                       -- 6자리(헷갈리는 0/O/1/I/L 뺀 대문자+숫자)
  channel_id text not null references public.users(channel_id),   -- 그린 사람
  image_path text not null,                        -- drawings 버킷 안 경로(완성 그림)
  strokes_path text,                               -- 획 순서 기록(.json) — 오버레이가 그림이 빠르게 그려지는 모습을 다시 보여줌. 없으면 그림만
  -- pending(후원 기다리는 중) | shown(방송에 표시함) | hidden(관리자가 끔)
  status text not null default 'pending' check (status in ('pending', 'shown', 'hidden')),
  expires_at timestamptz not null default now() + interval '24 hours',   -- 이 시각 지나면 pending이어도 못 씀(만료)
  donation_event_key text,                         -- 연결된 후원 알림(donations.event_key)
  donation_amount integer,
  donator_nickname text,                           -- 오버레이에 "OOO님의 그림"으로 뜨는 이름(익명 후원이면 null)
  last_short_amount integer,                       -- 코드는 맞았는데 금액이 모자랐던 후원(시청자 화면 안내용)
  created_at timestamptz not null default now(),
  shown_at timestamptz,
  hidden_at timestamptz
);
create index if not exists drawings_channel_idx on public.drawings (channel_id, created_at desc);
create index if not exists drawings_status_idx on public.drawings (status, created_at desc);

-- 그림 후원 막기(관리자가 이상한 그림을 올린 사람을 막을 때)
alter table public.users add column if not exists drawing_blocked boolean not null default false;

alter table public.drawings enable row level security;
revoke all on public.drawings from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('drawings', 'drawings', true, 1572864, array['image/webp', 'image/png', 'application/json'])
on conflict (id) do nothing;
