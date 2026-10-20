// 유진고사 — 관리자 전용(유진 알파 계정). 회차 만들기·문항 편집·진행·채점·결과 발표·보상 지급. 전부 POST { action, ... }.
//
// 조회
//   list                          → { quizzes: [{ id, kind, title, status, isTest, oxMode, createdAt, participants }] }
//   get { quizId }                → { quiz, questions(정답 포함), exam?: { sheets, ranking, unmarked }, ox?: { current, players, queue }, payouts }
// 회차
//   create { kind, title, subtitle?, isTest?, oxMode?, timeLimitSec?, rewardRanks?, rewardSurvivor? } → { id }
//   update { quizId, title?, subtitle?, isTest?, oxMode?, timeLimitSec?, rewardRanks?, rewardSurvivor? }
//   delete { quizId }             → 진행 중(제출 받는 중·채점 중)인 실제 회차만 빼고 지울 수 있음. 이미 지급한 포인트는 그대로 남음
// 문항(모의고사)
//   save-question { quizId, question: { id?, qtype, prompt, imageUrl?, choices, answer } } → { id }
//   delete-question { questionId } / reorder { quizId, ids }
//   upload-url { fileName, contentType } → { path, token, publicUrl }  (이미지는 브라우저가 Storage에 직접 올림)
// 진행
//   open { quizId }               → 모의고사: 제출 받기 시작(제한시간 없음) / OX: 진행 시작
//   close { quizId }              → 모의고사 제출 마감 → 채점 단계
//   mark { submissionId, questionId, correct: true | false | null } → 시험지 한 장의 한 문항 ○/✕(null이면 지움) — 단답형
//   mark { submissionId, questionId, pick: "1"~"4" | null }      → 객관식: 관리자가 고른 번호가 정답, 제출한 번호와 같으면 맞음(null이면 지움)
//   auto-mark { submissionId } | { quizId, onlyEmpty: true } → 자동 채점(그 시험지 전체 / 전체 시험지의 안 매긴 칸만)
//   reveal { quizId }             → 모의고사: 맞은 수로 순위 확정하고 결과 발표(안 매긴 칸은 틀림) / OX: 종료
//   pay { quizId }                → 보상 지급(테스트 회차면 기록만) → { ok, test, count, total, payouts }
// OX
//   ox-add { quizId, prompt, answer? }          → 대기열에 문제 추가 → { id }
//   ox-ask { quizId, questionId? | prompt, answer?, seconds } → 출제(마감 = 지금 + seconds + 딜레이 여유)
//   ox-close { questionId }                     → 지금 마감
//   ox-reveal { questionId, answer: "O" | "X" } → 정답 공개(데스매치면 틀린 사람 탈락)
//   ox-cancel { questionId }                    → 잘못 낸 문제 취소(응답 삭제, 대기열로)

import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";
import {
  autoMark,
  buildPayouts,
  fetchAll,
  getAdminClient,
  loadNames,
  OX_DELAY_GRACE_SEC,
  oxStandings,
  QUESTION_COLS,
  QUIZ_COLS,
  scoreExam,
  sheetTally,
  SUBMISSION_COLS,
  type Admin,
  type OxAnswerRow,
  type QuestionRow,
  type QuizRow,
  type SubmissionRow,
} from "../_shared/quiz.ts";

const BUCKET = "quiz-images";
type Sub = SubmissionRow & { picks: Record<string, string> };
const isChoice = (q: QuestionRow) => q.qtype === "choice" || q.qtype === "image";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
class Bad extends Error {}
function bad(code: string): never {
  throw new Bad(code);
}

