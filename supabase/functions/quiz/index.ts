// 유진고사 — 시청자용. 조회(GET)와 제출(POST). 회차 만들기·진행·채점·지급은 admin-quiz 함수.
//
// GET ?peek=1 (로그인 없이) → 메뉴 표시용: { active: 진행 중(제출 받는 중·채점 중·OX 진행 중) 회차 | null, recent: 발표 끝난 지 30분 안 된 회차 | null }
// GET (로그인)              → 지금 회차(종류별 하나씩, OX 먼저) + 내 지난 기록: { quizzes: QuizView[], history: HistoryItem[] }
// GET ?quizId=N (로그인)    → 그 회차(발표가 끝났거나 진행 중인 것만): { quiz: QuizView | null }
//
// POST { action: "submit-exam", quizId, answers: { "<문항 id>": "2" | "답" } } → { ok: true, submittedAt }  (한 사람당 한 번만, 고칠 수 없음)
// POST { action: "ox-answer", questionId, choice: "O" | "X" } → { ok: true, choice }
//   실패 400 { error }: quiz_not_found / quiz_closed / already_submitted / question_closed / eliminated / invalid_request
//
// 정답은 공개 전까지 절대 응답에 넣지 않음(모의고사: 결과 발표 후, OX: 문제별 정답 공개 후).

import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";
import {
  canAnswerOx,
  findActiveQuizzes,
  getAdminClient,
  loadNames,
  oxStandings,
  QUESTION_COLS,
  QUIZ_COLS,
  SUBMISSION_COLS,
  type Admin,
  type OxAnswerRow,
  type QuestionRow,
  type QuizRow,
  type SubmissionRow,
} from "../_shared/quiz.ts";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function loadQuestions(admin: Admin, quizId: number) {
  const { data, error } = await admin.from("quiz_questions").select(QUESTION_COLS).eq("quiz_id", quizId).order("position", { ascending: true }).order("id", { ascending: true });
  if (error) throw new Error(`quiz_questions 조회 실패: ${error.message}`);
  return (data ?? []) as QuestionRow[];
}

function myReward(quiz: QuizRow, channelId: string) {
  const r = quiz.reward_log?.find((x) => x.channelId === channelId);
  return r ? { amount: r.amount, label: r.label } : null;
}

function baseView(quiz: QuizRow, channelId: string) {
  return {
    id: quiz.id,
    kind: quiz.kind,
    title: quiz.title,
    subtitle: quiz.subtitle,
    status: quiz.status,
    isTest: quiz.is_test,
    oxMode: quiz.ox_mode,
    timeLimitSec: quiz.time_limit_sec,
    closesAt: quiz.closes_at,
    revealedAt: quiz.revealed_at,
    rewardRanks: quiz.reward_ranks,
    rewardSurvivor: quiz.reward_survivor,
    rewarded: !!quiz.rewarded_at,
    myReward: myReward(quiz, channelId),
  };
}

async function examView(admin: Admin, quiz: QuizRow, channelId: string) {
  const questions = await loadQuestions(admin, quiz.id);
  const { data: subsData, error } = await admin.from("quiz_exam_submissions").select(SUBMISSION_COLS).eq("quiz_id", quiz.id);
  if (error) throw new Error(`quiz_exam_submissions 조회 실패: ${error.message}`);
  const subs = (subsData ?? []) as SubmissionRow[];
  const mine = subs.find((s) => s.channel_id === channelId) ?? null;
  const revealed = quiz.status === "revealed";

  // 정답·채점 결과는 결과 발표 뒤에만
  const qs = questions.map((q) => {
    const base = { id: q.id, position: q.position, qtype: q.qtype, prompt: q.prompt, imageUrl: q.image_url, choices: q.choices };
    if (!revealed) return base;
    const right = subs.filter((s) => s.marks?.[String(q.id)] === true).length;
    return {
      ...base,
      answer: q.answer,
      rate: subs.length ? Math.round((right / subs.length) * 100) : 0,
      myCorrect: mine ? mine.marks?.[String(q.id)] === true : null,
    };
  });

  let ranking: { rank: number; name: string; score: number; isMe: boolean }[] = [];
  if (revealed) {
    const ranked = subs.filter((s) => s.rank != null).sort((a, b) => a.rank! - b.rank!);
    const top = ranked.slice(0, 10);
    const names = await loadNames(admin, top.map((s) => s.channel_id), false);
    ranking = top.map((s) => ({ rank: s.rank!, name: s.channel_id === channelId ? "나" : names.get(s.channel_id) ?? "비공개", score: s.score ?? 0, isMe: s.channel_id === channelId }));
  }

  return {
    ...baseView(quiz, channelId),
    questions: quiz.status === "draft" ? [] : qs,
    participants: subs.length,
    mine: mine ? { answers: mine.answers, submittedAt: mine.submitted_at, score: revealed ? mine.score : null, rank: revealed ? mine.rank : null } : null,
    ranking,
  };
}

