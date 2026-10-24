// 유진고사(모의고사·OX 퀴즈) — 서버 응답 타입과 조회 훅. 서버는 quiz(시청자) / admin-quiz(관리자) 함수.
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API } from "./config";
import { apiFetch, useAuth } from "./auth";
import { supabase } from "./supabase";
import { useTableRefetch } from "./realtime";

// OX: 출제 후 이 시간 동안은 "곧 시작" 안내만 보여주고(방송 딜레이 여유), 그 뒤부터 제한시간을 셈. 서버의 OX_DELAY_GRACE_SEC와 같아야 함.
export const OX_READY_MS = 3000;

// OX 타이머 단계 — ready(곧 시작) → counting(남은 초) → closed
export function oxPhase(askedAt: string | null, closesAt: string | null, revealed: boolean, now: number) {
  if (revealed || !closesAt) return { phase: "closed" as const, left: 0, total: 1 };
  const end = new Date(closesAt).getTime();
  const start = askedAt ? new Date(askedAt).getTime() + OX_READY_MS : end;
  if (now >= end) return { phase: "closed" as const, left: 0, total: 1 };
  const total = Math.max(1, end - start);
  if (now < start) return { phase: "ready" as const, left: total, total, readyLeft: start - now };
  return { phase: "counting" as const, left: end - now, total };
}

export type QuizStatus = "draft" | "open" | "closed" | "revealed";
export type QType = "choice" | "image" | "short" | "ox";

type QuizBase = {
  id: number;
  title: string;
  subtitle: string;
  status: QuizStatus;
  isTest: boolean;
  oxMode: "score" | "deathmatch" | null;
  timeLimitSec: number;
  closesAt: string | null;
  revealedAt: string | null;
  rewardRanks: number[];
  rewardSurvivor: number;
  rewarded: boolean;
  myReward: { amount: number; label: string } | null;
};

export type ExamQuestion = {
  id: number;
  position: number;
  qtype: QType;
  prompt: string;
  imageUrl: string | null;
  choices: string[];
  // 결과 발표 후에만
  answer?: string;
  rate?: number;
  myCorrect?: boolean | null;
};

export type ExamView = QuizBase & {
  kind: "exam";
  questions: ExamQuestion[];
  participants: number;
  mine: { answers: Record<string, string>; submittedAt: string; score: number | null; rank: number | null; doodle?: Doodle | null } | null;
  ranking: { rank: number; name: string; score: number; isMe: boolean }[];
};

export type OxView = QuizBase & {
  kind: "ox";
  current: {
    id: number;
    number: number;
    prompt: string;
    imageUrl: string | null;
    askedAt: string | null;
    closesAt: string | null;
    closed: boolean;
    revealed: boolean;
    answer: "O" | "X" | null;
    counts: { O: number; X: number } | null;
    myChoice: "O" | "X" | null;
  } | null;
  me: { joined: boolean; alive: boolean; correct: number; canAnswer: boolean; history: { number: number; prompt: string; mine: "O" | "X" | null; answer: string; correct: boolean }[] };
  aliveCount: number;
  participants: number;
  revealedCount: number;
  ranking: { rank: number; name: string; correct: number; alive: boolean; isMe: boolean }[];
};

export type QuizView = ExamView | OxView;

export type QuizHistoryItem = {
  id: number;
  kind: "exam" | "ox";
  title: string;
  oxMode: "score" | "deathmatch" | null;
  revealedAt: string;
  isTest: boolean;
  score: number | null;
  rank: number | null;
  reward: { amount: number; label: string } | null;
};

// 메뉴에 띄울지(로그인 없이도) — 진행 중이거나 방금 끝난 회차가 있을 때만
export function useQuizPeek() {
  useTableRefetch("quiz_pings", [["quiz-peek"]], { event: "INSERT", filter: "kind=eq.state", minIntervalMs: 3000, settleMs: 400 });
  return useQuery({
    queryKey: ["quiz-peek"],
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch(`${API.quiz}?peek=1`);
      if (!res.ok) throw new Error(String(res.status));
      type Peek = { id: number; kind: "exam" | "ox"; title: string; status: QuizStatus } | null;
      return (await res.json()) as { active: Peek; recent?: Peek };
    },
  });
}

