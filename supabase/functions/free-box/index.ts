// 무료 뽑기(선물 상자) — 하루 한 번, 한국 시간 자정에 초기화 (0048_free_box.sql). 로그인 필요.
//
// GET  → { openedToday, todayPoints, balance, nextResetAt, serverNow, recent: [{ date, points }] }  (recent: 최근 7번)
// POST → 성공 { points, jackpot, balance, nextResetAt } / 실패 400 { error }: already_opened / user_not_found
// 결과(포인트)는 DB 함수 free_box_open()이 정함 — 화면은 받은 결과로 연출만 함.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const RECENT_LIMIT = 7;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, serviceRoleKey);
}

// 한국 시간 기준 오늘 날짜(YYYY-MM-DD)와 다음 자정(UTC ISO).
function kstToday() {
  const kst = new Date(Date.now() + KST_OFFSET_MS);
  const date = kst.toISOString().slice(0, 10);
  const nextReset = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1) - KST_OFFSET_MS;
  return { date, nextResetAt: new Date(nextReset).toISOString() };
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const session = await requireSession(req);
  if (!session) return json({ error: "unauthorized" }, 401);

  try {
    const admin = getAdminClient();
    const { date, nextResetAt } = kstToday();

    if (req.method === "GET") {
      const [drawsRes, userRes] = await Promise.all([
        admin
          .from("free_box_draws")
          .select("draw_date, points")
          .eq("channel_id", session.channelId)
          .order("draw_date", { ascending: false })
          .limit(RECENT_LIMIT),
        admin.from("users").select("balance").eq("channel_id", session.channelId).maybeSingle(),
      ]);
      if (drawsRes.error) throw new Error(`free_box_draws 조회 실패: ${drawsRes.error.message}`);
      const rows = drawsRes.data ?? [];
      const today = rows.find((r) => r.draw_date === date);
      return json({
        openedToday: !!today,
        todayPoints: today ? today.points : null,
        balance: userRes.data?.balance ?? 0,
        nextResetAt,
        serverNow: new Date().toISOString(),
        recent: rows.map((r) => ({ date: r.draw_date, points: r.points })),
      }, 200);
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const { data, error } = await admin.rpc("free_box_open", { p_channel_id: session.channelId });
    if (error) throw new Error(`free_box_open 실패: ${error.message}`);
    if (data?.error) return json({ error: data.error === "already_opened" || data.error === "user_not_found" ? data.error : "free_box_failed" }, 400);
    return json({ ...data, nextResetAt, serverNow: new Date().toISOString() }, 200);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "free_box_failed" }, 500);
  }
});
