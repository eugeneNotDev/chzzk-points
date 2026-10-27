// 룰렛·가위바위보·홀짝·양 로켓 공통 — 상태 조회, 걸 포인트 검사, 결과 후 대기(서버 쿨타임과 맞춤), 에러 문구.
// 결과는 항상 서버(DB 함수)가 정하고 화면은 연출만 함.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError, getChannelId, useAuth } from "../../lib/auth";
import { fmt } from "../../lib/format";

export const MIN_BET = 100;
export const MAX_BET = 400_000_000; // 서버가 받는 최대(기술적 한계)
export const AFTER_RESULT_WAIT_MS = 2000;
export const REDUCED_MOTION = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export type GameStateBase = {
  balance: number;
  maxBalanceReached: number;
  requiredPoints: number;
  requiredTierName: string | null;
  eligible: boolean;
  blocked: boolean;
  blockedUntil: string | null;
  minBet: number;
  cooldownSeconds: number;
  recent: unknown[];
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useMinigame<S extends GameStateBase>(url: string, name: string) {
  const { isLoggedIn, channelId } = useAuth();
  const qc = useQueryClient();
  const key = ["minigame", url, channelId];
  const q = useQuery({ queryKey: key, enabled: isLoggedIn, staleTime: 0, queryFn: () => apiFetch<S>(url) });
  const [bet, setBetRaw] = useState(MIN_BET);
  const [waitUntil, setWaitUntil] = useState(0);
  const [, force] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const state = q.data;
  const balance = state?.balance ?? 0;

  // 처음 들어왔을 때 서버 쿨타임이 남아 있으면 그만큼 대기
  useEffect(() => {
    if (state?.cooldownSeconds) startWait(state.cooldownSeconds * 1000);
  }, [state?.cooldownSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  function startWait(ms: number) {
    const until = Date.now() + ms;
    setWaitUntil(until);
    setTimeout(() => alive.current && force((n) => n + 1), ms + 30);
  }

  const waiting = Date.now() < waitUntil;

  let hint = `최소 ${fmt(MIN_BET)}P부터 걸 수 있어요`;
  let bad = false;
  let soft = true; // 등급/차단 안내는 빨간 글씨 아님
  if (state?.blocked) [bad, hint] = [true, "미니게임 참여가 제한된 계정이에요"];
  else if (!state) [bad, hint] = [true, q.isError ? "게임 정보를 불러오지 못했어요" : "불러오는 중…"];
  else if (!state.eligible) [bad, hint] = [true, `${state.requiredTierName || "브론즈"} 등급부터 할 수 있어요`];
  else {
    soft = false;
    if (balance < MIN_BET) [bad, hint] = [true, `${fmt(MIN_BET)}P 이상 있어야 할 수 있어요`];
    else if (bet < MIN_BET) [bad, hint] = [true, `${fmt(MIN_BET)}P 이상 걸어야 해요`];
    else if (bet > balance) [bad, hint] = [true, "보유 포인트보다 많이 걸 수 없어요"];
    else if (bet > MAX_BET) [bad, hint] = [true, `한 번에 ${fmt(MAX_BET)}P까지 걸 수 있어요`];
  }

  const canPlay = !bad && !playing && !waiting;

  const setBet = useCallback((v: number) => setBetRaw(Math.max(0, Math.floor(v))), []);

  // 결과 반영 — 잔액·최고 잔액·최근 기록(최대 10개)
  function applyResult(newBalance: number, recentItem: unknown) {
    qc.setQueryData<S>(key, (prev) =>
      prev ? { ...prev, balance: newBalance, maxBalanceReached: Math.max(prev.maxBalanceReached, newBalance), recent: [recentItem, ...prev.recent].slice(0, 10) } : prev,
    );
    qc.setQueryData(["me", getChannelId()], (prev: { balance: number } | undefined) => (prev ? { ...prev, balance: newBalance } : prev));
    if (alive.current && bet > newBalance) setBetRaw(Math.max(MIN_BET, Math.min(bet, newBalance)));
  }

  // 잔액만 바꿀 때(양 로켓 발사처럼 기록은 아직 안 생길 때)
  function setBalance(newBalance: number) {
    qc.setQueryData<S>(key, (prev) => (prev ? { ...prev, balance: newBalance } : prev));
    qc.setQueryData(["me", getChannelId()], (prev: { balance: number } | undefined) => (prev ? { ...prev, balance: newBalance } : prev));
  }

  // 공통 실패 처리 — 문구 + 필요하면 상태 다시 받기
  function handleError(e: unknown) {
    const code = e instanceof ApiError ? String(e.body.error ?? "") : "network";
    if (code === "cooldown") {
      const s = e instanceof ApiError ? Number(e.body.retryAfterSeconds) || 1 : 1;
      setError(`너무 빨라요. ${s}초 뒤에 다시 해주세요.`);
      startWait(s * 1000);
    } else if (code === "insufficient_balance") setError("포인트가 부족해요.");
    else if (code === "tier_required") setError(`${state?.requiredTierName || "브론즈"} 등급부터 할 수 있어요.`);
    else if (code === "minigame_blocked") setError("미니게임 참여가 제한된 계정이에요.");
    else if (code === "invalid_bet") setError(`${fmt(MIN_BET)}P 이상 걸어야 해요.`);
    else if (code === "not_today") setError("오늘의 미니게임이 바뀌었어요. 새로고침해 주세요.");
    else if (code !== "banned" && code !== "unauthorized") setError(`${name}을(를) 하지 못했어요. 다시 시도해주세요.`);
    if (["insufficient_balance", "tier_required", "minigame_blocked"].includes(code)) qc.invalidateQueries({ queryKey: key });
  }

  return {
    isLoggedIn,
    query: q,
    state,
    balance,
    bet,
    setBet,
    hint,
    hintBad: bad && !soft,
    canPlay,
    playing,
    setPlaying,
    waiting,
    error,
    setError,
    startWait,
    applyResult,
    setBalance,
    handleError,
    alive,
  };
}

export type Minigame = ReturnType<typeof useMinigame>;
