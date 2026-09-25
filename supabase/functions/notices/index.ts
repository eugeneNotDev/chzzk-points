// 공지사항 작성/수정/삭제 (관리자 전용) + 첨부파일 업로드용 signed URL 발급.
// 목록 읽기는 프론트에서 anon 키로 notices/notice_attachments 테이블을 직접 조회하면
// 되니까(RLS가 전체 공개, notice_attachments도 마찬가지 — 0031_notice_attachments.sql
// 참고), 이 함수는 쓰기 계열만 처리함.
//
// POST body에 action이 있으면 그 action을 처리하고, 없으면 기존처럼 새 공지 작성으로 취급함.
//
// POST   { title, content, attachments? }                       → 새 공지 작성
// POST   { action: "get-upload-urls", files: [{fileName, sizeBytes}] }
//                                                                 → 첨부파일 업로드용 signed URL 발급
// PATCH  ?id=<notice id>  { title, content, attachments? }       → 기존 공지 수정(첨부파일도 통째로 교체)
// DELETE ?id=<notice id>                                         → 공지 삭제(첨부파일 Storage 객체도 같이 정리)
// (공통: Authorization: Bearer <세션토큰>, session.channelId가 OWNER_CHANNEL_ID와
//  일치해야만 허용 — 아니면 403)
//
// 업로드 흐름(용량이 큰 파일을 이 함수의 요청 본문에 base64로 태우지 않으려고 2단계로 나눔):
//   1) get-upload-urls로 signed upload URL을 받음
//   2) 프론트가 Supabase Storage에 파일을 직접 업로드함(supabase-client.js의 anon 키로,
//      signed URL 자체가 그 경로 하나에 대한 임시 업로드 권한이라 RLS와 무관하게 됨)
//   3) 업로드가 끝난 파일들의 정보를 attachments 배열로 담아 POST/PATCH 호출 → 이 함수가
//      notice_attachments 행을 씀(service_role)
//
// attachments 배열의 각 원소: { path, fileName, mimeType, sizeBytes, kind }
// kind는 "image" | "file" — 프론트가 갤러리로 보여줄지 다운로드 목록으로 보여줄지 이걸로 나눔.
// (진짜 검증은 서버가 확장자로 따로 하니, 클라이언트가 kind를 잘못 보내도 화면 표시만
// 어색해질 뿐 보안 문제는 없음 — 아래 classifyByExtension 참고)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

const BUCKET = "notice-attachments";
const MAX_ATTACHMENTS = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB — 프론트에서 미리 리사이즈해서 보통 훨씬 작음
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
const FILE_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "hwp", "hwpx", "zip", "txt", "csv"]);

interface AttachmentInput {
  path: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "file";
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  }
  return createClient(url, serviceRoleKey);
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

// 서버가 확장자만 보고 image/file을 판단함 — 클라이언트가 보낸 mimeType/kind는 신뢰하지 않음
// (특히 hwp 등은 브라우저마다 mimeType을 다르게 주거나 아예 안 줘서 확장자 기준이 제일 안전함).
function classifyByExtension(fileName: string): "image" | "file" | null {
  const ext = extensionOf(fileName);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (FILE_EXTENSIONS.has(ext)) return "file";
  return null;
}

// 화면에 보여줄 파일명 — 경로 구분자만 걷어내고 나머진(한글 포함) 그대로 둠.
function sanitizeDisplayName(fileName: string): string {
  const cleaned = fileName.replace(/[/\\]/g, "_").trim();
  return cleaned.length > 0 ? cleaned.slice(-200) : "file";
}