async function getQuiz(admin: Admin, quizId: unknown): Promise<QuizRow> {
  const id = Number(quizId);
  if (!Number.isInteger(id)) bad("invalid_request");
  const { data, error } = await admin.from("quizzes").select(QUIZ_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(`quizzes 조회 실패: ${error.message}`);
  if (!data) bad("quiz_not_found");
  return data as QuizRow;
}

async function getQuestion(admin: Admin, questionId: unknown): Promise<QuestionRow> {
  const id = Number(questionId);
  if (!Number.isInteger(id)) bad("invalid_request");
  const { data, error } = await admin.from("quiz_questions").select(QUESTION_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(`quiz_questions 조회 실패: ${error.message}`);
  if (!data) bad("question_not_found");
  return data as QuestionRow;
}

async function loadQuestions(admin: Admin, quizId: number) {
  const { data, error } = await admin.from("quiz_questions").select(QUESTION_COLS).eq("quiz_id", quizId).order("position", { ascending: true }).order("id", { ascending: true });
  if (error) throw new Error(`quiz_questions 조회 실패: ${error.message}`);
  return (data ?? []) as QuestionRow[];
}
async function loadSubs(admin: Admin, quizId: number) {
  return await fetchAll<Sub>((a, b) => admin.from("quiz_exam_submissions").select(`${SUBMISSION_COLS}, picks`).eq("quiz_id", quizId).order("submitted_at", { ascending: true }).order("id").range(a, b), "quiz_exam_submissions");
}
async function loadOxAnswers(admin: Admin, quizId: number) {
  return await fetchAll<OxAnswerRow>((a, b) => admin.from("quiz_ox_answers").select("question_id, channel_id, choice, answered_at").eq("quiz_id", quizId).order("id").range(a, b), "quiz_ox_answers");
}

async function upd(admin: Admin, table: string, id: number, patch: Record<string, unknown>) {
  const { error } = await admin.from(table).update(patch).eq("id", id);
  if (error) throw new Error(`${table} 수정 실패: ${error.message}`);
}

// 입력 검사 — 회차 설정
function quizFields(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || body.title !== undefined) {
    const t = typeof body.title === "string" ? body.title.trim() : "";
    if (t.length < 1 || t.length > 60) bad("invalid_title");
    out.title = t;
  }
  if (body.subtitle !== undefined) {
    const s = typeof body.subtitle === "string" ? body.subtitle.trim() : "";
    if (s.length > 30) bad("invalid_subtitle");
    out.subtitle = s;
  }
  if (body.isTest !== undefined) out.is_test = body.isTest === true;
  if (body.oxMode !== undefined) {
    if (body.oxMode !== "score" && body.oxMode !== "deathmatch") bad("invalid_mode");
    out.ox_mode = body.oxMode;
  }
  if (body.timeLimitSec !== undefined) {
    const n = Number(body.timeLimitSec);
    if (!Number.isInteger(n) || n < 60 || n > 7200) bad("invalid_time");
    out.time_limit_sec = n;
  }
  if (body.rewardRanks !== undefined) {
    const arr = Array.isArray(body.rewardRanks) ? body.rewardRanks.map(Number) : [];
    if (arr.length > 20 || arr.some((n) => !Number.isInteger(n) || n < 0 || n > 1_000_000)) bad("invalid_reward");
    out.reward_ranks = arr;
  }
  if (body.rewardSurvivor !== undefined) {
    const n = Number(body.rewardSurvivor);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) bad("invalid_reward");
    out.reward_survivor = n;
  }
  return out;
}

