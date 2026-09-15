// 공지사항 작성/수정/삭제 (관리자 전용). 목록 읽기는 프론트에서 anon 키로 notices 테이블을
// 직접 조회하면 되니까(RLS가 전체 공개), 이 함수는 쓰기 계열(POST/PATCH/DELETE)만 처리함.
//
// POST   { title: string, content: string }                 → 새 공지 작성
// PATCH  ?id=<notice id>  { title: string, content: string } → 기존 공지 수정
// DELETE ?id=<notice id>                                     → 공지 삭제
// (공통: Authorization: Bearer <세션토큰>, session.channelId가 OWNER_CHANNEL_ID와
//  일치해야만 허용 — 아니면 403)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

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
      const { title, content } = await req.json();
      if (typeof title !== "string" || title.trim().length === 0) {
        return jsonResponse({ error: "empty_title" }, 400);
      }
      if (typeof content !== "string" || content.trim().length === 0) {
        return jsonResponse({ error: "empty_content" }, 400);
      }
      const { data, error } = await admin
        .from("notices")
        .insert({ title: title.trim(), content: content.trim() })
        .select()
        .single();
      if (error) throw new Error(`notices insert 실패: ${error.message}`);
      return jsonResponse(data, 200);
    }

    if (req.method === "PATCH") {
      if (!id) return jsonResponse({ error: "missing_id" }, 400);
      const { title, content } = await req.json();
      if (typeof title !== "string" || title.trim().length === 0) {
        return jsonResponse({ error: "empty_title" }, 400);
      }
      if (typeof content !== "string" || content.trim().length === 0) {
        return jsonResponse({ error: "empty_content" }, 400);
      }
      const { data, error } = await admin
        .from("notices")
        .update({ title: title.trim(), content: content.trim(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(`notices update 실패: ${error.message}`);
      return jsonResponse(data, 200);
    }

    // DELETE
    if (!id) return jsonResponse({ error: "missing_id" }, 400);
    const { error } = await admin.from("notices").delete().eq("id", id);
    if (error) throw new Error(`notices delete 실패: ${error.message}`);
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return jsonResponse({ error: "notice_failed" }, 500);
  }
});
