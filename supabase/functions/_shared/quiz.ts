// 유진고사(quiz / admin-quiz 함수) 공통 — 채점·순위·OX 생존 계산. DB 구조는 0072_quiz.sql.
import { getAdminClient, type Admin } from "./db.ts";

export { getAdminClient, type Admin };

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

export type SubmissionRow = {
  id: number;
  channel_id: string;
  answers: Record<string, string>;
  marks: Record<string, boolean>;
  submitted_at: string;
  score: number | null;
  rank: number | null;
};
export const SUBMISSION_COLS = "id, channel_id, answers, marks, submitted_at, score, rank";
export type OxAnswerRow = { question_id: number; channel_id: string; choice: "O" | "X"; answered_at: string };

// 단답 비교용 — 대소문자·띄어쓰기 무시
// 1000줄 넘게 나와도 다 받기(Supabase는 한 번에 1000줄까지만 줌) — page(from, to)는 정렬이 고정된 조회여야 함
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
  maxPages = 50,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await page(i * 1000, i * 1000 + 999);
    if (error) throw new Error(`${label} 조회 실패: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export const normAnswer = (s: string) => s.toLowerCase().replace(/\s+/g, "");

// "자동 채점" — 객관식은 정답 번호와 같으면, 단답은 기준 정답과(대소문자·띄어쓰기 무시) 같으면 맞음.
// 기본은 방송에서 한 문항씩 손으로 채점하고, 관리자가 자동 채점을 누른 시험지만 이걸로 채움.
export function autoMark(q: QuestionRow, given: string | undefined) {
  const v = (given ?? "").trim();
  if (!v) return false;
  if (q.qtype === "short") return normAnswer(v) === normAnswer(q.answer);
  return v === q.answer;
}

// 시험지 한 장의 채점 현황 — 맞은 수, 매긴 수
export function sheetTally(questions: QuestionRow[], marks: Record<string, boolean>) {
  let correct = 0;
  let marked = 0;
  for (const q of questions) {
    const m = marks[String(q.id)];
    if (m === true) correct += 1;
    if (m === true || m === false) marked += 1;
  }
  return { correct, marked, total: questions.length };
}

// 모의고사 순위 — 맞은 문항 수(배점 없음). 같으면 먼저 제출한 사람이 위.
export function scoreExam(questions: QuestionRow[], subs: SubmissionRow[]) {
  const scored = subs.map((s) => {
    const t = sheetTally(questions, s.marks ?? {});
    return { channelId: s.channel_id, submissionId: s.id, score: t.correct, correct: t.correct, marked: t.marked, submittedAt: s.submitted_at };
  });
  scored.sort((a, b) => b.score - a.score || a.submittedAt.localeCompare(b.submittedAt));
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
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

// 지금 화면에 띄울 회차 — 종류(모의고사/OX)마다 하나씩: 진행 중(open/closed)이거나 발표 후 30분 이내. 준비중(draft)은 안 보임.
// 모의고사는 며칠씩 열어두니까 그 사이에 OX를 따로 열 수 있음. 둘 다 있으면 OX가 먼저.
export async function findActiveQuizzes(admin: Admin): Promise<QuizRow[]> {
  const { data, error } = await admin.from("quizzes").select(QUIZ_COLS).neq("status", "draft").order("created_at", { ascending: false }).limit(10);
  if (error) throw new Error(`quizzes 조회 실패: ${error.message}`);
  const now = Date.now();
  const out: QuizRow[] = [];
  for (const kind of ["ox", "exam"] as const) {
    const q = ((data ?? []) as QuizRow[]).find(
      (x) => x.kind === kind && (x.status === "open" || x.status === "closed" || (x.status === "revealed" && !!x.revealed_at && now - new Date(x.revealed_at).getTime() < REVEALED_VISIBLE_MS)),
    );
    if (q) out.push(q);
  }
  return out;
}
