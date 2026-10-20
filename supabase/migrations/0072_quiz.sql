-- 유진고사 — 방송 중에 여는 모의고사(시험지형)와 OX 퀴즈(실시간 라운드형).
--
-- 구조
--   quizzes              회차 하나(모의고사 또는 OX). status: draft(준비) → open(응시/진행 중) → closed(마감·채점 중) → revealed(결과 발표/종료)
--   quiz_questions       문항. 모의고사: choice(4지선다) / image(이미지 보기) / short(단답형). OX: ox.
--   quiz_exam_submissions  모의고사 답안(한 사람당 한 번 제출, 고칠 수 없음).
--   quiz_short_grades    단답형 채점 — 같은 답(공백 빼고 소문자로 맞춘 값)끼리 묶어서 정답/오답을 정함.
--   quiz_ox_answers      OX 응답(마감 전까지 바꿀 수 있음).
--
-- 정답(answer)은 마감·공개 전까지 브라우저로 나가면 안 되므로 전부 공개 읽기 정책 없이 막아둠 —
-- quiz / admin-quiz 함수(service_role)만 읽고 씀. 메뉴 노출 여부도 quiz 함수가 알려줌.
--
-- 테스트 회차(is_test): 보상 지급을 눌러도 포인트는 안 들어가고 "누구에게 얼마"만 reward_log에 남김.

create table if not exists public.quizzes (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('exam', 'ox')),
  title text not null,
  subtitle text not null default '',            -- 시험지 영역명(예: "유진 영역")
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'revealed')),
  is_test boolean not null default false,
  ox_mode text check (ox_mode in ('score', 'deathmatch')),
  time_limit_sec integer not null default 1200 check (time_limit_sec between 60 and 7200),
  reward_ranks integer[] not null default '{}',  -- 순위별 보상(1등, 2등, ...). 모의고사·OX 점수전
  reward_survivor integer not null default 0 check (reward_survivor >= 0), -- OX 데스매치 최후 생존자 1명당
  opened_at timestamptz,
  closes_at timestamptz,                         -- 모의고사 응시 마감 시각
  closed_at timestamptz,
  revealed_at timestamptz,
  rewarded_at timestamptz,
  reward_log jsonb,                              -- [{ channelId, channelName, amount, label }]
  created_at timestamptz not null default now()
);
create index if not exists quizzes_created_idx on public.quizzes (created_at desc);

create table if not exists public.quiz_questions (
  id bigint generated always as identity primary key,
  quiz_id bigint not null references public.quizzes(id) on delete cascade,
  position integer not null default 0,
  qtype text not null check (qtype in ('choice', 'image', 'short', 'ox')),
  prompt text not null,
  image_url text,                                -- 문제 이미지(선택)
  choices jsonb not null default '[]'::jsonb,    -- choice: 보기 글자 4개 / image: 보기 이미지 주소 4개
  answer text not null default '',               -- choice·image: '1'~'4' / short: 기준 정답 / ox: 'O'|'X'(공개 때 정해도 됨)
  points integer not null default 5 check (points between 0 and 100),
  grading text not null default 'auto' check (grading in ('auto', 'manual')), -- short: manual이면 방송에서 같이 채점
  asked_at timestamptz,                          -- OX: 출제 시각
  closes_at timestamptz,                         -- OX: 응답 마감(딜레이 여유 포함)
  revealed_at timestamptz,                       -- OX: 정답 공개 시각
  created_at timestamptz not null default now()
);
create index if not exists quiz_questions_quiz_idx on public.quiz_questions (quiz_id, position);

create table if not exists public.quiz_exam_submissions (
  id bigint generated always as identity primary key,
  quiz_id bigint not null references public.quizzes(id) on delete cascade,
  channel_id text not null references public.users(channel_id),
  answers jsonb not null default '{}'::jsonb,    -- { "<문항 id>": "2" | "overdose" }
  submitted_at timestamptz not null default now(),
  score integer,
  rank integer,
  unique (quiz_id, channel_id)
);

create table if not exists public.quiz_short_grades (
  question_id bigint not null references public.quiz_questions(id) on delete cascade,
  norm_answer text not null,
  correct boolean not null,
  primary key (question_id, norm_answer)
);

create table if not exists public.quiz_ox_answers (
  id bigint generated always as identity primary key,
  quiz_id bigint not null references public.quizzes(id) on delete cascade,
  question_id bigint not null references public.quiz_questions(id) on delete cascade,
  channel_id text not null references public.users(channel_id),
  choice text not null check (choice in ('O', 'X')),
  answered_at timestamptz not null default now(),
  unique (question_id, channel_id)
);
create index if not exists quiz_ox_answers_quiz_idx on public.quiz_ox_answers (quiz_id, channel_id);

alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_exam_submissions enable row level security;
alter table public.quiz_short_grades enable row level security;
alter table public.quiz_ox_answers enable row level security;
revoke all on public.quizzes, public.quiz_questions, public.quiz_exam_submissions, public.quiz_short_grades, public.quiz_ox_answers from anon, authenticated;

-- 보상 지급 — 한 회차에 한 번만. admin-quiz 함수가 순위·생존자를 계산해서 p_payouts로 넘김.
--   p_payouts: [{ "channelId": "...", "amount": 1000, "label": "1등" }, ...]
--   테스트 회차면 포인트 기록은 안 남기고 reward_log만 남김.
-- 결과 { ok, test, count, total } | { error: quiz_not_found | not_revealed | already_paid }
create or replace function public.quiz_pay_rewards(p_quiz_id bigint, p_payouts jsonb)
returns jsonb as $$
declare
  v_quiz public.quizzes%rowtype;
  v_item jsonb;
  v_amount integer;
  v_count integer := 0;
  v_total bigint := 0;
begin
  select * into v_quiz from public.quizzes where id = p_quiz_id for update;
  if not found then return jsonb_build_object('error', 'quiz_not_found'); end if;
  if v_quiz.status <> 'revealed' then return jsonb_build_object('error', 'not_revealed'); end if;
  if v_quiz.rewarded_at is not null then return jsonb_build_object('error', 'already_paid'); end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payouts, '[]'::jsonb)) loop
    v_amount := (v_item->>'amount')::integer;
    if v_amount is null or v_amount <= 0 then continue; end if;
    if not v_quiz.is_test then
      insert into public.points_ledger (channel_id, amount, reason)
      values (v_item->>'channelId', v_amount, format('유진고사 보상: %s %s', v_quiz.title, coalesce(v_item->>'label', '')));
    end if;
    v_count := v_count + 1;
    v_total := v_total + v_amount;
  end loop;

  update public.quizzes set rewarded_at = now(), reward_log = coalesce(p_payouts, '[]'::jsonb) where id = p_quiz_id;
  return jsonb_build_object('ok', true, 'test', v_quiz.is_test, 'count', v_count, 'total', v_total);
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.quiz_pay_rewards(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.quiz_pay_rewards(bigint, jsonb) to service_role;

-- 문제·보기 이미지 — 공개 읽기 버킷. 업로드는 admin-quiz가 발급하는 signed upload URL로만(공지 첨부와 같은 방식).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quiz-images', 'quiz-images', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
