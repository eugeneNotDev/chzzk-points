// 공지사항 작성 (채널 주인 전용). 목록 읽기는 프론트에서 anon 키로 notices 테이블을
// 직접 조회하면 되니까(RLS가 전체 공개), 이 함수는 POST(작성)만 처리한다.
//
// POST { content: string } (Authorization: Bearer <세션토큰>, session.channelId가
// OWNER_CHANNEL_ID와 일치해야만 허용 — 아니면 403)

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

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const session = await requireSession(req);
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (session.channelId !== OWNER_CHANNEL_ID) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { content } = await req.json();
    if (typeof content !== "string" || content.trim().length === 0) {
      return new Response(JSON.stringify({ error: "empty_content" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = getAdminClient();
    const { data, error } = await admin
      .from("notices")
      .insert({ content: content.trim() })
      .select()
      .single();
    if (error) throw new Error(`notices insert 실패: ${error.message}`);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "notice_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
