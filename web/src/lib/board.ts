// 게시판(자유게시판 'free' — 익명, 방송 후기 'review' — 닉네임) 서버 호출과 공통 도구.
// 서버는 board Edge Function 하나 — 전부 POST { action, ... }.
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError, useAuth } from "./auth";
import { toast } from "./dialog";
import { API, STORAGE } from "./config";
import { readStorage, writeStorage } from "./storage";

export type BoardKind = "free" | "review";
export const BOARD_BUCKET = "board-images";
export const MAX_BOARD_IMAGES = 5;

export const BOARD_CFG: Record<BoardKind, { name: string; sub: string; write: string; path: string }> = {
  free: { name: "자유게시판", sub: "닉네임 없이 익명으로 남기는 공간이에요. 서로 배려해 주세요.", write: "글쓰기", path: "/board-free.html" },
  review: { name: "방송 후기", sub: "방송을 보고 느낀 점을 남겨주세요. 닉네임이 그대로 보여요.", write: "후기 쓰기", path: "/board-review.html" },
};

const ERR: Record<string, string> = {
  invalid_title: "제목은 1~60자로 입력해주세요.",
  invalid_body: "내용을 입력해주세요. (최대 5000자)",
  invalid_images: "이미지가 올바르지 않아요.",
  too_fast: "너무 빨라요. 잠시 후에 다시 시도해주세요.",
  already_reported: "이미 신고한 글이에요.",
  own_target: "내가 쓴 글은 신고할 수 없어요.",
  invalid_reason: "신고 사유를 골라주세요.",
  forbidden: "권한이 없어요.",
  not_found: "이미 삭제된 글이에요.",
  banned: "이용이 제한된 계정이에요.",
  unauthorized: "로그인이 필요해요.",
  unsupported_file_type: "지원하지 않는 이미지 형식이에요.",
  file_too_large: "이미지 용량이 너무 커요.",
};
export const boardErrText = (e: unknown) => {
  const code = e instanceof ApiError ? String(e.body.error ?? "") : "";
  return ERR[code] || "처리하지 못했어요. 잠시 후 다시 시도해주세요.";
};
export const boardErrCode = (e: unknown) => (e instanceof ApiError ? String(e.body.error ?? "") : "");

export const boardCall = <T>(payload: Record<string, unknown>) => apiFetch<T>(API.board, { body: payload });

export type Badge = { name: string; color: string } | null;

export type ListPost = {
  id: number;
  hidden: boolean;
  title: string;
  preview: string;
  author: string;
  staff: boolean;
  badge: Badge;
  adminName: string | null;
  broadcast: string | null;
  paid: boolean;
  commentCount: number;
  likeCount: number;
  hasImages: boolean;
  createdAt: string;
  mine: boolean;
};

export type BoardComment = {
  id: number;
  parentId: number | null;
  deleted: boolean;
  replyTo: string | null;
  body: string;
  hidden: boolean;
  reported: boolean;
  createdAt: string;
  author: string | null;
  avatar: string | null;
  avatarImg: string | null;
  op: boolean;
  staff: boolean;
  badge: Badge;
  adminName: string | null;
  likeCount: number;
  liked: boolean;
  mine: boolean;
  canDelete: boolean;
};

export type FullPost = {
  post: {
    id: number;
    board: BoardKind;
    hidden: boolean;
    reported: boolean;
    title: string;
    body: string;
    author: string;
    staff: boolean;
    badge: Badge;
    avatarImg: string | null;
    adminName: string | null;
    broadcast: string | null;
    paid: boolean;
    createdAt: string;
    updatedAt: string | null;
    likeCount: number;
    liked: boolean;
    mine: boolean;
    canDelete: boolean;
  };
  images: { path: string; url: string }[];
  comments: BoardComment[];
};

// N 표시: 올라온 지 24시간 이내 + 이 브라우저에서 아직 안 열어본 글(내 글 제외). 기존 사이트와 같은 저장 키.
export function loadSeen(): Set<number> {
  try {
    return new Set(JSON.parse(readStorage(STORAGE.boardSeen) || "[]"));
  } catch {
    return new Set();
  }
}
export function markSeen(id: number) {
  const arr = [...loadSeen().add(id)].slice(-300);
  writeStorage(STORAGE.boardSeen, JSON.stringify(arr));
}
export const isNewPost = (iso: string, id: number, seen: Set<number>, mine: boolean) => !mine && Date.now() - new Date(iso).getTime() < 24 * 3_600_000 && !seen.has(id);

