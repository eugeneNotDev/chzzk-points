-- 퀴즈 실시간 신호 — OX 퀴즈 중 시청자 화면이 1.5초마다 서버에 계속 물어보던 것(1시간 8천 번+) 대신,
-- 회차·문제·답이 바뀌는 순간에만 신호를 보내고 화면은 그때 다시 불러오게.
-- ranking_pings와 같은 방식: 내용 없는 공개 신호 테이블(무엇이 바뀌었는지 종류만) + 트리거가 채움 + 실시간 구독.
--   kind = 'state'  : 회차(quizzes)·문항(quiz_questions)이 바뀜 — 시작/마감/문제 출제/정답 공개/보상 등. 모두가 구독
--   kind = 'answer' : OX 답이 들어옴 — 관리자·방송화면만 구독(답 수 표시)
--   kind = 'submit' : 모의고사 답안 제출·채점 — 관리자만 구독
create table if not exists public.quiz_pings (
  id bigint generated always as identity primary key,
  quiz_id bigint,
  kind text not null,
  created_at timestamptz not null default now()
);
alter table public.quiz_pings enable row level security;
create policy quiz_pings_public_read on public.quiz_pings for select to anon, authenticated using (true);
revoke insert, update, delete on public.quiz_pings from anon, authenticated;

create or replace function public.ping_quiz_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz bigint;
  v_kind text := tg_argv[0];
  v_id bigint;
begin
  if tg_table_name = 'quizzes' then
    v_quiz := coalesce(new.id, old.id);
  else
    v_quiz := coalesce(new.quiz_id, old.quiz_id);
  end if;
  insert into public.quiz_pings (quiz_id, kind) values (v_quiz, v_kind) returning id into v_id;
  -- 200번에 한 번 하루 지난 신호 정리
  if v_id % 200 = 0 then
    delete from public.quiz_pings where created_at < now() - interval '1 day';
  end if;
  return null;
end;
$$;
revoke all on function public.ping_quiz_change() from public, anon, authenticated;

create trigger quizzes_ping after insert or update or delete on public.quizzes
  for each row execute function public.ping_quiz_change('state');
create trigger quiz_questions_ping after insert or update or delete on public.quiz_questions
  for each row execute function public.ping_quiz_change('state');
create trigger quiz_ox_answers_ping after insert or update on public.quiz_ox_answers
  for each row execute function public.ping_quiz_change('answer');
create trigger quiz_exam_submissions_ping after insert or update on public.quiz_exam_submissions
  for each row execute function public.ping_quiz_change('submit');

alter publication supabase_realtime add table public.quiz_pings;
