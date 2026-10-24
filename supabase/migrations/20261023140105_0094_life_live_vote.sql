-- 유진 키우기 방송 모드: 유진이 방송에서 키우는 판(live_life_id)의 갈림길을 시청자가 팬보드에서 투표.
-- 투표는 유진이 리모컨(진행 화면)에서 직접 열고 마감함. 한 사람 한 표(마감 전까지 바꿀 수 있음).
alter table public.life_settings
  add column if not exists live_life_id bigint,
  add column if not exists vote_round text,
  add column if not exists vote_open boolean not null default false;

create table if not exists public.life_votes (
  round text not null,
  channel_id text not null references public.users(channel_id) on delete cascade,
  key text not null,
  created_at timestamptz not null default now(),
  primary key (round, channel_id)
);
create index if not exists life_votes_round on public.life_votes (round);
alter table public.life_votes enable row level security;
revoke all on public.life_votes from anon, authenticated;
