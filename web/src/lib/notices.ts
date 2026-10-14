// 공지사항 — 조회, 읽음 기록(NEW 표시), 본문 HTML 정리, 첨부파일.
import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { supabase } from "./supabase";
import { API, STORAGE, SUPABASE_URL } from "./config";
import { apiFetch } from "./auth";
import { readStorage, writeStorage } from "./storage";

export const NOTICE_BUCKET = "notice-attachments";
export const noticeAttachmentUrl = (path: string) =>
  `${SUPABASE_URL}/storage/v1/object/public/${NOTICE_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;

export type NoticeAttachment = {
  id: number;
  kind: "image" | "file";
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  sort_order: number;
};

export type Notice = {
  id: number;
  title: string | null;
  content: string | null;
  is_html: boolean;
  pinned_at: string | null;
  created_at: string;
  updated_at: string | null;
  notice_attachments: NoticeAttachment[];
};

const NOTICE_SELECT =
  "id, title, content, is_html, pinned_at, created_at, updated_at, notice_attachments(id, kind, file_name, storage_path, mime_type, size_bytes, sort_order)";

// 고정글 먼저(먼저 고정한 글이 위), 그 다음 최신순 — 0042_notice_pin.sql
export function useNotices(limit = 50) {
  return useQuery({
    queryKey: ["notices", "list", limit],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notices")
        .select(NOTICE_SELECT)
        .order("pinned_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("sort_order", { referencedTable: "notice_attachments", ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as Notice[];
    },
  });
}

// ── 읽음 기록(NEW) — 기존 사이트와 같은 저장 키라 기기에서 읽은 기록이 그대로 이어짐 ──
const NEW_WINDOW_MS = 3 * 86_400_000;
const readListeners = new Set<() => void>();
let readVersion = 0;

function readIds(): Set<string> {
  try {
    const arr = JSON.parse(readStorage(STORAGE.noticeReadIds) || "[]");
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

export function isNoticeNew(n: { id: number; created_at: string }) {
  const age = Date.now() - new Date(n.created_at).getTime();
  if (!(age > -5 * 60_000 && age < NEW_WINDOW_MS)) return false;
  return !readIds().has(String(n.id));
}

export function markNoticeRead(id: number) {
  const ids = [...readIds()].filter((x) => x !== String(id));
  ids.push(String(id));
  writeStorage(STORAGE.noticeReadIds, JSON.stringify(ids.slice(-100)));
  readVersion++;
  readListeners.forEach((l) => l());
}

// 읽음 기록이 바뀌면 다시 그려지게(NEW 표시·사이드바 점)
export function useNoticeReadVersion() {
  return useSyncExternalStore(
    (cb) => {
      readListeners.add(cb);
      return () => readListeners.delete(cb);
    },
    () => readVersion,
  );
}

// 사이드바 "공지사항" 옆 점 — 최근 3일 안의 글 중 안 읽은 게 있으면.
export function useHasNewNotice() {
  useNoticeReadVersion();
  const q = useQuery({
    queryKey: ["notices", "recent-ids"],
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - NEW_WINDOW_MS).toISOString();
      const { data, error } = await supabase.from("notices").select("id, created_at").gte("created_at", since).limit(50);
      if (error) throw error;
      return (data ?? []) as { id: number; created_at: string }[];
    },
  });
  return (q.data ?? []).some(isNoticeNew);
}

// ── HTML 본문 정리 ── 관리자만 쓰는 글이지만 혹시 모를 사고에 대비해 위험한 건 전부 걸러냄.
const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "p", "br", "hr", "b", "strong", "i", "em", "u", "s", "del", "mark", "small", "sub", "sup",
  "span", "div", "blockquote", "code", "pre", "ul", "ol", "li", "a", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "details", "summary",
];
const ALLOWED_ATTR = ["class", "style", "href", "src", "alt", "title", "width", "height", "colspan", "rowspan", "open", "start"];
let hookAdded = false;
export function sanitizeNoticeHtml(html: string) {
  if (!hookAdded) {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A" && node.getAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      if (node.tagName === "IMG") node.setAttribute("loading", "lazy");
    });
    hookAdded = true;
  }
  return DOMPurify.sanitize(String(html), { ALLOWED_TAGS, ALLOWED_ATTR, ADD_ATTR: ["target", "rel", "loading"] });
}

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── 관리자: 작성/수정/삭제/고정 ──
export type ApiAttachment = { path: string; fileName: string; mimeType: string; sizeBytes: number; kind: "image" | "file" };

export function saveNotice(id: number | null, body: { title: string; content: string; isHtml: boolean; pinned: boolean; attachments: ApiAttachment[] }) {
  return apiFetch(id ? `${API.notices}?id=${encodeURIComponent(id)}` : API.notices, { method: id ? "PATCH" : "POST", body });
}
export function deleteNotice(id: number) {
  return apiFetch(`${API.notices}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}
export function setNoticePin(id: number, pinned: boolean) {
  return apiFetch(API.notices, { method: "POST", body: { action: "set-pin", id, pinned } });
}

export const NOTICE_IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
export const NOTICE_FILE_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "hwp", "hwpx", "zip", "txt", "csv"]);
export const NOTICE_FILE_PICKER_EXT = new Set([...NOTICE_IMAGE_EXT, ...NOTICE_FILE_EXT]);
export const MAX_NOTICE_ATTACHMENTS = 10;

export const extOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
};

// 사진이 너무 크면(긴 변 1600px 초과 또는 1.5MB 초과) 줄이고 JPEG로 압축. gif는 애니메이션이 깨져서 그대로.
export async function maybeCompressImage(file: File): Promise<File> {
  if (extOf(file.name) === "gif") return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const longEdge = Math.max(bitmap.width, bitmap.height);
  if (longEdge <= 1600 && file.size <= 1.5 * 1024 * 1024) {
    bitmap.close?.();
    return file;
  }
  const scale = Math.min(1, 1600 / longEdge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

// 새로 고른 파일 업로드: signed URL 받기 → Storage에 직접 올리기 → API 형식으로 돌려줌.
export async function uploadNoticeFiles(pending: { file: File; kind: "image" | "file" }[]): Promise<ApiAttachment[]> {
  if (pending.length === 0) return [];
  const prepared = await Promise.all(pending.map(async (p) => ({ file: p.kind === "image" ? await maybeCompressImage(p.file) : p.file, kind: p.kind })));
  const { uploads } = await apiFetch<{ uploads: { path: string; token: string; fileName: string; kind: "image" | "file" }[] }>(API.notices, {
    body: { action: "get-upload-urls", files: prepared.map((p) => ({ fileName: p.file.name, sizeBytes: p.file.size, kind: p.kind })) },
  }).catch(() => {
    throw new Error("upload_urls_failed");
  });
  const results: ApiAttachment[] = [];
  for (let i = 0; i < uploads.length; i++) {
    const u = uploads[i];
    const file = prepared[i].file;
    const { error } = await supabase.storage.from(NOTICE_BUCKET).uploadToSignedUrl(u.path, u.token, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (error) throw new Error("upload_failed");
    results.push({ path: u.path, fileName: u.fileName, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, kind: u.kind });
  }
  return results;
}

export const toApiAttachment = (a: NoticeAttachment): ApiAttachment => ({
  path: a.storage_path,
  fileName: a.file_name,
  mimeType: a.mime_type,
  sizeBytes: a.size_bytes,
  kind: a.kind,
});
