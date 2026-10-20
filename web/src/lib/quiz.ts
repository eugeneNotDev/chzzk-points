// 유진고사(모의고사·OX 퀴즈) — 서버 응답 타입과 조회 훅. 서버는 quiz(시청자) / admin-quiz(관리자) 함수.
import { useQuery } from "@tanstack/react-query";
import { API } from "./config";
import { apiFetch, useAuth } from "./auth";
import { supabase } from "./supabase";

// 베타(/beta/) 빌드에서만 메뉴·화면이 들어감. 실제 사이트(npm run build:live)에선 아예 빠짐.
// 테스트가 끝나면 이 줄을 true로 바꾸고 build:live 하면 실제 사이트에 적용됨.
export const QUIZ_ENABLED = import.meta.env.MODE !== "live";

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
  mine: { answers: Record<string, string>; submittedAt: string; score: number | null; rank: number | null } | null;
  ranking: { rank: number; name: string; score: number; isMe: boolean }[];
};

export type OxView = QuizBase & {
  kind: "ox";
  current: {
    id: number;
    number: number;
    prompt: string;
    imageUrl: string | null;
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
  return useQuery({
    queryKey: ["quiz-peek"],
    enabled: QUIZ_ENABLED,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch(`${API.quiz}?peek=1`);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { active: { id: number; kind: "exam" | "ox"; title: string; status: QuizStatus } | null };
    },
  });
}

// 지금 회차 + 내 지난 기록. OX가 진행 중이면 1.5초마다, 모의고사는 며칠씩 열려 있으니 30초마다 새로 받음.
export function useQuiz() {
  const { isLoggedIn, token } = useAuth();
  return useQuery({
    queryKey: ["quiz", token],
    enabled: isLoggedIn && QUIZ_ENABLED,
    refetchInterval: (q) => {
      const vs = q.state.data?.quizzes ?? [];
      if (vs.some((v) => v.kind === "ox" && v.status === "open")) return 1500;
      return vs.length ? 30_000 : 15_000;
    },
    queryFn: () => apiFetch<{ quizzes: QuizView[]; history: QuizHistoryItem[] }>(API.quiz),
  });
}

// 지난 회차 다시 보기
export function useQuizById(id: number | null) {
  const { isLoggedIn, token } = useAuth();
  return useQuery({
    queryKey: ["quiz-by-id", id, token],
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
  not_deletable: "준비 중이거나 테스트 회차만 지울 수 있어요.",
  invalid_file: "PNG·JPG·WEBP·GIF 이미지만 올릴 수 있어요.",
};

// 문제 글의 __밑줄__ 표시 → 조각 배열(밑줄 여부)
export function underlineParts(text: string) {
  return text.split(/(__[^_]+__)/g).filter(Boolean).map((p) => (p.startsWith("__") && p.endsWith("__") ? { u: true, t: p.slice(2, -2) } : { u: false, t: p }));
}

// 투표(승부예측) 진행 중인지 — 메뉴에 "진행 중" 표시용. predictions는 공개 읽기 테이블.
export function usePredictionLive() {
  return useQuery({
    queryKey: ["prediction-live"],
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("predictions").select("id").eq("status", "open").gt("closes_at", new Date().toISOString()).limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },
  });
}
