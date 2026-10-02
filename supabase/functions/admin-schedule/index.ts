// 관리자: 방송 스케줄(하루 한 건) 저장/삭제 (0055_broadcast_schedule.sql). 관리자 세션 필수. 읽기는 프론트가 직접(공개 읽기).
//
// POST { date: "YYYY-MM-DD", kind: "live" | "off", time: "HH:MM" | null(미정), title, memo } → 그 날 일정을 저장(있으면 덮어씀) → { ok: true }
// POST { date: "YYYY-MM-DD", action: "delete" } → 그 날 일정 삭제 → { ok: true }
// 오류 400: invalid_date / invalid_kind / invalid_time / invalid_title / invalid_memo

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const session = await requireSession(req);
  if (!session) return json({ error: "unauthorized" }, 401);
  if (session.channelId !== OWNER_CHANNEL_ID) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  if (!validDate(body.date)) return json({ error: "invalid_date" }, 400);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
    const admin = createClient(url, serviceRoleKey);

    if (body.action === "delete") {
      const { error } = await admin.from("broadcast_schedule").delete().eq("day", body.date);
      if (error) throw new Error(`broadcast_schedule 삭제 실패: ${error.message}`);
      return json({ ok: true }, 200);
    }

    const kind = body.kind;
    if (kind !== "live" && kind !== "off") return json({ error: "invalid_kind" }, 400);

    let startTime: string | null = null;
    let title = "";
    if (kind === "live") {
      if (body.time !== null && body.time !== undefined) {
        if (typeof body.time !== "string" || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(body.time)) return json({ error: "invalid_time" }, 400);
        startTime = body.time;
      }
      title = typeof body.title === "string" ? body.title.trim() : "";
      if (title.length < 1 || title.length > 30) return json({ error: "invalid_title" }, 400);
    }
    const memo = typeof body.memo === "string" ? body.memo.trim() : "";
    if (memo.length > 200) return json({ error: "invalid_memo" }, 400);

    const { error } = await admin
      .from("broadcast_schedule")
      .upsert({ day: body.date, kind, start_time: startTime, title, memo, updated_at: new Date().toISOString() });
    if (error) throw new Error(`broadcast_schedule 저장 실패: ${error.message}`);
    return json({ ok: true }, 200);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "admin_schedule_failed" }, 500);
  }
});
