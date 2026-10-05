-- 댓글 답글(한 단계). parent_id = 원래 댓글(최상위), reply_to_id = 실제로 답한 댓글(@표시용, 원댓글 또는 같은 묶음의 답글).
-- 답글이 달린 원댓글을 지우면 행은 남기고 deleted=true(본문 비움) — "삭제된 댓글이에요" 자리 표시용.
alter table public.board_comments
  add column if not exists parent_id bigint references public.board_comments(id) on delete cascade,
  add column if not exists reply_to_id bigint references public.board_comments(id) on delete set null,
  add column if not exists deleted boolean not null default false;
create index if not exists board_comments_parent_idx on public.board_comments (parent_id) where parent_id is not null;