// Storage 경로에 실제로 들어가는 값 — 영문/숫자/한글/.-_ 만 허용(공백이나 특수문자가 URL에
// 그대로 들어가면 일부 클라이언트에서 다운로드 파일명이 깨지는 경우가 있어서 미리 정리함).
function sanitizeForPath(displayName: string): string {
  const ext = extensionOf(displayName);
  const base = ext ? displayName.slice(0, -(ext.length + 1)) : displayName;
  const safeBase = base.replace(/[^a-zA-Z0-9가-힣._-]/g, "_").slice(0, 100) || "file";
  return ext ? `${safeBase}.${ext}` : safeBase;
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (!["POST", "PATCH", "DELETE"].includes(req.method)) {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const session = await requireSession(req);
  if (!session) return jsonResponse({ error: "unauthorized" }, 401);
  if (session.channelId !== OWNER_CHANNEL_ID) return jsonResponse({ error: "forbidden" }, 403);

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  try {
    const admin = getAdminClient();

    if (req.method === "POST") {
      const body = await req.json();

      if (body?.action === "get-upload-urls") {
        return await handleGetUploadUrls(admin, body.files);
      }

      const { title, content, attachments } = body;
      if (typeof title !== "string" || title.trim().length === 0) {
        return jsonResponse({ error: "empty_title" }, 400);
      }
      if (typeof content !== "string" || content.trim().length === 0) {
        return jsonResponse({ error: "empty_content" }, 400);
      }
      const validAttachments = validateAttachments(attachments);
      if (validAttachments === null) return jsonResponse({ error: "invalid_attachments" }, 400);

      const { data, error } = await admin
        .from("notices")
        .insert({ title: title.trim(), content: content.trim() })
        .select()
        .single();
      if (error) throw new Error(`notices insert 실패: ${error.message}`);

      if (validAttachments.length > 0) {
        await insertAttachments(admin, data.id, validAttachments);
      }
      return jsonResponse(data, 200);
    }

    if (req.method === "PATCH") {
      if (!id) return jsonResponse({ error: "missing_id" }, 400);
      const { title, content, attachments } = await req.json();
      if (typeof title !== "string" || title.trim().length === 0) {
        return jsonResponse({ error: "empty_title" }, 400);
      }
      if (typeof content !== "string" || content.trim().length === 0) {
        return jsonResponse({ error: "empty_content" }, 400);
      }
      const validAttachments = validateAttachments(attachments);
      if (validAttachments === null) return jsonResponse({ error: "invalid_attachments" }, 400);

      const { data, error } = await admin
        .from("notices")
        .update({ title: title.trim(), content: content.trim(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(`notices update 실패: ${error.message}`);

      await replaceAttachments(admin, Number(id), validAttachments);
      return jsonResponse(data, 200);
    }

    // DELETE — cascade가 notice_attachments 행은 지워주지만 Storage 객체는 별개라 직접 정리함
    // (notices 행을 지우기 전에 경로를 먼저 읽어둬야 함 — 지우고 나면 cascade로 같이 사라짐).
    if (!id) return jsonResponse({ error: "missing_id" }, 400);
    const { data: existingAttachments } = await admin
      .from("notice_attachments")
      .select("storage_path")
      .eq("notice_id", id);
    const { error } = await admin.from("notices").delete().eq("id", id);
    if (error) throw new Error(`notices delete 실패: ${error.message}`);
    if (existingAttachments && existingAttachments.length > 0) {
      const { error: removeError } = await admin.storage
        .from(BUCKET)
        .remove(existingAttachments.map((a: { storage_path: string }) => a.storage_path));
      if (removeError) console.error(`notice-attachments storage 정리 실패: ${removeError.message}`);
    }
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return jsonResponse({ error: "notice_failed" }, 500);
  }
});

// 요청받은 파일 목록마다 확장자/용량을 검사하고, 전부 통과해야 signed upload URL들을 발급함
// (하나라도 실패하면 그 즉시 400 — 관리자 개인용 도구라 트래픽이 크지 않으니 배치 부분 성공
// 처리 없이 이 정도 단순한 로직으로 충분함).
async function handleGetUploadUrls(admin: ReturnType<typeof getAdminClient>, files: unknown) {
  if (!Array.isArray(files) || files.length === 0) {
    return jsonResponse({ error: "empty_files" }, 400);
  }
  if (files.length > MAX_ATTACHMENTS) {
    return jsonResponse({ error: "too_many_files" }, 400);
  }

  const uploads: Array<{ path: string; token: string; signedUrl: string; fileName: string; kind: "image" | "file" }> = [];

  for (const f of files) {
    if (
      typeof f !== "object" || f === null ||
      typeof (f as { fileName?: unknown }).fileName !== "string" ||
      typeof (f as { sizeBytes?: unknown }).sizeBytes !== "number"
    ) {
      return jsonResponse({ error: "invalid_file_entry" }, 400);
    }
    const displayName = sanitizeDisplayName((f as { fileName: string }).fileName);
    const sizeBytes = (f as { sizeBytes: number }).sizeBytes;

    const kind = classifyByExtension(displayName);
    if (!kind) return jsonResponse({ error: "unsupported_file_type", fileName: displayName }, 400);

    const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
    if (sizeBytes > maxBytes) return jsonResponse({ error: "file_too_large", fileName: displayName }, 400);

    const path = `notices/${crypto.randomUUID()}-${sanitizeForPath(displayName)}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw new Error(`signed upload url 발급 실패: ${error.message}`);

    uploads.push({ path: data.path, token: data.token, signedUrl: data.signedUrl, fileName: displayName, kind });
  }

  return jsonResponse({ uploads }, 200);
}

// notices insert/update의 attachments 필드를 검증함. 형식이 이상하면 null(호출부에서 400 처리).
function validateAttachments(attachments: unknown): AttachmentInput[] | null {
  if (attachments === undefined || attachments === null) return [];
  if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) return null;
  const result: AttachmentInput[] = [];
  for (const a of attachments) {
    if (
      typeof a !== "object" || a === null ||
      typeof (a as { path?: unknown }).path !== "string" ||
      typeof (a as { fileName?: unknown }).fileName !== "string" ||
      typeof (a as { mimeType?: unknown }).mimeType !== "string" ||
      typeof (a as { sizeBytes?: unknown }).sizeBytes !== "number" ||
      ((a as { kind?: unknown }).kind !== "image" && (a as { kind?: unknown }).kind !== "file") ||
      !(a as { path: string }).path.startsWith("notices/")
    ) {
      return null;
    }
    result.push(a as AttachmentInput);
  }
  return result;
}

async function insertAttachments(admin: ReturnType<typeof getAdminClient>, noticeId: number, attachments: AttachmentInput[]) {
  const rows = attachments.map((a, i) => ({
    notice_id: noticeId,
    kind: a.kind,
    file_name: a.fileName,
    storage_path: a.path,
    mime_type: a.mimeType,
    size_bytes: a.sizeBytes,
    sort_order: i,
  }));
  const { error } = await admin.from("notice_attachments").insert(rows);
  if (error) throw new Error(`notice_attachments insert 실패: ${error.message}`);
}

// 수정 시 첨부파일 전체를 새 목록으로 교체함 — 기존 것 중 새 목록에 없는 것만 Storage에서도
// 지우고(계속 남는 파일은 재업로드 없이 그대로 유지), 메타데이터 행은 통째로 다시 씀(개수가
// 많지 않아 부분 갱신보다 이 편이 훨씬 단순함).
async function replaceAttachments(admin: ReturnType<typeof getAdminClient>, noticeId: number, attachments: AttachmentInput[]) {
  const { data: existing, error: fetchError } = await admin
    .from("notice_attachments")
    .select("storage_path")
    .eq("notice_id", noticeId);
  if (fetchError) throw new Error(`notice_attachments 조회 실패: ${fetchError.message}`);

  const keepPaths = new Set(attachments.map((a) => a.path));
  const removedPaths = (existing ?? [])
    .map((row: { storage_path: string }) => row.storage_path)
    .filter((p: string) => !keepPaths.has(p));

  const { error: deleteError } = await admin.from("notice_attachments").delete().eq("notice_id", noticeId);
  if (deleteError) throw new Error(`notice_attachments 삭제 실패: ${deleteError.message}`);

  if (attachments.length > 0) {
    await insertAttachments(admin, noticeId, attachments);
  }
  if (removedPaths.length > 0) {
    // Storage 정리는 best-effort — 실패해도(이미 지워졌거나 등) 수정 자체는 성공으로 침.
    const { error: removeError } = await admin.storage.from(BUCKET).remove(removedPaths);
    if (removeError) console.error(`notice-attachments storage 정리 실패: ${removeError.message}`);
  }
}
