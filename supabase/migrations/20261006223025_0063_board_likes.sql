-- 게시판 좋아요(글·댓글). 누가 눌렀는지는 화면에 안 보여줌 — 개수와 "내가 눌렀는지"만 내려감(board 함수).
create table if not exists public.board_post_likes (
  post_id bigint not null references public.board_posts(id) on delete cascade,
  channel_id text not null references public.users(channel_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, channel_id)
);
create table if not exists public.board_comment_likes (
  comment_id bigint not null references public.board_comments(id) on delete cascade,
  channel_id text not null references public.users(channel_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, channel_id)
);
alter table public.board_post_likes enable row level security;
alter table public.board_comment_likes enable row level security;
