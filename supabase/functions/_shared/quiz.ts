// 유진고사(quiz / admin-quiz 함수) 공통 — 채점·순위·OX 생존 계산. DB 구조는 0072_quiz.sql.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

export function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, key);
}
export type Admin = ReturnType<typeof getAdminClient>;

// OX 응답 마감에 더해주는 방송 딜레이 여유(초) — 시청자 화면에선 이만큼 늦게 문제가 보이니까.
export const OX_DELAY_GRACE_SEC = 3;
// 모의고사 마감 직후 늦게 도착한 제출을 받아주는 여유(초)
export const EXAM_SUBMIT_GRACE_SEC = 5;
// 결과 발표 후 이 시간 동안은 메뉴·화면에 "방금 끝난 회차"로 계속 보여줌
export const REVEALED_VISIBLE_MS = 30 * 60_000;

export type QuizRow = {
  id: number;
  kind: "exam" | "ox";
  title: string;
  subtitle: string;
  status: "draft" | "open" | "closed" | "revealed";
  is_test: boolean;
  ox_mode: "score" | "deathmatch" | null;
  time_limit_sec: number;
  reward_ranks: number[];
  reward_survivor: number;
  opened_at: string | null;
  closes_at: string | null;
  closed_at: string | null;
  revealed_at: string | null;
  rewarded_at: string | null;
  reward_log: { channelId: string; channelName: string; amount: number; label: string }[] | null;
  created_at: string;
};
export const QUIZ_COLS =
  "id, kind, title, subtitle, status, is_test, ox_mode, time_limit_sec, reward_ranks, reward_survivor, opened_at, closes_at, closed_at, revealed_at, rewarded_at, reward_log, created_at";

export type QuestionRow = {
  id: number;
  quiz_id: number;
  position: number;
  qtype: "choice" | "image" | "short" | "ox";
  prompt: string;
  image_url: string | null;
  choices: string[];
  answer: string;
  points: number;
  grading: "auto" | "manual";
  asked_at: string | null;
  closes_at: string | null;
  revealed_at: string | null;
};
export const QUESTION_COLS = "id, quiz_id, position, qtype, prompt, image_url, choices, answer, points, grading, asked_at, closes_at, revealed_at";

export type SubmissionRow = { channel_id: string; answers: Record<string, string>; submitted_at: string; score: number | null; rank: number | null };
export type OxAnswerRow = { question_id: number; channel_id: string; choice: "O" | "X"; answered_at: string };

// 단답 비교용 — 대소문자·띄어쓰기 무시
export const normAnswer = (s: string) => s.toLowerCase().replace(/\s+/g, "");

// 단답 채점표: 문항 id → (정규화한 답 → 정답 여부). 표에 없으면 기준 정답과 같은지로 판단.
export type Grades = Map<number, Map<string, boolean>>;

export async function loadGrades(admin: Admin, questionIds: number[]): Promise<Grades> {
  const out: Grades = new Map();
  if (questionIds.length === 0) return out;
  const { data, error } = await admin.from("quiz_short_grades").select("question_id, norm_answer, correct").in("question_id", questionIds);
  if (error) throw new Error(`quiz_short_grades 조회 실패: ${error.message}`);
  for (const g of data ?? []) {
    if (!out.has(g.question_id)) out.set(g.question_id, new Map());
    out.get(g.question_id)!.set(g.norm_answer, g.correct);
  }
  return out;
}

// 한 문항이 맞았는지 — null이면 아직 채점 안 된 단답(수동 채점 문항에서 기준 정답과 다른 답)
export function isCorrect(q: QuestionRow, given: string | undefined, grades: Grades): boolean | null {
  if (given === undefined || given === "") return false;
  if (q.qtype === "short") {
    const n = normAnswer(given);
    const g = grades.get(q.id)?.get(n);
    if (g !== undefined) return g;
    if (n === normAnswer(q.answer)) return true;
    return q.grading === "manual" ? null : false;
  }
  return given === q.answer;
}

// 모의고사 점수·순위. 같은 점수면 먼저 제출한 사람이 위.
export function scoreExam(questions: QuestionRow[], subs: SubmissionRow[], grades: Grades) {
  const scored = subs.map((s) => {
    let score = 0;
    let correct = 0;
    for (const q of questions) {
      if (isCorrect(q, s.answers[String(q.id)], grades) === true) {
        score += q.points;
        correct += 1;
      }
    }
    return { channelId: s.channel_id, score, correct, submittedAt: s.submitted_at };
  });
  scored.sort((a, b) => b.score - a.score || a.submittedAt.localeCompare(b.submittedAt));
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}

// 단답 문항의 답 묶음(관리자 채점 화면) — 같은 답끼리 몇 명인지 + 지금 정답/오답/미채점
export function shortGroups(q: QuestionRow, subs: SubmissionRow[], grades: Grades) {
  const groups = new Map<string, { norm: string; display: string; count: number }>();
  for (const s of subs) {
    const raw = (s.answers[String(q.id)] ?? "").trim();
    if (!raw) continue;
    const n = normAnswer(raw);
    const g = groups.get(n);
    if (g) g.count += 1;
    else groups.set(n, { norm: n, display: raw, count: 1 });
  }
  return [...groups.values()]
    .map((g) => {
      const explicit = grades.get(q.id)?.get(g.norm);
      const isKey = g.norm === normAnswer(q.answer);
      const state: "correct" | "wrong" | "pending" =
        explicit === true ? "correct" : explicit === false ? "wrong" : isKey ? "correct" : q.grading === "manual" ? "pending" : "wrong";
      return { norm: g.norm, display: g.display, count: g.count, isKey, state };
    })
    .sort((a, b) => Number(b.isKey) - Number(a.isKey) || b.count - a.count);
}

