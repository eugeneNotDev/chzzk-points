-- 게시판 신고. 서로 다른 5명이 신고하면(처리 안 된 신고 기준) 글/댓글을 자동으로 가림(hidden).
-- 관리자는 관리자 페이지 "신고" 탭에서 숨김 해제·문제없음·삭제로 처리. 읽기/쓰기는 board 함수(service_role)만.

alter table board_posts add column if not exists hidden boolean not null default false;
alter table board_comments add column if not exists hidden boolean not null default false;

create table if not exists board_reports (
  id bigint generated always as identity primary key,
  target_type text not null check (target_type in ('post', 'comment')),
  target_id bigint not null,
  reporter text not null references users(channel_id),
  reason text not null check (reason in ('abuse', 'spam', 'obscene', 'privacy', 'etc')),
  memo text not null default '',
  -- 신고 당시 내용 스냅샷(삭제된 뒤에도 처리 기록에서 볼 수 있게)
  board text not null,
  post_id bigint not null,
  author text not null,
  snap_title text not null default '',
  snap_body text not null default '',
  created_at timestamptz not null default now(),
  -- 처리 결과: null(대기) / restored(숨김 해제) / dismissed(문제없음) / deleted(관리자 삭제) / author_deleted(작성자가 지움)
  resolution text check (resolution in ('restored', 'dismissed', 'deleted', 'author_deleted')),
  resolved_at timestamptz,
  unique (target_type, target_id, reporter)
);
create index if not exists board_reports_open_idx on board_reports(target_type, target_id) where resolution is null;
create index if not exists board_reports_reporter_idx on board_reports(reporter, created_at desc);

alter table board_reports enable row level security;
revoke all on board_reports from anon, authenticated;
