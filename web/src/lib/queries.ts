// 서버 데이터 조회 훅 모음(TanStack Query). 캐시·재시도·로딩 상태를 여기서 공통으로 처리함.
import { useQuery } from "@tanstack/react-query";
import { API, STORAGE } from "./config";
import { apiFetch, saveProfileImage, useAuth } from "./auth";
import { writeStorage } from "./storage";

export type Me = {
  channelId: string;
  channelName: string;
  profileImageUrl: string | null;
  isPublic: boolean;
  balance: number;
  maxBalanceReached: number;
  tierTitleName: string | null;
  tierTitleColor: string | null;
  selectedTitleId: string | null;
  rankKey?: string;
};

export function useMe() {
  const { isLoggedIn, token } = useAuth();
  return useQuery({
    queryKey: ["me", token],
    enabled: isLoggedIn,
    staleTime: 30_000,
    queryFn: async () => {
      const me = await apiFetch<Me>(API.me);
      // 기존 사이트와 같은 캐시 키에도 써둠(다른 탭·기존 사이트 상단바 표시용)
      writeStorage(STORAGE.balance, String(me.balance));
      if (typeof me.rankKey === "string") writeStorage(STORAGE.rankKey, me.rankKey);
      if ("profileImageUrl" in me) saveProfileImage(me.profileImageUrl);
      return me;
    },
  });
}

export function useBroadcastStatus() {
  return useQuery({
    queryKey: ["broadcast-status"],
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const res = await fetch(API.broadcastStatus);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { isLive: boolean; liveTitle: string | null };
    },
  });
}