export function boardTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "방금 전";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  if (diff < 172_800_000) return "어제";
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}일 전`;
  const k = new Date(d.getTime() + 9 * 3_600_000);
  return `${k.getUTCFullYear()}.${k.getUTCMonth() + 1}.${k.getUTCDate()}`;
}

// 본문 속 사진 자리 표시 — 글쓰기 편집칸이 저장할 때 "[[사진:n]]" 한 줄로 넣음(n = 이 글 사진 순서, 1부터)
export const IMG_MARK_RE = /\[\[사진:(\d+)\]\]/;
export const IMG_MARK_RE_G = /\[\[사진:\d+\]\]/g;

// 사진을 긴 변 1600px 이하 JPEG로(gif는 애니메이션 때문에 그대로)
export async function shrinkImage(file: File): Promise<File> {
  if (file.type === "image/gif") return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = no;
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.86));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const REPORT_REASONS: [string, string][] = [
  ["abuse", "욕설·비방"],
  ["spam", "도배·광고"],
  ["obscene", "음란·불쾌한 내용"],
  ["privacy", "개인정보 노출"],
  ["etc", "기타"],
];

// ── 목록 한 페이지(10개) 가져오기 — 서버 함수가 예전 버전이든 새 버전이든 똑같이 동작 ──
// 예전 서버: 한 페이지 20개 고정, 검색어(q)를 무시함, 글 수보다 뒤 페이지를 달라고 하면 오류.
// 새 서버: size(10/15/20/30)·q·field를 받음. 응답의 pageSize로 어느 쪽인지 알아냄.
export type BoardField = "title" | "all" | "author";
type ListRes = { posts: ListPost[]; total: number; pageSize: number };
export const LIST_PAGE = 10;

// 예전 서버일 때 검색용 — 그 게시판 글을 전부 받아 둠(30초 보관)
const allCache = new Map<string, { at: number; posts: ListPost[] }>();
async function fetchAllPosts(board: BoardKind) {
  const hit = allCache.get(board);
  if (hit && Date.now() - hit.at < 30_000) return hit.posts;
  const first = await boardCall<ListRes>({ action: "list", board, page: 0 });
  const ps = first.pageSize || 20;
  const pages = Math.ceil(first.total / ps);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => boardCall<ListRes>({ action: "list", board, page: i + 1 })));
  const posts = [first, ...rest].flatMap((r) => r.posts);
  allCache.set(board, { at: Date.now(), posts });
  return posts;
}
function matchLocal(p: ListPost, q: string, field: BoardField) {
  if (p.hidden) return false; // 가려진 글은 검색에 안 나옴(새 서버와 같게)
  const t = q.toLowerCase();
  if (field === "author") return (p.author || "").toLowerCase().includes(t);
  const inTitle = (p.title || "").toLowerCase().includes(t);
  return field === "all" ? inTitle || (p.preview || "").toLowerCase().includes(t) : inTitle;
}

export async function fetchBoardPage(board: BoardKind, page: number, q: string, field: BoardField) {
  const cut = (posts: ListPost[], from: number) => posts.slice(from, from + LIST_PAGE);
  if (!q) {
    // 20개씩 받아 10개씩 자름 — 항상 있는 범위만 요청
    const sp = Math.floor((page * LIST_PAGE) / 20);
    const r = await boardCall<ListRes>({ action: "list", board, page: sp, size: 20 });
    return { posts: cut(r.posts, page * LIST_PAGE - sp * 20), total: r.total };
  }
  if (field === "author" && board === "free") return { posts: [], total: 0 };
  // 검색은 30개씩 요청 — 새 서버면 pageSize 30이 돌아오고, 예전 서버면 20(검색어 무시)이라 구분됨
  const sp = Math.floor((page * LIST_PAGE) / 30);
  const r = await boardCall<ListRes>({ action: "list", board, page: sp, size: 30, q, field });
  if (r.pageSize === 30) return { posts: cut(r.posts, page * LIST_PAGE - sp * 30), total: r.total };
  const all = (await fetchAllPosts(board)).filter((p) => matchLocal(p, q, field));
  return { posts: cut(all, page * LIST_PAGE), total: all.length };
}

// ── 게시판 활동 보상(하루 글 3개·댓글 5개) ──
export type ActivityGrant = { amount: number; reason: string; used?: number; max?: number };
export type ActivityStatus = {
  date: string;
  post: { used: number; max: number; amount: number; minLen: number };
  comment: { used: number; max: number; amount: number; minLen: number; perPost: number };
};
// 서버가 예전 버전이면(이 기능 없음) 오류 → 칩을 안 보여줌
export function useBoardActivity() {
  const { isLoggedIn, channelId } = useAuth();
  return useQuery({
    queryKey: ["board", "activity", channelId],
    enabled: isLoggedIn,
    retry: false,
    staleTime: 30_000,
    queryFn: () => boardCall<ActivityStatus>({ action: "activity-status" }),
  });
}
// 글·댓글을 쓴 뒤 — 보상을 받았으면 알림, 남은 보상 칩·포인트 새로고침
export function afterActivity(qc: QueryClient, act: ActivityGrant | null | undefined, kind: "글" | "댓글") {
  if (!act) return;
  if (act.amount > 0) {
    toast(`게시판 활동 보상 +${act.amount}P (오늘 ${kind} ${act.used ?? "?"}/${act.max ?? "?"})`);
    qc.invalidateQueries({ queryKey: ["me"] });
  } else {
    // 보상이 없을 때도 이유를 알려줌(예전엔 아무 말이 없어서 "포인트가 안 들어온다"는 문의가 생김)
    const why: Record<string, string> = {
      too_short: kind === "글" ? "본문이 공백·사진 빼고 20자보다 짧아서 활동 보상은 없어요." : "댓글이 공백 빼고 5자보다 짧아서 활동 보상은 없어요.",
      daily_limit: `오늘 ${kind} 활동 보상은 이미 다 받았어요. 밤 12시에 다시 채워져요.`,
      per_post_limit: "같은 글에 단 댓글 보상은 2개까지예요.",
      own_post: "내 글에 단 내 댓글은 활동 보상이 없어요.",
    };
    if (why[act.reason]) toast(why[act.reason]);
  }
  qc.invalidateQueries({ queryKey: ["board", "activity"] });
}
