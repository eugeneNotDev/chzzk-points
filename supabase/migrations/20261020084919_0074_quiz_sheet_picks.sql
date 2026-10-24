-- 모의고사 채점: 객관식은 채점 화면에서 관리자가 고른 번호(정답)를 시험지마다 기록 → 그 번호와 같으면 맞음
alter table quiz_exam_submissions add column if not exists picks jsonb not null default '{}';
