// 알림 종 — 세 가지를 모아서 최신순으로:
//   1) 새 공지(최근 3일)  2) 내 글 댓글 · 내 댓글 답글(board 함수 notifications, 최근 30일)  3) 내가 참여한 투표 결과
//   4) 새로 받은 칭호(최근 14일) → 누르면 마이페이지 칭호 창
//      · 특수 칭호: 관리자 지급·지난달 순위(me의 specialTitles.grantedAt)
//      · 일반 칭호: 관리자가 지급한 것만(me의 titleGrants — 상점에서 직접 산 건 본인이 아니까 뺌)
// 읽음은 서버에 저장하지 않고 이 브라우저가 "마지막으로 알림을 열어본 시각"으로 판단(그 뒤에 생긴 게 새 알림).
import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, useAuth } from "./auth";
import { API } from "./config";
import { boardCall } from "./board";
import { useNotices } from "./notices";
import { useMe, useTitles } from "./queries";
import { readStorage, writeStorage } from "./storage";

const SEEN_KEY = "chzzk_points_notif_seen_at";
const NOTICE_WINDOW_MS = 3 * 86_400_000;
const PRED_WINDOW_MS = 3 * 86_400_000;
const TITLE_WINDOW_MS = 14 * 86_400_000;

export type Notif = {
  id: string;
  kind: "notice" | "comment" | "reply" | "predict" | "title";
  title: string;
  body: string;
  to: string;
  at: string;
};

type BoardNotif = { id: number; kind: "comment" | "reply"; postId: number; board: "free" | "review"; postTitle: string; body: string; author: string; createdAt: string };
type PredLite = {
  id: number;
  title: string;
  status: "open" | "resolved" | "cancelled";
  resolvedAt: string | null;
  cancelledAt: string | null;
  winningOptionId: number | null;
  options: { id: number; label: string }[];
  myBet: { optionId: number; amount: number; payout: number | null } | null;
};

let seenListeners = new Set<() => void>();
const readSeen = () => Number(readStorage(SEEN_KEY) || 0);
let seenAt = readSeen();
export function markNotificationsSeen() {
  seenAt = Date.now();
  writeStorage(SEEN_KEY, String(seenAt));
  seenListeners.forEach((l) => l());
}
function useSeenAt() {
  return useSyncExternalStore(
    (l) => {
      seenListeners.add(l);
      return () => seenListeners.delete(l);
    },
    () => seenAt,
  );
}

export function useNotifications() {
  const { isLoggedIn, token } = useAuth();
  const seen = useSeenAt();
  const notices = useNotices(10);
  const me = useMe();
  const titles = useTitles();
  const board = useQuery({
    queryKey: ["notifications", "board", token],
    enabled: isLoggedIn,
    staleTime: 60_000,
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
    queryFn: () => boardCall<{ items: BoardNotif[] }>({ action: "notifications" }),
  });
  const pred = useQuery({
    queryKey: ["prediction", token],
    enabled: isLoggedIn,
    staleTime: 60_000,
    queryFn: () => apiFetch<{ prediction: PredLite | null }>(API.predictions),
  });

  const items: Notif[] = [];
  const now = Date.now();
  for (const n of notices.data ?? []) {
    if (now - new Date(n.created_at).getTime() > NOTICE_WINDOW_MS) continue;
    items.push({ id: `n-${n.id}`, kind: "notice", title: "새 공지", body: n.title || "(제목 없음)", to: `/notice.html?id=${n.id}`, at: n.created_at });
  }
  for (const c of board.data?.items ?? []) {
    const path = c.board === "review" ? "/board-review.html" : "/board-free.html";
    items.push({
      id: `c-${c.id}`,
      kind: c.kind,
      title: c.kind === "reply" ? "내 댓글에 답글이 달렸어요" : "내 글에 댓글이 달렸어요",
      body: `${c.author === "익명" ? "" : `${c.author}: `}${c.body} · ${c.postTitle}`,
      to: `${path}?post=${c.postId}`,
      at: c.createdAt,
    });
  }
  const p = pred.data?.prediction;
  if (p && p.myBet && p.status !== "open") {
    const at = (p.status === "resolved" ? p.resolvedAt : p.cancelledAt) ?? "";
    if (at && now - new Date(at).getTime() < PRED_WINDOW_MS) {
      const win = p.status === "resolved" && p.myBet.optionId === p.winningOptionId;
      const body =
        p.status === "cancelled"
          ? `"${p.title}" 투표가 취소돼서 ${p.myBet.amount.toLocaleString("ko-KR")}P를 돌려받았어요.`
          : p.winningOptionId === null
            ? `"${p.title}" 적중자가 없어서 환불됐어요.`
            : win
              ? `"${p.title}" 적중! +${(p.myBet.payout ?? 0).toLocaleString("ko-KR")}P`
              : `"${p.title}" 아쉽게 빗나갔어요. 정답: ${p.options.find((o) => o.id === p.winningOptionId)?.label ?? "-"}`;
      items.push({ id: `p-${p.id}-${p.status}`, kind: "predict", title: "투표 결과", body, to: "/predict.html", at });
    }
  }
  for (const t of me.data?.specialTitles ?? []) {
    if (!t.grantedAt || now - new Date(t.grantedAt).getTime() > TITLE_WINDOW_MS) continue;
    items.push({
      id: `t-${t.id}`,
      kind: "title",
      title: "특수 칭호를 받았어요",
      body: `${t.name}${t.bonusPct ? ` · 적립 +${t.bonusPct}%` : ""} — 눌러서 장착할 수 있어요`,
      to: "/mypage.html?titles=special",
      at: t.grantedAt,
    });
  }
  for (const g of me.data?.titleGrants ?? []) {
    if (!g.grantedAt || now - new Date(g.grantedAt).getTime() > TITLE_WINDOW_MS) continue;
    const name = titles.data?.find((t) => t.id === g.titleId)?.name;
    if (!name) continue;
    items.push({
      id: `g-${g.titleId}`,
      kind: "title",
      title: "칭호를 받았어요",
      body: `${name} — 눌러서 장착할 수 있어요`,
      to: "/mypage.html?titles=title",
      at: g.grantedAt,
    });
  }
  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const unread = items.filter((i) => new Date(i.at).getTime() > seen).length;
  return { items, unread, seen, loading: notices.isLoading || board.isLoading };
}
