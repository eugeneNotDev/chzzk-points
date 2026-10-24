-- 게시판 활동 보상 — 하루(한국 시간) 게시글 3개 × 30P, 댓글 5개 × 10P (금액·한도는 board 함수의 ACTIVITY).
--
-- 글·댓글 하나당 최대 1행((kind, target_id) 유일). 지우거나 신고로 숨겨지면 revoked=true로 표시하고 포인트를 회수하되
-- 행은 남김 → 그날 한도를 셀 때 회수된 것도 세서, 지웠다 다시 써서 보상을 또 받는 건 불가.
-- board 함수(service_role)만 읽고 씀 — 익명 게시판이라 누가 어느 글로 받았는지 브라우저에 새면 안 됨.
create table if not exists public.board_activity_rewards (
  id bigint generated always as identity primary key,
  channel_id text not null references public.users(channel_id),
  kind text not null check (kind in ('post', 'comment')),
  target_id bigint not null,          -- 게시글 id 또는 댓글 id
  post_id bigint,                     -- 댓글이면 그 댓글이 달린 글(같은 글 몰아쓰기 한도용)
  kst_date date not null,             -- 받은 날(한국 시간)
  amount integer not null check (amount > 0),
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (kind, target_id)
);
create index if not exists board_activity_rewards_day_idx on public.board_activity_rewards (channel_id, kst_date, kind);
create index if not exists board_activity_rewards_post_idx on public.board_activity_rewards (channel_id, post_id) where kind = 'comment';

alter table public.board_activity_rewards enable row level security;
revoke all on public.board_activity_rewards from anon, authenticated;