// 지금 회차(지난 기록은 빼고 — ?nohist=1). 지난 기록은 계산이 무거워서 useQuizHistory로 따로, 가끔만 받음.
// 회차·문제가 바뀌면(시작·출제·마감·정답 공개·보상) quiz_pings 실시간 신호로 바로 다시 불러옴(0077_quiz_pings.sql).
// 주기적으로 받는 건 신호를 놓쳤을 때 대비용 — OX 진행 중이면 15초, 아니면 60초.
// 회차 상태가 바뀌면(발표 등) 지난 기록을, 내 보상이 생기거나 바뀌면 보유 포인트(me)를 다시 불러옴.
export function useQuiz() {
  const { isLoggedIn, channelId } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["quiz", channelId],
    enabled: isLoggedIn,
    refetchInterval: (q) => {
      const vs = q.state.data?.quizzes ?? [];
      return vs.some((v) => v.kind === "ox" && v.status === "open") ? 15_000 : 60_000;
    },
    queryFn: () => apiFetch<{ quizzes: QuizView[]; history: QuizHistoryItem[] }>(`${API.quiz}?nohist=1`),
  });
  useTableRefetch("quiz_pings", [["quiz"], ["quiz-peek"], ["quiz-by-id"]], {
    event: "INSERT",
    filter: "kind=eq.state",
    minIntervalMs: 700,
    settleMs: 150,
    enabled: isLoggedIn,
  });

  const vs = q.data?.quizzes;
  // OX 문제가 시간이 다 돼서 마감될 땐 DB가 안 바뀌어서(신호 없음) 마감 시각에 맞춰 한 번 다시 받음 — O/X 몇 명인지 보이게
  const closeAt = vs?.map((v) => (v.kind === "ox" && v.status === "open" && v.current && !v.current.closed ? v.current.closesAt : null)).find(Boolean) ?? null;
  useEffect(() => {
    if (!closeAt) return;
    const ms = new Date(closeAt).getTime() - Date.now() + 600;
    if (ms < 0) return;
    const t = setTimeout(() => qc.invalidateQueries({ queryKey: ["quiz"] }), ms);
    return () => clearTimeout(t);
  }, [closeAt, qc]);
  const statusSig = vs ? vs.map((v) => `${v.id}:${v.status}`).join(",") : null;
  const rewardSig = vs ? vs.map((v) => (v.myReward ? `${v.id}:${v.myReward.amount}` : "")).join(",") : null;
  const prev = useRef<{ status: string | null; reward: string | null }>({ status: null, reward: null });
  useEffect(() => {
    const p = prev.current;
    prev.current = { status: statusSig, reward: rewardSig };
    if (p.status !== null && statusSig !== null && p.status !== statusSig) qc.invalidateQueries({ queryKey: ["quiz-history"] });
    if (p.reward !== null && rewardSig !== null && p.reward !== rewardSig) qc.invalidateQueries({ queryKey: ["me"] });
  }, [statusSig, rewardSig, qc]);

  return q;
}

// 내 지난 기록(?histOnly=1) — 자주 안 바뀌니 1분 캐시, 따로 폴링 안 함(회차 상태가 바뀌면 useQuiz가 다시 불러오게 함)
export function useQuizHistory() {
  const { isLoggedIn, channelId } = useAuth();
  return useQuery({
    queryKey: ["quiz-history", channelId],
    enabled: isLoggedIn,
    staleTime: 60_000,
    queryFn: () => apiFetch<{ quizzes: QuizView[]; history: QuizHistoryItem[] }>(`${API.quiz}?histOnly=1`),
  });
}

// 지난 회차 다시 보기
export function useQuizById(id: number | null) {
  const { isLoggedIn, channelId } = useAuth();
  return useQuery({
    queryKey: ["quiz-by-id", id, channelId],
    enabled: isLoggedIn && id != null,
    queryFn: () => apiFetch<{ quiz: QuizView | null }>(`${API.quiz}?quizId=${id}`),
  });
}

export const QUIZ_ERRORS: Record<string, string> = {
  quiz_closed: "제출이 마감됐어요.",
  already_submitted: "이미 제출했어요. 제출한 답안은 고칠 수 없어요.",
  question_closed: "이 문제는 마감됐어요.",
  eliminated: "탈락해서 더 풀 수 없어요.",
  quiz_not_found: "열린 퀴즈가 없어요.",
};

export const ADMIN_QUIZ_ERRORS: Record<string, string> = {
  invalid_title: "제목은 1~60자로 적어주세요.",
  invalid_prompt: "문제를 적어주세요.",
  invalid_choices: "보기 4개를 모두 채워주세요.",
  invalid_answer: "정답을 정해주세요.",
  invalid_reward: "보상 포인트를 다시 확인해주세요.",
  locked: "제출을 받기 시작한 뒤엔 문항을 추가·삭제하거나 유형을 바꿀 수 없어요.",
  no_questions: "문항을 하나 이상 만들어주세요.",
  other_running: "같은 종류의 회차가 이미 진행 중이에요. 그 회차를 먼저 끝내주세요.",
  already_open: "이미 시작한 회차예요.",
  not_open: "진행 중인 회차가 아니에요.",
  already_revealed: "이미 결과를 발표했어요.",
  not_revealed: "결과 발표 후에 지급할 수 있어요.",
  already_paid: "이미 보상을 지급했어요.",
  previous_not_revealed: "앞 문제의 정답을 먼저 공개해주세요.",
  not_deletable: "진행 중인 회차는 먼저 결과 발표까지 끝내고 지워주세요.",
  invalid_file: "PNG·JPG·WEBP·GIF 이미지만 올릴 수 있어요.",
};

// 문제 글의 __밑줄__ 표시 → 조각 배열(밑줄 여부)
export function underlineParts(text: string) {
  return text.split(/(__[^_]+__)/g).filter(Boolean).map((p) => (p.startsWith("__") && p.endsWith("__") ? { u: true, t: p.slice(2, -2) } : { u: false, t: p }));
}

// 투표(승부예측) 또는 미스테리 라디오 투표가 진행 중인지 — 메뉴에 "진행 중" 표시용.
// predictions는 공개 읽기 테이블, mystery_sets는 id·status·site_hidden 열만 공개(0098_mystery_public_status.sql).
export function usePredictionLive() {
  return useQuery({
    queryKey: ["prediction-live"],
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [p, m] = await Promise.all([
        supabase.from("predictions").select("id").eq("status", "open").gt("closes_at", new Date().toISOString()).limit(1),
        supabase.from("mystery_sets").select("id").eq("status", "open").eq("site_hidden", false).limit(1),
      ]);
      if (p.error) throw p.error;
      return (p.data ?? []).length > 0 || (!m.error && (m.data ?? []).length > 0);
    },
  });
}

// 시험지 낙서 — 고정 폭(880) 시험지 위의 펜 획 기록. { c: 색, s: 굵기, p: [x,y,x,y,…], e?: 1(지우개) }
export type DoodleOp = { c: string; s: number; p: number[]; e?: 1 };
export type Doodle = { w: number; h: number; ops: DoodleOp[] };
