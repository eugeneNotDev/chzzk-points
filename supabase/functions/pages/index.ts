// 특별 페이지 — 사이트에 없는 주소로 들어왔을 때 404.html이 "이 주소가 특별한 페이지인지" 물어봄.
// 어떤 주소가 특별한지, 내용과 보상은 전부 DB(hidden_pages)에만 있음.
//
// GET  ?path=<주소>            → { found: false } (404) 또는 { found: true, points, content, claimed, winnerName, claimedAt }
// POST { path }  (로그인 필요)  → 성공 { ok, points, balance }
//   실패 400 { error }: not_found / already_claimed / user_not_found

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";

const KNOWN_ERRORS = ["not_found", "already_claimed", "user_not_found"];

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, serviceRoleKey);
}

function cleanPath(v: unknown): string {
  return typeof v === "string" ? v.slice(0, 80) : "";
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const admin = getAdminClient();

    if (req.method === "GET") {
      const path = cleanPath(new URL(req.url).searchParams.get("path"));
      if (!path) return json({ found: false }, 404);
      const { data, error } = await admin.rpc("hidden_page_get", { p_path: path });
      if (error) throw new Error(`hidden_page_get 실패: ${error.message}`);
      if (!data?.found) return json({ found: false }, 404);
      return json(data, 200);
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const session = await requireSession(req);
    if (!session) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const path = cleanPath(body.path);
    if (!path) return json({ error: "not_found" }, 400);
    const { data, error } = await admin.rpc("hidden_page_claim", { p_path: path, p_channel_id: session.channelId });
    if (error) throw new Error(`hidden_page_claim 실패: ${error.message}`);
    if (data?.error) return json({ error: KNOWN_ERRORS.includes(data.error) ? data.error : "claim_failed" }, 400);
    return json(data, 200);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "pages_failed" }, 500);
  }
});
