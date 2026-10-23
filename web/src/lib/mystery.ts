// 미스테리 라디오 연속 투표 — 서버(mystery 함수) 응답 타입과 호출. 진행(열기·마감·정답 공개·지급)은 미스테리 리모컨이 함.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { API } from "./config";
import { apiFetch, useAuth } from "./auth";
import { useTableRefetch } from "./realtime";

// 베타(/beta/) 빌드에서만 투표 탭에 뜸. 실제 사이트에 열 때 true로 바꾸고 build:live.
export const MYSTERY_ENABLED: boolean = import.meta.env.MODE !== "live";

export type MysteryQuestion = {
  id: number;
  position: number;
  prompt: string | null; // 아직 안 열린 투표는 문항을 안 보여줌(스포일러 방지)
  options: string[];
  status: "pending" | "open" | "closed";
  counts: number[];
  total: number;
  myChoice: number | null;
  answer: number | null; // 정답 공개 후에만
};

export type MysterySet = {
  id: number;
  title: string;
  status: "open" | "revealed" | "paid";
  isTest: boolean;
  betOpen: boolean;
  rewards: number[]; // 맞힌 개수(0개부터)별 기본 보상
  multipliers: number[]; // 맞힌 개수별 베팅 배수
  questions: MysteryQuestion[];
  myBet: { amount: number; payout: number | null } | null;
  myResult: { correct: number; base: number; betPayout: number | null } | null;
};

export function useMystery() {
  const { isLoggedIn, channelId } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["mystery", channelId],
    enabled: isLoggedIn && MYSTERY_ENABLED,
    // 실시간 신호를 놓쳤을 때 대비 — 투표 중이면 10초, 아니면 1분
    refetchInterval: (query) => (query.state.data?.set?.status === "open" ? 10_000 : 60_000),
    retry: false,
    queryFn: () => apiFetch<{ set: MysterySet | null }>(API.mystery),
  });
  // 투표 열기·마감·공개·지급, 다른 사람 투표가 들어오면 바로 다시 불러옴(0096_mystery_votes.sql의 mystery_pings)
  useTableRefetch("mystery_pings", [["mystery"]], { event: "INSERT", minIntervalMs: 1200, settleMs: 200, enabled: isLoggedIn && MYSTERY_ENABLED });

  // 지급이 끝나면 보유 포인트도 다시 불러옴
  const s = q.data?.set;
  const sig = s ? `${s.id}:${s.status}` : "";
  const prev = useRef<string | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = sig;
    if (p !== null && p !== sig && s?.status === "paid") qc.invalidateQueries({ queryKey: ["me"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, qc]);
  return q;
}

export const castMysteryVote = (questionId: number, choice: number) => apiFetch<{ ok: true }>(API.mystery, { body: { action: "vote", questionId, choice } });
export const placeMysteryBet = (setId: number, amount: number) =>
  apiFetch<{ ok: true; amount: number; balance: number; test: boolean }>(API.mystery, { body: { action: "bet", setId, amount } });

export const MYSTERY_ERRORS: Record<string, string> = {
  vote_closed: "이미 마감된 투표예요.",
  bet_closed: "베팅은 첫 번째 투표가 마감되기 전까지만 할 수 있어요.",
  insufficient_balance: "포인트가 부족해요.",
  amount_too_small: "100P 이상 입력해주세요.",
  too_many_requests: "잠시 후 다시 눌러주세요.",
};