// 입력 검사 — 모의고사 문항
function questionFields(q: Record<string, unknown>) {
  const qtype = q.qtype;
  if (qtype !== "choice" && qtype !== "image" && qtype !== "short") bad("invalid_qtype");
  const prompt = typeof q.prompt === "string" ? q.prompt.trim() : "";
  if (prompt.length < 1 || prompt.length > 300) bad("invalid_prompt");
  const imageUrl = typeof q.imageUrl === "string" && /^https:\/\//.test(q.imageUrl) ? q.imageUrl : null;
  let choices: string[] = [];
  let answer = typeof q.answer === "string" ? q.answer.trim() : "";
  if (qtype === "short") {
    if (answer.length < 1 || answer.length > 100) bad("invalid_answer");
  } else {
    choices = Array.isArray(q.choices) ? q.choices.map((c) => (typeof c === "string" ? c.trim() : "")) : [];
    if (choices.length !== 4 || choices.some((c) => c.length < 1 || c.length > (qtype === "image" ? 500 : 80))) bad("invalid_choices");
    if (qtype === "image" && choices.some((c) => !/^https:\/\//.test(c))) bad("invalid_choices");
    if (!["1", "2", "3", "4"].includes(answer)) bad("invalid_answer");
  }
  if (qtype !== "short") answer = String(answer);
  return { qtype, prompt, image_url: imageUrl, choices, answer, points: 1, grading: "manual" };
}

async function nextPosition(admin: Admin, quizId: number) {
  const { data } = await admin.from("quiz_questions").select("position").eq("quiz_id", quizId).order("position", { ascending: false }).limit(1).maybeSingle();
  return (data?.position ?? 0) + 1;
}

// 관리자 화면에 필요한 것 전부(정답 포함)
async function detail(admin: Admin, quiz: QuizRow) {
  const questions = await loadQuestions(admin, quiz.id);
  const base = { quiz, questions };

  if (quiz.kind === "exam") {
    const subs = await loadSubs(admin, quiz.id);
    const ranked = scoreExam(questions, subs);
    const names = await loadNames(admin, subs.map((s) => s.channel_id), true);
    const sheets = subs.map((s) => ({ id: s.id, name: names.get(s.channel_id) ?? "", submittedAt: s.submitted_at, answers: s.answers, marks: s.marks ?? {}, picks: s.picks ?? {}, ...sheetTally(questions, s.marks ?? {}) }));
    return {
      ...base,
      exam: {
        sheets,
        unmarked: sheets.reduce((n, x) => n + (x.total - x.marked), 0),
        ranking: ranked.slice(0, 50).map((r) => ({ rank: r.rank, name: names.get(r.channelId) ?? "", score: r.score, marked: r.marked, submittedAt: r.submittedAt })),
      },
      payouts: quiz.reward_log ?? buildPayouts(quiz, ranked, [], names),
    };
  }

  const answers = await loadOxAnswers(admin, quiz.id);
  const st = oxStandings(questions, answers, quiz.ox_mode);
  const names = await loadNames(admin, st.players.map((p) => p.channelId), true);
  const asked = questions.filter((q) => q.asked_at).sort((a, b) => a.asked_at!.localeCompare(b.asked_at!));
  const cur = asked[asked.length - 1] ?? null;
  const curAns = cur ? answers.filter((a) => a.question_id === cur.id) : [];
  const ranked = st.players.map((p, i) => ({ channelId: p.channelId, rank: i + 1 }));
  const survivors = st.started ? st.players.filter((p) => p.alive).map((p) => p.channelId) : [];
  return {
    ...base,
    ox: {
      current: cur
        ? {
            id: cur.id,
            number: asked.length,
            prompt: cur.prompt,
            answer: cur.answer,
            askedAt: cur.asked_at,
            closesAt: cur.closes_at,
            revealed: !!cur.revealed_at,
            counts: { O: curAns.filter((a) => a.choice === "O").length, X: curAns.filter((a) => a.choice === "X").length },
          }
        : null,
      queue: questions.filter((q) => !q.asked_at).map((q) => ({ id: q.id, prompt: q.prompt, answer: q.answer })),
      players: st.players.map((p) => ({ name: names.get(p.channelId) ?? "", correct: p.correct, alive: p.alive, outAt: p.outAt, answeredCurrent: curAns.find((a) => a.channel_id === p.channelId)?.choice ?? null })),
      started: st.started,
      revealedCount: st.revealedCount,
    },
    payouts: quiz.reward_log ?? buildPayouts(quiz, ranked, survivors, names),
  };
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const session = await requireSession(req);
  if (!session) return json({ error: "unauthorized" }, 401);
  if (session.channelId !== OWNER_CHANNEL_ID) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  try {
    const admin = getAdminClient();
    const now = new Date();

    switch (body.action) {
      case "list": {
        const { data, error } = await admin.from("quizzes").select("id, kind, title, status, is_test, ox_mode, rewarded_at, created_at").order("created_at", { ascending: false }).limit(50);
        if (error) throw new Error(`quizzes 조회 실패: ${error.message}`);
        return json({ quizzes: (data ?? []).map((q) => ({ id: q.id, kind: q.kind, title: q.title, status: q.status, isTest: q.is_test, oxMode: q.ox_mode, rewardedAt: q.rewarded_at, createdAt: q.created_at })) }, 200);
      }

      case "get":
        return json(await detail(admin, await getQuiz(admin, body.quizId)), 200);

      case "create": {
        if (body.kind !== "exam" && body.kind !== "ox") bad("invalid_kind");
        const fields = quizFields(body, false);
        if (body.kind === "ox" && !fields.ox_mode) fields.ox_mode = "deathmatch";
        if (body.kind === "exam") delete fields.ox_mode;
        const { data, error } = await admin.from("quizzes").insert({ kind: body.kind, ...fields }).select("id").single();
        if (error) throw new Error(`quizzes 생성 실패: ${error.message}`);
        return json({ id: data.id }, 200);
      }

      case "update": {
        const quiz = await getQuiz(admin, body.quizId);
        const fields = quizFields(body, true);
        if (quiz.status !== "draft") delete fields.time_limit_sec;
        if (quiz.rewarded_at) {
          delete fields.reward_ranks;
          delete fields.reward_survivor;
          delete fields.is_test;
        }
        if (Object.keys(fields).length) await upd(admin, "quizzes", quiz.id, fields);
        return json({ ok: true }, 200);
      }

      case "delete": {
        const quiz = await getQuiz(admin, body.quizId);
        if ((quiz.status === "open" || quiz.status === "closed") && !quiz.is_test) bad("not_deletable");
        const { error } = await admin.from("quizzes").delete().eq("id", quiz.id);
        if (error) throw new Error(`quizzes 삭제 실패: ${error.message}`);
        return json({ ok: true }, 200);
      }

      case "save-question": {
        const quiz = await getQuiz(admin, body.quizId);
        if (quiz.kind !== "exam") bad("invalid_request");
        if (quiz.status === "revealed") bad("already_revealed");
        const fields = questionFields(body.question ?? {});
        const qid = Number(body.question?.id);
        if (Number.isInteger(qid) && qid > 0) {
          const existing = await getQuestion(admin, qid);
          if (existing.quiz_id !== quiz.id) bad("invalid_request");
          // 응시가 시작된 뒤엔 유형은 못 바꿈(이미 낸 답과 안 맞게 되니까) — 오타·정답 수정만
          if (quiz.status !== "draft" && existing.qtype !== fields.qtype) bad("locked");
          await upd(admin, "quiz_questions", qid, fields);
          return json({ id: qid }, 200);
        }
        if (quiz.status !== "draft") bad("locked");
        const { data, error } = await admin.from("quiz_questions").insert({ quiz_id: quiz.id, position: await nextPosition(admin, quiz.id), ...fields }).select("id").single();
        if (error) throw new Error(`문항 추가 실패: ${error.message}`);
        return json({ id: data.id }, 200);
      }

      case "delete-question": {
        const q = await getQuestion(admin, body.questionId);
        const quiz = await getQuiz(admin, q.quiz_id);
        if (quiz.kind === "exam" ? quiz.status !== "draft" : !!q.asked_at) bad("locked");
        const { error } = await admin.from("quiz_questions").delete().eq("id", q.id);
        if (error) throw new Error(`문항 삭제 실패: ${error.message}`);
        return json({ ok: true }, 200);
      }

      case "reorder": {
        const quiz = await getQuiz(admin, body.quizId);
        const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
        const questions = await loadQuestions(admin, quiz.id);
        const own = new Set(questions.map((q) => q.id));
        if (ids.length !== own.size || ids.some((id: number) => !own.has(id))) bad("invalid_request");
        for (let i = 0; i < ids.length; i++) await upd(admin, "quiz_questions", ids[i], { position: i + 1 });
        return json({ ok: true }, 200);
      }

      case "upload-url": {
        const type = String(body.contentType ?? "");
        const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[type];
        if (!ext) bad("invalid_file");
        const path = `${now.toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
        const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
        if (error || !data) throw new Error(`업로드 주소 발급 실패: ${error?.message}`);
        const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        return json({ path, token: data.token, publicUrl }, 200);
      }

      case "open": {
        const quiz = await getQuiz(admin, body.quizId);
        if (quiz.status !== "draft") bad("already_open");
        // 종류마다 한 번에 하나만 — 같은 종류의 다른 회차가 진행 중이면 막음(모의고사가 열려 있는 동안 OX는 따로 열 수 있음)
        const { data: running } = await admin.from("quizzes").select("id").eq("kind", quiz.kind).in("status", ["open", "closed"]).neq("id", quiz.id).limit(1);
        if (running && running.length) bad("other_running");
        if (quiz.kind === "exam") {
          const qs = await loadQuestions(admin, quiz.id);
          if (qs.length === 0) bad("no_questions");
          await upd(admin, "quizzes", quiz.id, { status: "open", opened_at: now.toISOString(), closes_at: null });
        } else {
          await upd(admin, "quizzes", quiz.id, { status: "open", opened_at: now.toISOString() });
        }
        return json({ ok: true }, 200);
      }

      case "close": {
        const quiz = await getQuiz(admin, body.quizId);
        if (quiz.kind !== "exam" || quiz.status !== "open") bad("not_open");
        await upd(admin, "quizzes", quiz.id, { status: "closed", closed_at: now.toISOString(), closes_at: now.toISOString() });
        return json({ ok: true }, 200);
      }

      case "mark": {
        const sid = Number(body.submissionId);
        const q = await getQuestion(admin, body.questionId);
        if (!Number.isInteger(sid)) bad("invalid_request");
        const { data: sub, error } = await admin.from("quiz_exam_submissions").select("id, quiz_id, answers, marks, picks").eq("id", sid).maybeSingle();
        if (error) throw new Error(`quiz_exam_submissions 조회 실패: ${error.message}`);
        if (!sub || sub.quiz_id !== q.quiz_id) bad("invalid_request");
        const quiz = await getQuiz(admin, q.quiz_id);
        if (quiz.rewarded_at) bad("already_paid");
        const k = String(q.id);
        const marks = { ...(sub!.marks ?? {}) } as Record<string, boolean>;
        const picks = { ...(sub!.picks ?? {}) } as Record<string, string>;
        if ("pick" in body && isChoice(q)) {
          // 객관식 — 관리자가 고른 번호가 정답. 시청자가 낸 번호와 같으면 맞음
          if (["1", "2", "3", "4"].includes(body.pick)) {
            picks[k] = body.pick;
            marks[k] = (sub!.answers as Record<string, string>)?.[k] === body.pick;
          } else {
            delete picks[k];
            delete marks[k];
          }
        } else if (body.correct === true || body.correct === false) {
          marks[k] = body.correct;
          delete picks[k];
        } else {
          delete marks[k];
          delete picks[k];
        }
        await upd(admin, "quiz_exam_submissions", sid, { marks, picks });
        if (quiz.status === "revealed") await finalizeExam(admin, quiz);
        return json({ ok: true, marks }, 200);
      }

      case "auto-mark": {
        let quizId: number;
        let targets: Sub[];
        if (body.submissionId !== undefined) {
          const sid = Number(body.submissionId);
          const { data, error } = await admin.from("quiz_exam_submissions").select(`quiz_id, ${SUBMISSION_COLS}, picks`).eq("id", sid).maybeSingle();
          if (error) throw new Error(`quiz_exam_submissions 조회 실패: ${error.message}`);
          if (!data) bad("invalid_request");
          quizId = (data as { quiz_id: number }).quiz_id;
          targets = [data as unknown as Sub];
        } else {
          quizId = (await getQuiz(admin, body.quizId)).id;
          targets = await loadSubs(admin, quizId);
        }
        const quiz = await getQuiz(admin, quizId);
        if (quiz.kind !== "exam" || quiz.rewarded_at) bad("invalid_request");
        const questions = await loadQuestions(admin, quizId);
        const onlyEmpty = body.onlyEmpty === true;
        for (const t of targets) {
          const marks = { ...(t.marks ?? {}) };
          const picks = { ...(t.picks ?? {}) };
          for (const q of questions) {
            if (onlyEmpty && (marks[String(q.id)] === true || marks[String(q.id)] === false)) continue;
            marks[String(q.id)] = autoMark(q, t.answers[String(q.id)]);
            if (isChoice(q)) picks[String(q.id)] = q.answer;
          }
          await upd(admin, "quiz_exam_submissions", t.id, { marks, picks });
        }
        if (quiz.status === "revealed") await finalizeExam(admin, quiz);
        return json({ ok: true, count: targets.length }, 200);
      }

      case "reveal": {
        const quiz = await getQuiz(admin, body.quizId);
        if (quiz.status === "revealed") bad("already_revealed");
        if (quiz.status === "draft") bad("not_open");
        if (quiz.kind === "exam") {
          if (quiz.status === "open") await upd(admin, "quizzes", quiz.id, { status: "closed", closed_at: now.toISOString(), closes_at: now.toISOString() });
          await finalizeExam(admin, quiz);
        } else {
          // 공개 안 한 채 남은 문제는 마감만 하고 종료
          await admin.from("quiz_questions").update({ closes_at: now.toISOString() }).eq("quiz_id", quiz.id).not("asked_at", "is", null).is("revealed_at", null);
        }
        await upd(admin, "quizzes", quiz.id, { status: "revealed", revealed_at: now.toISOString(), closed_at: quiz.closed_at ?? now.toISOString() });
        return json({ ok: true }, 200);
      }

      case "pay": {
        const quiz = await getQuiz(admin, body.quizId);
        const d = await detail(admin, quiz);
        const payouts = d.payouts;
        const { data, error } = await admin.rpc("quiz_pay_rewards", { p_quiz_id: quiz.id, p_payouts: payouts });
        if (error) throw new Error(`quiz_pay_rewards 실패: ${error.message}`);
        if (data?.error) bad(String(data.error));
        return json({ ...data, payouts }, 200);
      }

      case "ox-add": {
        const quiz = await getQuiz(admin, body.quizId);
        if (quiz.kind !== "ox" || quiz.status === "revealed") bad("invalid_request");
        const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
        if (prompt.length < 1 || prompt.length > 200) bad("invalid_prompt");
        const answer = body.answer === "O" || body.answer === "X" ? body.answer : "";
        const { data, error } = await admin.from("quiz_questions").insert({ quiz_id: quiz.id, position: await nextPosition(admin, quiz.id), qtype: "ox", prompt, answer, points: 1 }).select("id").single();
        if (error) throw new Error(`문제 추가 실패: ${error.message}`);
        return json({ id: data.id }, 200);
      }

      case "ox-ask": {
        const quiz = await getQuiz(admin, body.quizId);
        if (quiz.kind !== "ox" || quiz.status !== "open") bad("not_open");
        const seconds = Number(body.seconds ?? 10);
        if (!Number.isInteger(seconds) || seconds < 3 || seconds > 120) bad("invalid_request");
        const { data: pending } = await admin.from("quiz_questions").select("id").eq("quiz_id", quiz.id).not("asked_at", "is", null).is("revealed_at", null).limit(1);
        if (pending && pending.length) bad("previous_not_revealed");
        let qid = Number(body.questionId);
        if (!Number.isInteger(qid) || qid <= 0) {
          const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
          if (prompt.length < 1 || prompt.length > 200) bad("invalid_prompt");
          const answer = body.answer === "O" || body.answer === "X" ? body.answer : "";
          const { data, error } = await admin.from("quiz_questions").insert({ quiz_id: quiz.id, position: await nextPosition(admin, quiz.id), qtype: "ox", prompt, answer, points: 1 }).select("id").single();
          if (error) throw new Error(`문제 추가 실패: ${error.message}`);
          qid = data.id;
        } else {
          const q = await getQuestion(admin, qid);
          if (q.quiz_id !== quiz.id || q.asked_at) bad("invalid_request");
        }
        await upd(admin, "quiz_questions", qid, {
          asked_at: now.toISOString(),
          closes_at: new Date(now.getTime() + (seconds + OX_DELAY_GRACE_SEC) * 1000).toISOString(),
          revealed_at: null,
        });
        return json({ id: qid }, 200);
      }

      case "ox-close": {
        const q = await getQuestion(admin, body.questionId);
        if (!q.asked_at || q.revealed_at) bad("invalid_request");
        if (!q.closes_at || new Date(q.closes_at) > now) await upd(admin, "quiz_questions", q.id, { closes_at: now.toISOString() });
        return json({ ok: true }, 200);
      }

      case "ox-reveal": {
        const q = await getQuestion(admin, body.questionId);
        if (!q.asked_at || q.revealed_at) bad("invalid_request");
        const answer = body.answer === "O" || body.answer === "X" ? body.answer : q.answer;
        if (answer !== "O" && answer !== "X") bad("invalid_answer");
        const closesAt = q.closes_at && new Date(q.closes_at) < now ? q.closes_at : now.toISOString();
        await upd(admin, "quiz_questions", q.id, { answer, revealed_at: now.toISOString(), closes_at: closesAt });
        return json({ ok: true }, 200);
      }

      case "ox-cancel": {
        const q = await getQuestion(admin, body.questionId);
        if (!q.asked_at || q.revealed_at) bad("invalid_request");
        const { error } = await admin.from("quiz_ox_answers").delete().eq("question_id", q.id);
        if (error) throw new Error(`응답 삭제 실패: ${error.message}`);
        await upd(admin, "quiz_questions", q.id, { asked_at: null, closes_at: null });
        return json({ ok: true }, 200);
      }

      default:
        return json({ error: "invalid_request" }, 400);
    }
  } catch (err) {
    if (err instanceof Bad) {
      console.warn(`admin-quiz ${body.action} 거절: ${err.message}`);
      return json({ error: err.message }, 400);
    }
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "admin_quiz_failed" }, 500);
  }
});

// 모의고사 점수(맞은 수)·순위를 계산해서 답안에 저장
async function finalizeExam(admin: Admin, quiz: QuizRow) {
  const questions = await loadQuestions(admin, quiz.id);
  const subs = await loadSubs(admin, quiz.id);
  for (const r of scoreExam(questions, subs)) {
    await upd(admin, "quiz_exam_submissions", r.submissionId, { score: r.score, rank: r.rank });
  }
}
