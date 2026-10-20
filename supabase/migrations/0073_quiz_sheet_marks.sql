-- 유진고사 채점 방식 변경 (0072 이어서)
-- 방송에서 제출된 시험지를 한 장씩 띄워 놓고 문항마다 ○/✕를 매기는 방식이라, 채점 결과를 시험지(답안)마다 저장함.
--   marks: { "<문항 id>": true(맞음) | false(틀림) } — 아직 안 매긴 문항은 키가 없음.
-- 점수 = 맞은 문항 수(배점 없음). 모의고사엔 제한시간이 없고 관리자가 "제출 마감"을 누를 때까지 제출을 받음.
alter table public.quiz_exam_submissions add column if not exists marks jsonb not null default '{}'::jsonb;
alter table public.quiz_exam_submissions add column if not exists updated_at timestamptz not null default now();