async function oxView(admin: Admin, quiz: QuizRow, channelId: string) {
  const questions = await loadQuestions(admin, quiz.id);
  const { data: ansData, error } = await admin.from("quiz_ox_answers").select("question_id, channel_id, choice, answered_at").eq("quiz_id", quiz.id);
  if (error) throw new Error(`quiz_ox_answers 조회 실패: ${error.message}`);
  const answers = (ansData ?? []) as OxAnswerRow[];
  const standings = oxStandings(questions, answers, quiz.ox_mode);
  const asked = questions.filter((q) => q.asked_at).sort((a, b) => a.asked_at!.localeCompare(b.asked_at!));
  const now = Date.now();

  const cur = asked[asked.length - 1] ?? null;
  let current = null;
  if (cur && quiz.status !== "revealed") {
    const closed = !!cur.revealed_at || (!!cur.closes_at && new Date(cur.closes_at).getTime() <= now);
    const curAns = answers.filter((a) => a.question_id === cur.id);
    current = {
      id: cur.id,
      number: asked.length,
      prompt: cur.prompt,
      imageUrl: cur.image_url,
      askedAt: cur.asked_at,
      closesAt: cur.closes_at,
      closed,
      revealed: !!cur.revealed_at,
      answer: cur.revealed_at ? cur.answer : null,
      counts: closed ? { O: curAns.filter((a) => a.choice === "O").length, X: curAns.filter((a) => a.choice === "X").length } : null,
      myChoice: curAns.find((a) => a.channel_id === channelId)?.choice ?? null,
    };
  }

  const me = standings.players.find((p) => p.channelId === channelId);
  const myAns = new Map(answers.filter((a) => a.channel_id === channelId).map((a) => [a.question_id, a.choice]));
  const history = asked
    .map((q, i) => ({ q, number: i + 1 }))
    .filter(({ q }) => q.revealed_at)
    .map(({ q, number }) => ({ number, prompt: q.prompt, mine: myAns.get(q.id) ?? null, answer: q.answer, correct: myAns.get(q.id) === q.answer }));

  let ranking: { rank: number; name: string; correct: number; alive: boolean; isMe: boolean }[] = [];
  if (quiz.status === "revealed") {
    const top = standings.players.filter((p) => (quiz.ox_mode === "deathmatch" ? p.alive : p.correct > 0)).slice(0, 20);
    const names = await loadNames(admin, top.map((p) => p.channelId), false);
    ranking = top.map((p, i) => ({ rank: i + 1, name: p.channelId === channelId ? "나" : names.get(p.channelId) ?? "비공개", correct: p.correct, alive: p.alive, isMe: p.channelId === channelId }));
  }

  return {
    ...baseView(quiz, channelId),
    current,
    me: {
      joined: !!me,
      alive: quiz.ox_mode === "deathmatch" ? (standings.started ? me?.alive === true : true) : true,
      correct: me?.correct ?? 0,
      canAnswer: canAnswerOx(quiz.ox_mode, standings, channelId),
      history,
    },
    aliveCount: standings.started ? standings.players.filter((p) => p.alive).length : standings.players.length,
    participants: standings.players.length,
    revealedCount: standings.revealedCount,
    ranking,
  };
}

