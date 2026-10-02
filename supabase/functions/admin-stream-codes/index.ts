// 관리자 "방송 코드" 탭 (0047_stream_codes.sql). 관리자 세션 필수.
//
// GET ?page=N → { active, past: [...], page, totalPages, overlayUrl, serverNow }
//   active: 진행 중인 코드(없으면 null) / past: 지난 코드 5개씩 (최신순)
//   overlayUrl: 방송 코드를 띄우는 오버레이 주소(OBS 브라우저 소스에 넣는 주소 — 키 포함)
// POST { action: "create", code?, points, pointsMax?, maxUses?, minutes? } → 만든 코드 (진행 중이던 코드는 자동 종료)
//   minutes: 지속 시간(분, 비우면 무제한 — 직접 종료할 때까지) / pointsMax: 있으면 points~pointsMax 랜덤 (0051_stream_code_options.sql)
// POST { action: "end", id }                        → { ok: true }
// 오류 400: invalid_code / invalid_points / invalid_points_max / invalid_max_uses / invalid_minutes / not_active

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";
import { broadcastToOverlay, getActiveCode, getOverlayKey, toStreamCode } from "../_shared/stream-code.ts";

const PAGE_SIZE = 5;
// invalid_points_max가 invalid_points보다 먼저 와야 함(knownError가 앞에서부터 포함 여부로 찾음).
const KNOWN_ERRORS = ["invalid_code", "invalid_points_max", "invalid_points", "invalid_max_uses", "invalid_minutes", "not_active"];
const SITE_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://eugene4lpha.com";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, serviceRoleKey);
}

function knownError(message: string): string | null {
  return KNOWN_ERRORS.find((e) => message.includes(e)) ?? null;
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
      const pageParam = Number(new URL(req.url).searchParams.get("page") ?? 1);
      const page = Number.isSafeInteger(pageParam) && pageParam > 0 ? pageParam : 1;
      const active = await getActiveCode(admin);

      let query = admin
        .from("stream_codes")
        .select("id, code, points, points_max, max_uses, used_count, created_at, expires_at, ended_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      if (active) query = query.neq("id", active.id);
      const { data, count, error } = await query;
      if (error) throw new Error(`stream_codes 조회 실패: ${error.message}`);

      const key = await getOverlayKey(admin);
      return json({
        active: active ? toStreamCode(active) : null,
        past: (data ?? []).map(toStreamCode),
        page,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
        overlayUrl: key ? `${SITE_ORIGIN}/overlay.html?key=${key}` : null,
        serverNow: new Date().toISOString(),
      }, 200);
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const body = await req.json().catch(() => ({}));

    if (body.action === "create") {
      const code = typeof body.code === "string" ? body.code.slice(0, 40) : "";
      const points = Number(body.points);
      const optionalInt = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
      const maxUses = optionalInt(body.maxUses);
      const minutes = optionalInt(body.minutes);
      const pointsMax = optionalInt(body.pointsMax);
      if (!Number.isSafeInteger(points)) return json({ error: "invalid_points" }, 400);
      if (pointsMax !== null && !Number.isSafeInteger(pointsMax)) return json({ error: "invalid_points_max" }, 400);
      if (maxUses !== null && !Number.isSafeInteger(maxUses)) return json({ error: "invalid_max_uses" }, 400);
      if (minutes !== null && !Number.isSafeInteger(minutes)) return json({ error: "invalid_minutes" }, 400);

      const { data, error } = await admin.rpc("create_stream_code", {
        p_code: code, p_points: points, p_max_uses: maxUses, p_minutes: minutes, p_points_max: pointsMax,
      });
      if (error) {
        const known = knownError(error.message);
        if (known) return json({ error: known }, 400);
        throw new Error(`create_stream_code 실패: ${error.message}`);
      }
      await broadcastToOverlay(admin, "code", data);
      return json(data, 200);
    }

    if (body.action === "end") {
      const id = Number(body.id);
      if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "missing_id" }, 400);
      const { error } = await admin.rpc("end_stream_code", { p_id: id });
      if (error) {
        const known = knownError(error.message);
        if (known) return json({ error: known }, 400);
        throw new Error(`end_stream_code 실패: ${error.message}`);
      }
      await broadcastToOverlay(admin, "end", { id });
      return json({ ok: true }, 200);
    }

    return json({ error: "unknown_action" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "admin_stream_codes_failed" }, 500);
  }
});
