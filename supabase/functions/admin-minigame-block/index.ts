// 관리자: 유저 미니게임 차단(기간 지정) / 해제 (0053_minigame_block.sql). 관리자 세션 필수.
// 차단 중엔 룰렛·가위바위보·홀짝에 참여할 수 없음(각 게임 함수가 확인). 무료 뽑기·투표는 그대로.
//
// GET  ?channelId=...           → { blocked, forever, until }  (until: 끝나는 시각, 계속 차단이거나 차단 아님이면 null)
// POST { channelId, duration }  → 같은 모양 — duration: "day" | "week" | "month" | "forever" | "off"(해제)
// 오류 400: missing_channel_id / invalid_duration / user_not_found

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const DURATION_MS: Record<string, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

// minigame_blocked_until 값 → 화면용 상태.
function toState(raw: string | null) {
  if (!raw) return { blocked: false, forever: false, until: null };
  if (raw === "infinity") return { blocked: true, forever: true, until: null };
  const t = new Date(raw).getTime();
  return Number.isFinite(t) && t > Date.now()
    ? { blocked: true, forever: false, until: raw }
    : { blocked: false, forever: false, until: null };
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

  const session = await requireSession(req);
  if (!session) return json({ error: "unauthorized" }, 401);
  if (session.channelId !== OWNER_CHANNEL_ID) return json({ error: "forbidden" }, 403);

  try {
    const admin = getAdminClient();

    if (req.method === "GET") {
      const channelId = new URL(req.url).searchParams.get("channelId") ?? "";
      if (!channelId) return json({ error: "missing_channel_id" }, 400);
      const { data, error } = await admin.from("users").select("minigame_blocked_until").eq("channel_id", channelId).maybeSingle();
      if (error) throw new Error(`users 조회 실패: ${error.message}`);
      if (!data) return json({ error: "user_not_found" }, 400);
      return json(toState(data.minigame_blocked_until), 200);
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const body = await req.json().catch(() => ({}));
    const channelId = typeof body.channelId === "string" ? body.channelId : "";
    if (!channelId) return json({ error: "missing_channel_id" }, 400);
    const duration = typeof body.duration === "string" ? body.duration : "";
    let until: string | null;
    if (duration === "off") until = null;
    else if (duration === "forever") until = "infinity";
    else if (DURATION_MS[duration]) until = new Date(Date.now() + DURATION_MS[duration]).toISOString();
    else return json({ error: "invalid_duration" }, 400);

    const { data, error } = await admin
      .from("users")
      .update({ minigame_blocked_until: until })
      .eq("channel_id", channelId)
      .select("minigame_blocked_until")
      .maybeSingle();
    if (error) throw new Error(`users 갱신 실패: ${error.message}`);
    if (!data) return json({ error: "user_not_found" }, 400);
    return json(toState(data.minigame_blocked_until), 200);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "admin_minigame_block_failed" }, 500);
  }
});
