// 기록 옆 "잔액 N P" — ledger-balance 함수(0071_ledger_balances.sql)로 계산.
//  · useBalancesById(ids): 포인트 기록 줄이 반영된 직후 잔액(관리자 포인트 로그·유저 상세)
//  · useBalancesAt(times): 내 그 시각 잔액(미니게임 최근 기록 — 게임 기록과 포인트 기록은 같은 시각으로 남음)
// 잔액을 못 받아와도 화면은 그대로(잔액만 안 보임).
import { useQuery } from "@tanstack/react-query";
import { apiFetch, useAuth } from "./auth";
import { API } from "./config";

export function useBalancesById(ids: number[] | undefined) {
  const key = (ids ?? []).join(",");
  const q = useQuery({
    queryKey: ["ledger-balance", "id", key],
    enabled: !!key,
    staleTime: 60_000,
    queryFn: () => apiFetch<{ byId?: Record<string, number> }>(API.ledgerBalance, { body: { ids } }),
  });
  return q.data?.byId ?? {};
}

export function useBalancesAt(times: string[] | undefined) {
  const { isLoggedIn } = useAuth();
  const key = (times ?? []).join(",");
  const q = useQuery({
    queryKey: ["ledger-balance", "at", key],
    enabled: isLoggedIn && !!key,
    staleTime: 60_000,
    queryFn: () => apiFetch<{ byTime?: Record<string, number> }>(API.ledgerBalance, { body: { times } }),
  });
  return q.data?.byTime ?? {};
}
