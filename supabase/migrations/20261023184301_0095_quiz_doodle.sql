-- 유진고사(모의고사) 시험지 낙서 — 예전에 시험지를 직접 올리던 시절처럼 시험지 위에 그림·낙서를 그려서 답안과 같이 냄.
-- doodle: { w: 시험지 폭(고정 880), h: 높이, ops: [{ c: 색, s: 굵기, p: [x,y,x,y,…], e?: 1(지우개) }] } — 펜 획 기록(벡터)
-- has_doodle: 채점 목록에서 낙서 있는 시험지만 표시하려고(목록엔 낙서 본문을 안 실음)
alter table public.quiz_exam_submissions add column if not exists doodle jsonb;
alter table public.quiz_exam_submissions add column if not exists has_doodle boolean generated always as (doodle is not null) stored;
