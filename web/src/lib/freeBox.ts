import { useQuery } from "@tanstack/react-query";
import { API } from "./config";
import { apiFetch, useAuth } from "./auth";

export type FreeBoxState = {
  openedToday: boolean;
  todayPoints: number | null;
  balance: number;
  nextResetAt: string;
  serverNow: string;
  recent: { date: string; points: number }[];
};

export type FreeBoxOpenResult = { points: number; jackpot: boolean; balance: number; nextResetAt: string; serverNow: string };

export function useFreeBox() {
  const { isLoggedIn, channelId } = useAuth();
  return useQuery({
    queryKey: ["free-box", channelId],
    enabled: isLoggedIn,
    staleTime: 30_000,
    queryFn: () => apiFetch<FreeBoxState>(API.freeBox),
  });
}

export function openFreeBox() {
  return apiFetch<FreeBoxOpenResult>(API.freeBox, { method: "POST", body: {} });
}
