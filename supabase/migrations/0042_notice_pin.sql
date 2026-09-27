-- 공지 상단 고정. pinned_at에 "고정한 시각"을 넣음(고정 안 한 글은 null).
-- 목록은 고정글 먼저(고정한 순서대로 — 먼저 고정한 글이 맨 위, 나중에 고정한 글은 그 아래),
-- 그 다음 일반 글(최신순):  order by pinned_at asc nulls last, created_at desc
-- 고정을 풀었다 다시 걸면 그 시각으로 새로 찍혀서 고정글 중 맨 아래로 감.
-- 고정/해제는 글 내용 수정이 아니라서 updated_at은 안 건드림("(수정됨)" 표시가 안 붙게).
alter table public.notices add column if not exists pinned_at timestamptz;
create index if not exists notices_pinned_at_idx on public.notices (pinned_at) where pinned_at is not null;
