// 게시판(자유게시판 'free' — 익명, 방송 후기 'review' — 닉네임) 서버 호출과 공통 도구.
// 서버는 board Edge Function 하나 — 전부 POST { action, ... }.
import { apiFetch, ApiError } from "./auth";
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
