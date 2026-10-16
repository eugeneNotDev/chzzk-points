// 홈 화면에서 쓰는 데이터 조회(공지·랭킹·게시판·스케줄). 다른 페이지에서도 재사용할 수 있게 훅으로 분리.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { API, STORAGE } from "./config";
import { apiFetch, useAuth } from "./auth";
import { kstToday } from "./format";
import { readStorage } from "./storage";
import type { SpecialTitle } from "../components/TitleBadge";

export type NoticeRow = { id: number; title: string | null; pinned_at: string | null; created_at: string };

export function useNoticePreview(limit = 5) {
  return useQuery({
    queryKey: ["notices", "preview", limit],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notices")
        .select("id, title, pinned_at, created_at")
        .order("pinned_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as NoticeRow[];
    },
  });
}

export type RankingRow = {
  channel_id: string;
  channel_name: string | null;
  total_points: number;
  is_public: boolean;
  tier_title_name: string | null;
  tier_title_color: string | null;
  shop_title_name: string | null;
  shop_title_color: string | null;
  special_titles: SpecialTitle[] | null;
  admin_view?: boolean;
};

// 관리자면 비공개 유저도 실제 이름으로(admin-ranking), 아니면 공개 랭킹 뷰.
export function useRanking(limit: number) {
  const { isAdmin, token } = useAuth();
  return useQuery({
    queryKey: ["ranking", limit, isAdmin ? token : "public"],
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      if (isAdmin) {
        try {
          const body = await apiFetch<{ rows: RankingRow[] }>(`${API.adminRanking}?limit=${limit}`);
          if (Array.isArray(body.rows)) return body.rows.map((r) => ({ ...r, admin_view: true }));
        } catch {
          /* 공개 랭킹으로 */
        }
      }
      const { data, error } = await supabase
        .from("ranking")
        .select("channel_id, channel_name, total_points, is_public, tier_title_name, tier_title_color, shop_title_name, shop_title_color, special_titles")
        .order("total_points", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as RankingRow[];
    },
  });
}

export function isMyRankingRow(row: RankingRow, myChannelId: string | null) {
  if (!myChannelId || !row.channel_id) return false;
  if (row.channel_id === myChannelId) return true;
  const rankKey = readStorage(STORAGE.rankKey);
  return !!rankKey && row.channel_id === rankKey;
}

export type BoardPost = {
  id: number;
  hidden: boolean;
  title: string;
  author: string;
  staff: boolean;
  commentCount: number;
  likeCount: number;
  hasImages: boolean;
  createdAt: string;
  mine: boolean;
  board: "free" | "review";
};

async function fetchBoard(board: "free" | "review") {
  const data = await apiFetch<{ posts: Omit<BoardPost, "board">[] }>(API.board, { body: { action: "list", board, page: 0 } });
  return (data.posts ?? []).filter((p) => !p.hidden).map((p) => ({ ...p, board }));
}

export function useBoardPreview(tab: "all" | "free" | "review", limit = 5) {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["board", "preview", tab, limit, token],
    staleTime: 30_000,
    queryFn: async () => {
      const posts =
        tab === "all"
          ? (await Promise.all([fetchBoard("free"), fetchBoard("review")])).flat().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
          : await fetchBoard(tab);
      return posts.slice(0, limit);
    },
  });
}

export function isBoardPostNew(p: BoardPost) {
  if (p.mine || Date.now() - new Date(p.createdAt).getTime() >= 86_400_000) return false;
  try {
    const seen = JSON.parse(readStorage(STORAGE.boardSeen) || "[]");
    return !(Array.isArray(seen) && seen.includes(p.id));
  } catch {
    return true;
  }
}

export type ScheduleRow = { day: string; kind: "live" | "off" | string; start_time: string | null; title: string | null; memo: string | null };

export function useUpcomingSchedule() {
  return useQuery({
    queryKey: ["schedule", "upcoming"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const today = kstToday();
      const { data, error } = await supabase
        .from("broadcast_schedule")
        .select("day, kind, start_time, title, memo")
        .gte("day", today)
        .order("day", { ascending: true })
        .limit(14);
      if (error) throw error;
      const rows = (data ?? []) as ScheduleRow[];
      return {
        today: rows.find((r) => r.day === today) ?? null,
        next: rows.find((r) => r.day > today && r.kind === "live") ?? null,
      };
    },
  });
}
