// 방송 코드 — 시청자 입력 + 오버레이 초기 상태 (0047_stream_codes.sql).
//
// POST { code }  (로그인 필요) → 성공 { ok, points, rank, usedCount, maxUses, balance }
//   실패 400 { error }: invalid_code / expired / sold_out / already_redeemed / too_many_attempts / user_not_found
// GET ?key=<오버레이 키>  (overlay.html 전용) → { active: { id, code, points, maxUses, usedCount, expiresAt } | null, serverNow }
//   키가 틀리면 401. 코드는 이 키를 가진 오버레이한테만 알려줌.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { broadcastToOverlay, getActiveCode, getOverlayKey, sameString, toStreamCode } from "../_shared/stream-code.ts";

const KNOWN_ERRORS = ["invalid_code", "expired", "sold_out", "already_redeemed", "too_many_attempts", "user_not_found"];

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, serviceRoleKey);
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const admin = getAdminClient();

    if (req.method === "GET") {
      const given = new URL(req.url).searchParams.get("key") ?? "";
      const key = await getOverlayKey(admin);
      if (!key || !given || !sameString(given, key)) return json({ error: "unauthorized" }, 401);
      const active = await getActiveCode(admin);
      return json({ active: active ? toStreamCode(active) : null, serverNow: new Date().toISOString() }, 200);
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const session = await requireSession(req);
    if (!session) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code.slice(0, 40) : "";
    if (!code.trim()) return json({ error: "invalid_code" }, 400);

    const { data, error } = await admin.rpc("redeem_stream_code", { p_channel_id: session.channelId, p_code: code });
    if (error) throw new Error(`redeem_stream_code 실패: ${error.message}`);
    if (data?.error) return json({ error: KNOWN_ERRORS.includes(data.error) ? data.error : "redeem_failed" }, 400);

    await broadcastToOverlay(admin, "update", { id: data.codeId, usedCount: data.usedCount, maxUses: data.maxUses });
    return json(data, 200);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "stream_code_failed" }, 500);
  }
});
