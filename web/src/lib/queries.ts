// 서버 데이터 조회 훅 모음(TanStack Query). 캐시·재시도·로딩 상태를 여기서 공통으로 처리함.
import { useQuery } from "@tanstack/react-query";
import { API, STORAGE } from "./config";
import { apiFetch, saveProfileImage, useAuth } from "./auth";
import { writeStorage } from "./storage";
import { supabase } from "./supabase";

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
  purchasedTitleIds?: string[];
  // 관리자가 지급한 일반 칭호와 받은 시각(알림 종용 — 상점에서 산 건 빠짐)
  titleGrants?: { titleId: string; grantedAt: string }[];
  rankKey?: string;
  // 특수 칭호(닉네임 위 작은 글씨) — 하나 골라 장착. specialLocked면 관리자 고정 칭호라 못 바꿈.
  specialTitles?: SpecialOwned[];
  selectedSpecialId?: number | null;
  specialLocked?: boolean;
};
// bonusPct: 장착 중이면 출석·방송 코드·방송 후기·게시판 활동으로 버는 포인트 +n%
export type SpecialOwned = { id: number; name: string; color: string; forced: boolean; source: "admin" | "monthly"; bonusPct?: number; grantedAt: string };

export type TitleRow = { id: string; name: string; color: string; kind: string };

// 칭호 목록(titles 테이블, 공개 읽기) — 마이페이지 장착 목록·요약 카드에서 씀.
export function useTitles() {
  return useQuery({
    queryKey: ["titles"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("titles").select("id, name, color, kind").order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TitleRow[];
    },
  });
}

export function useMe() {
  const { isLoggedIn, channelId } = useAuth();
  return useQuery({
    queryKey: ["me", channelId],
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
      return (await res.json()) as { isLive: boolean; liveTitle: string | null; endedToday?: boolean };
    },
  });
}