// OX 진행 상황 — 공개된 문제 순서대로 따라가며 사람별 맞힌 수·생존 여부를 계산.
//  데스매치: 첫 공개 문제에서 맞힌 사람이 생존자로 시작, 이후 공개 문제를 틀리거나 안 풀면 탈락.
//  점수전: 맞힌 수(동점이면 마지막으로 맞힌 시각이 빠른 사람이 위).
export function oxStandings(questions: QuestionRow[], answers: OxAnswerRow[], mode: QuizRow["ox_mode"]) {
  const revealed = questions.filter((q) => q.revealed_at && (q.answer === "O" || q.answer === "X")).sort((a, b) => a.revealed_at!.localeCompare(b.revealed_at!));
  const byQ = new Map<number, Map<string, OxAnswerRow>>();
  for (const a of answers) {
    if (!byQ.has(a.question_id)) byQ.set(a.question_id, new Map());
    byQ.get(a.question_id)!.set(a.channel_id, a);
  }
  const players = new Map<string, { channelId: string; correct: number; lastCorrectAt: string; alive: boolean; outAt: number | null }>();
  for (const a of answers) {
    if (!players.has(a.channel_id)) players.set(a.channel_id, { channelId: a.channel_id, correct: 0, lastCorrectAt: "", alive: false, outAt: null });
  }
  let started = false;
  revealed.forEach((q, i) => {
    const ans = byQ.get(q.id) ?? new Map();
    for (const p of players.values()) {
      const a = ans.get(p.channelId);
      const ok = !!a && a.choice === q.answer;
      if (ok) {
        p.correct += 1;
        if (a.answered_at > p.lastCorrectAt) p.lastCorrectAt = a.answered_at;
      }
      if (!started) {
        p.alive = ok;
        if (!ok && a) p.outAt = i + 1;
      } else if (p.alive && !ok) {
        p.alive = false;
        p.outAt = i + 1;
      }
    }
    started = true;
  });
  const list = [...players.values()];
  const byScore = (a: (typeof list)[number], b: (typeof list)[number]) => b.correct - a.correct || a.lastCorrectAt.localeCompare(b.lastCorrectAt);
  list.sort(mode === "deathmatch" ? (a, b) => Number(b.alive) - Number(a.alive) || byScore(a, b) : byScore);
  return { revealedCount: revealed.length, players: list, started };
}

// 데스매치에서 지금 답할 수 있는지 — 아직 공개된 문제가 없으면 누구나, 이후엔 생존자만
export function canAnswerOx(mode: QuizRow["ox_mode"], standings: ReturnType<typeof oxStandings>, channelId: string) {
  if (mode !== "deathmatch" || !standings.started) return true;
  return standings.players.find((p) => p.channelId === channelId)?.alive === true;
}

// 순위 보상 표 → 지급 목록. 데스매치는 생존자 전원 reward_survivor.
export function buildPayouts(
  quiz: QuizRow,
  ranked: { channelId: string; rank: number }[],
  survivors: string[],
  names: Map<string, string>,
) {
  if (quiz.kind === "ox" && quiz.ox_mode === "deathmatch") {
    return survivors.map((id) => ({ channelId: id, channelName: names.get(id) ?? "", amount: quiz.reward_survivor, label: "최후 생존" }));
  }
  return ranked
    .filter((r) => r.rank <= quiz.reward_ranks.length && quiz.reward_ranks[r.rank - 1] > 0)
    .map((r) => ({ channelId: r.channelId, channelName: names.get(r.channelId) ?? "", amount: quiz.reward_ranks[r.rank - 1], label: `${r.rank}등` }));
}

// 이름표: 공개 설정한 사람만 닉네임, 아니면 "비공개"(랭킹과 같은 원칙). adminView면 전부 실제 닉네임.
export async function loadNames(admin: Admin, ids: string[], adminView: boolean) {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data, error } = await admin.from("users").select("channel_id, channel_name, is_public").in("channel_id", ids);
  if (error) throw new Error(`users 조회 실패: ${error.message}`);
  for (const u of data ?? []) out.set(u.channel_id, adminView || u.is_public ? (u.channel_name ?? "이름 없음") : "비공개");
  return out;
}

// 지금 화면에 띄울 회차 — 진행 중(open/closed)이거나 발표 후 30분 이내. 준비중(draft)은 관리자만.
export async function findActiveQuiz(admin: Admin): Promise<QuizRow | null> {
  const { data, error } = await admin.from("quizzes").select(QUIZ_COLS).neq("status", "draft").order("created_at", { ascending: false }).limit(5);
  if (error) throw new Error(`quizzes 조회 실패: ${error.message}`);
  const now = Date.now();
  for (const q of (data ?? []) as QuizRow[]) {
    if (q.status === "open" || q.status === "closed") return q;
    if (q.status === "revealed" && q.revealed_at && now - new Date(q.revealed_at).getTime() < REVEALED_VISIBLE_MS) return q;
  }
  return null;
}
