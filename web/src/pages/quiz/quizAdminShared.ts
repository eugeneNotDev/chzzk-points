// 퀴즈 관리자 화면들(관리 탭·채점 방송·OX 방송)이 같이 쓰는 것들 — 타입, 서버 호출, 실시간 신호
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/auth";
import { API } from "../../lib/config";
import { toast } from "../../lib/dialog";
import { ADMIN_QUIZ_ERRORS, type QType, type QuizStatus } from "../../lib/quiz";
import { useTableRefetch } from "../../lib/realtime";

export type QuizRow = {
  id: number;
  kind: "exam" | "ox";
  title: string;
  subtitle: string;
  status: QuizStatus;
  is_test: boolean;
  ox_mode: "score" | "deathmatch" | null;
  reward_ranks: number[];
  reward_survivor: number;
  rewarded_at: string | null;
};
export type QuestionRow = {
  id: number;
  position: number;
  qtype: QType;
  prompt: string;
  image_url: string | null;
  choices: string[];
  answer: string;
  asked_at: string | null;
  revealed_at: string | null;
};
type Sheet = { id: number; name: string; submittedAt: string; answers: Record<string, string>; marks: Record<string, boolean>; picks: Record<string, string>; correct: number; marked: number; total: number };
type Payout = { channelId: string; channelName: string; amount: number; label: string };
export type Detail = {
  quiz: QuizRow;
  questions: QuestionRow[];
  payouts: Payout[];
  exam?: { sheets: Sheet[]; unmarked: number; ranking: { rank: number; name: string; score: number; marked: number }[] };
  ox?: {
    current: { id: number; number: number; prompt: string; answer: string; askedAt: string | null; closesAt: string | null; revealed: boolean; counts: { O: number; X: number } } | null;
    queue: { id: number; prompt: string; answer: string }[];
    players: { name: string; correct: number; alive: boolean; outAt: number | null; answeredCurrent: "O" | "X" | null }[];
    started: boolean;
    revealedCount: number;
  };
};
export type ListItem = { id: number; kind: "exam" | "ox"; title: string; status: QuizStatus; isTest: boolean; rewardedAt: string | null };

export const adminCall = <T,>(body: Record<string, unknown>) => apiFetch<T>(API.adminQuiz, { body });
export const errMsg = (e: unknown, fallback: string) => {
  const code = e instanceof ApiError ? String(e.body.error ?? "") : "";
  return ADMIN_QUIZ_ERRORS[code] || fallback;
};

export function useAct() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function act<T = unknown>(body: Record<string, unknown>, okMsg?: string): Promise<T | null> {
    setBusy(true);
    try {
      const r = await adminCall<T>(body);
      if (okMsg) toast(okMsg);
      return r;
    } catch (e) {
      toast(errMsg(e, "처리하지 못했어요. 다시 시도해주세요."), "error");
      return null;
    } finally {
      setBusy(false);
      ["quiz-admin", "quiz-admin-list", "quiz", "quiz-history", "quiz-peek"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    }
  }
  return { act, busy };
}

// 관리자 화면·방송 화면 — 이 회차의 무엇이든(상태·OX 답·답안 제출/채점) 바뀌면 quiz_pings 신호로 바로 다시 불러옴
export function useQuizAdminLive(quizId: number | null, minIntervalMs = 800) {
  useTableRefetch("quiz_pings", [["quiz-admin", quizId]], {
    event: "INSERT",
    filter: `quiz_id=eq.${quizId ?? 0}`,
    minIntervalMs,
    settleMs: 120,
    enabled: quizId != null,
  });
}

// 방송 화면 창 제목 — OBS 창 캡처에서 구분하기 쉽게 고정된 이름으로(사이트 기본 제목 "퀴즈 · 유진 팬보드"를 덮어씀)
export function useStreamTitle(title: string) {
  useEffect(() => {
    const t = window.setTimeout(() => (document.title = title), 0);
    return () => window.clearTimeout(t);
  }, [title]);
}
