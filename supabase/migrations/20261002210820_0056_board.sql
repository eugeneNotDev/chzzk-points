-- 게시판: 익명 자유게시판(board='free') + 방송 후기(board='review').
--
-- 읽기/쓰기 전부 board Edge Function(service_role)만 함 — 자유게시판은 익명이라 작성자
-- channel_id가 프론트로 새면 안 되고(관리자만 닉네임 확인), 이 프로젝트는 Supabase Auth를
-- 안 써서 RLS로 "본인 글인지"를 못 가리기 때문. 그래서 RLS만 켜고 정책은 안 둠.
-- (이미지는 공개 버킷 board-images, 업로드는 signed upload URL.)

create table if not exists board_posts (
  id bigint generated always as identity primary key,
  board text not null check (board in ('free', 'review')),
  channel_id text not null references users(channel_id),
  title text not null,
  body text not null default '',
  -- 후기글만: 어느 방송에 대한 후기인지(치지직 방송 시작 시각 문자열). 자유게시판은 null.
  broadcast_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists board_posts_board_id_idx on board_posts(board, id desc);
create index if not exists board_posts_channel_idx on board_posts(channel_id);

create table if not exists board_images (
  id bigint generated always as identity primary key,
  post_id bigint not null references board_posts(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0
);
create index if not exists board_images_post_idx on board_images(post_id);

create table if not exists board_comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references board_posts(id) on delete cascade,
  channel_id text not null references users(channel_id),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists board_comments_post_idx on board_comments(post_id, id);

-- 후기 보상 기록. (channel_id, broadcast_key) 하나당 최대 1행 = 방송 하나에 100P 한 번.
-- 후기를 지우면 100P를 회수하고 revoked=true로 표시하되 행은 남김 → 지웠다 다시 써서 같은
-- 방송으로 또 받는 건 불가.
create table if not exists board_review_rewards (
  channel_id text not null references users(channel_id),
  broadcast_key text not null,
  post_id bigint references board_posts(id) on delete set null,
  amount integer not null,
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (channel_id, broadcast_key)
);

alter table board_posts enable row level security;
alter table board_images enable row level security;
alter table board_comments enable row level security;
alter table board_review_rewards enable row level security;
revoke all on board_posts, board_images, board_comments, board_review_rewards from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('board-images', 'board-images', true, 5242880)
on conflict (id) do nothing;