const buildView = (admin: Admin, quiz: QuizRow, channelId: string) => (quiz.kind === "exam" ? examView(admin, quiz, channelId) : oxView(admin, quiz, channelId));

async function history(admin: Admin, channelId: string) {
  const [{ data: subs, error: e1 }, { data: oxs, error: e2 }] = await Promise.all([
    admin.from("quiz_exam_submissions").select("quiz_id, score, rank").eq("channel_id", channelId).order("submitted_at", { ascending: false }).limit(200),
    admin.from("quiz_ox_answers").select("quiz_id").eq("channel_id", channelId).order("answered_at", { ascending: false }).limit(5000),
  ]);
  if (e1) throw new Error(`history 조회 실패: ${e1.message}`);
  if (e2) throw new Error(`history 조회 실패: ${e2.message}`);
  // 관리자(채널 주인)는 참여 여부와 상관없이 끝난 회차 전부
  const isOwner = channelId === OWNER_CHANNEL_ID;
  const ids = [...new Set([...(subs ?? []).map((s) => s.quiz_id), ...(oxs ?? []).map((o) => o.quiz_id)])];
  if (ids.length === 0 && !isOwner) return [];
  let hq = admin.from("quizzes").select(QUIZ_COLS).eq("status", "revealed");
  if (!isOwner) hq = hq.in("id", ids);
  const { data: quizzes, error } = await hq.order("revealed_at", { ascending: false }).limit(200);
  if (error) throw new Error(`history 조회 실패: ${error.message}`);
  return ((quizzes ?? []) as QuizRow[]).map((q) => {
    const s = (subs ?? []).find((x) => x.quiz_id === q.id);
    return {
      id: q.id,
      kind: q.kind,
      title: q.title,
      oxMode: q.ox_mode,
      revealedAt: q.revealed_at,
      isTest: q.is_test,
      score: s?.score ?? null,
      rank: s?.rank ?? null,
      reward: myReward(q, channelId),
    };
  });
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (!["GET", "POST"].includes(req.method)) return json({ error: "method_not_allowed" }, 405);

  try {
    const admin = getAdminClient();
    const url = new URL(req.url);

    if (req.method === "GET" && url.searchParams.get("peek") === "1") {
      const qs = await findActiveQuizzes(admin);
      const pick = (q: QuizRow | undefined) => (q ? { id: q.id, kind: q.kind, title: q.title, status: q.status } : null);
      return json({ active: pick(qs.find((q) => q.status !== "revealed")), recent: pick(qs.find((q) => q.status === "revealed")) }, 200);
    }

    const session = await requireSession(req);
    if (!session) return json({ error: "unauthorized" }, 401);
    const { data: u, error: ue } = await admin.from("users").select("banned").eq("channel_id", session.channelId).maybeSingle();
    if (ue) throw new Error(`users 조회 실패: ${ue.message}`);
    if (u?.banned === true) return json({ error: "banned" }, 403);

    if (req.method === "GET") {
      const quizId = Number(url.searchParams.get("quizId"));
      if (url.searchParams.has("quizId")) {
        if (!Number.isInteger(quizId)) return json({ error: "invalid_request" }, 400);
        const { data, error } = await admin.from("quizzes").select(QUIZ_COLS).eq("id", quizId).neq("status", "draft").maybeSingle();
        if (error) throw new Error(`quizzes 조회 실패: ${error.message}`);
        return json({ quiz: data ? await buildView(admin, data as QuizRow, session.channelId) : null }, 200);
      }
      const active = await findActiveQuizzes(admin);
      const [views, hist] = await Promise.all([Promise.all(active.map((q) => buildView(admin, q, session.channelId))), history(admin, session.channelId)]);
      return json({ quizzes: views, history: hist }, 200);
    }

    const body = await req.json().catch(() => ({}));

    if (body.action === "submit-exam") {
      const quizId = Number(body.quizId);
      if (!Number.isInteger(quizId) || typeof body.answers !== "object" || body.answers === null) return json({ error: "invalid_request" }, 400);
      const { data: quiz, error } = await admin.from("quizzes").select(QUIZ_COLS).eq("id", quizId).maybeSingle();
      if (error) throw new Error(`quizzes 조회 실패: ${error.message}`);
      if (!quiz || quiz.kind !== "exam") return json({ error: "quiz_not_found" }, 400);
      const q = quiz as QuizRow;
      if (q.status !== "open") return json({ error: "quiz_closed" }, 400);

      const questions = await loadQuestions(admin, quizId);
      const answers: Record<string, string> = {};
      for (const qu of questions) {
        const v = body.answers[String(qu.id)];
        if (typeof v !== "string") continue;
        if (qu.qtype === "short") {
          const t = v.trim().slice(0, 100);
          if (t) answers[String(qu.id)] = t;
        } else if (["1", "2", "3", "4"].includes(v)) {
          answers[String(qu.id)] = v;
        }
      }
      // 한 사람당 한 번만 — 이미 냈으면 unique 제약에 걸림(고쳐서 다시 낼 수 없음)
      const { data: ins, error: ie } = await admin.from("quiz_exam_submissions").insert({ quiz_id: quizId, channel_id: session.channelId, answers }).select("submitted_at").maybeSingle();
      if (ie) {
        if (ie.code === "23505") return json({ error: "already_submitted" }, 400);
        throw new Error(`제출 실패: ${ie.message}`);
      }
      return json({ ok: true, submittedAt: ins?.submitted_at }, 200);
    }

    if (body.action === "ox-answer") {
      const questionId = Number(body.questionId);
      const choice = body.choice;
      if (!Number.isInteger(questionId) || (choice !== "O" && choice !== "X")) return json({ error: "invalid_request" }, 400);
      const { data: qd, error } = await admin.from("quiz_questions").select(QUESTION_COLS).eq("id", questionId).maybeSingle();
      if (error) throw new Error(`quiz_questions 조회 실패: ${error.message}`);
      const question = qd as QuestionRow | null;
      if (!question || question.qtype !== "ox" || !question.asked_at) return json({ error: "quiz_not_found" }, 400);
      if (question.revealed_at || !question.closes_at || Date.now() > new Date(question.closes_at).getTime()) return json({ error: "question_closed" }, 400);
      const { data: quiz, error: qe } = await admin.from("quizzes").select(QUIZ_COLS).eq("id", question.quiz_id).maybeSingle();
      if (qe) throw new Error(`quizzes 조회 실패: ${qe.message}`);
      if (!quiz || quiz.status !== "open") return json({ error: "quiz_closed" }, 400);

      if ((quiz as QuizRow).ox_mode === "deathmatch") {
        const questions = await loadQuestions(admin, question.quiz_id);
        const { data: ans, error: ae } = await admin.from("quiz_ox_answers").select("question_id, channel_id, choice, answered_at").eq("quiz_id", question.quiz_id);
        if (ae) throw new Error(`quiz_ox_answers 조회 실패: ${ae.message}`);
        const st = oxStandings(questions, (ans ?? []) as OxAnswerRow[], "deathmatch");
        if (!canAnswerOx("deathmatch", st, session.channelId)) return json({ error: "eliminated" }, 400);
      }

      const { error: ue2 } = await admin
        .from("quiz_ox_answers")
        .upsert({ quiz_id: question.quiz_id, question_id: questionId, channel_id: session.channelId, choice, answered_at: new Date().toISOString() }, { onConflict: "question_id,channel_id" });
      if (ue2) throw new Error(`응답 저장 실패: ${ue2.message}`);
      return json({ ok: true, choice }, 200);
    }

    return json({ error: "invalid_request" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "quiz_failed" }, 500);
  }
});
