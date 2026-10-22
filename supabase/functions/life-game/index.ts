// 유진 키우기 — 평행세계의 유진을 키우는 텍스트 인생 게임 (0078_life_game.sql). 로그인 필요.
//
// 인생 진행은 전부 DB 함수(life_*)가 함 — 이 함수는 세션 확인, 테스트 모드 판단, 호출 횟수 제한만 담당.
// 테스트 모드(life_settings.is_open = false)일 땐 주인 계정만 쓸 수 있고, 판은 테스트 판(포인트 차감·하루 제한 없음)으로 기록됨.
//
// GET  ?view=lobby (기본) → 로비 정보(life_lobby)
// GET  ?view=dex          → 도감(life_dex)
// GET  ?view=run&id=123   → 지난 판 리포트(life_get_run, 본인 것만)
// POST { action: "start", house }                → 새 판 시작 → { run, balance }
// POST { action: "choose", runId, key, from }     → 갈림길 선택 → { run } (from 이후 새 기록만)
// POST { action: "item", runId, item, from }      → 보호자 아이템 → { run, balance }
// POST { action: "reset" }                        → 테스트 기록 초기화(테스트 모드에서만)
// 실패 400 { error }: not_open / bad_house / user_not_found / in_progress / daily_limit / insufficient_balance /
//                     no_pending / bad_choice / bad_item / not_playing / item_limit / too_fast

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

const KNOWN_ERRORS = new Set([
  "not_open", "bad_house", "user_not_found", "in_progress", "daily_limit", "insufficient_balance",
  "no_pending", "bad_choice", "bad_item", "not_playing", "item_limit", "too_fast",
]);

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, serviceRoleKey);
}

function fail(data: unknown) {
  const err = (data as { error?: string } | null)?.error;
  return err ? json({ error: KNOWN_ERRORS.has(err) ? err : "life_failed" }, 400) : null;
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const session = await requireSession(req);
  if (!session) return json({ error: "unauthorized" }, 401);

  try {
    const admin = getAdminClient();
    const { data: settings, error: sErr } = await admin.from("life_settings").select("is_open").maybeSingle();
    if (sErr) throw new Error(`life_settings 조회 실패: ${sErr.message}`);
    const isOpen = !!settings?.is_open;
    const isOwner = session.channelId === OWNER_CHANNEL_ID;
    if (!isOpen && !isOwner) return json({ error: "not_open" }, 403);
    const test = !isOpen; // 테스트 모드에선 주인 판도 테스트 판

    if (req.method === "GET") {
      const url = new URL(req.url);
      const view = url.searchParams.get("view") ?? "lobby";
      if (view === "dex") {
        const { data, error } = await admin.rpc("life_dex", { p_channel_id: session.channelId, p_test: test });
        if (error) throw new Error(`life_dex 실패: ${error.message}`);
        return json(data, 200);
      }
      if (view === "run") {
        const id = Number(url.searchParams.get("id"));
        if (!Number.isFinite(id) || id <= 0) return json({ error: "bad_request" }, 400);
        const { data, error } = await admin.rpc("life_get_run", { p_channel_id: session.channelId, p_run_id: id });
        if (error) throw new Error(`life_get_run 실패: ${error.message}`);
        if (!data) return json({ error: "not_found" }, 404);
        return json(data, 200);
      }
      const { data, error } = await admin.rpc("life_lobby", { p_channel_id: session.channelId, p_test: test });
      if (error) throw new Error(`life_lobby 실패: ${error.message}`);
      return json(data, 200);
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    // 연타 방지 — 10초에 20번까지
    const { data: allowed } = await admin.rpc("rate_limit_hit", { p_key: `life:${session.channelId}`, p_window_sec: 10, p_max: 20 });
    if (allowed === false) return json({ error: "too_fast" }, 400);

    const from = Math.max(0, Math.floor(Number(body.from) || 0));
    const runId = Math.floor(Number(body.runId) || 0);

    if (body.action === "start") {
      const { data, error } = await admin.rpc("life_start", { p_channel_id: session.channelId, p_house: String(body.house ?? ""), p_test: test });
      if (error) throw new Error(`life_start 실패: ${error.message}`);
      return fail(data) ?? json(data, 200);
    }
    if (body.action === "choose") {
      const { data, error } = await admin.rpc("life_choose", { p_channel_id: session.channelId, p_run_id: runId, p_key: String(body.key ?? ""), p_from: from });
      if (error) throw new Error(`life_choose 실패: ${error.message}`);
      return fail(data) ?? json(data, 200);
    }
    if (body.action === "item") {
      const { data, error } = await admin.rpc("life_use_item", { p_channel_id: session.channelId, p_run_id: runId, p_item: String(body.item ?? ""), p_from: from });
      if (error) throw new Error(`life_use_item 실패: ${error.message}`);
      return fail(data) ?? json(data, 200);
    }
    if (body.action === "reset") {
      if (!test) return json({ error: "bad_request" }, 400);
      const { data, error } = await admin.rpc("life_reset_test", { p_channel_id: session.channelId });
      if (error) throw new Error(`life_reset_test 실패: ${error.message}`);
      return json(data, 200);
    }
    return json({ error: "bad_request" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "life_failed" }, 500);
  }
});
