// 관리자용 후원 적립 관리 — admin.html "후원 적립" 탭이 부름(관리자 세션 필수).
// 관리자 기능은 원래 admin 함수에 모으지만, 그 파일이 워낙 커서 후원 관련만 따로 뺌(admin-ranking과 같은 이유).
//
// GET  → { pending: [...], recent: [...], link: { tokenSaved, tokenUpdatedAt, lastDonationAt } }
//   pending: 관리자 확인을 기다리는 익명 후원(1만 치즈 이상) — { id, amount, points, donationType, message, createdAt }
//   recent: 최근 처리된 후원 30건 — { id, status, nickname, channelId, channelName, amount, points, donationType, createdAt }
//     (미션 후원은 성공 전까지 mission_pending, 실패·거절이면 mission_failed — 0064 참고)
//   link: 후원 연동 상태 — 유진님 치지직 토큰이 저장돼 있는지, 마지막으로 후원 알림이 들어온 시각
// POST { action: "assign", id, channelId } → { points }  익명 후원을 그 유저에게 10% 적립
// POST { action: "dismiss", id }           → { ok: true } 적립 없이 목록에서 치움
// 오류: not_found / not_pending / user_not_found (400)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

const RECENT_LIMIT = 30;
const KNOWN_ERRORS = ["not_found", "not_pending", "user_not_found"];

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
      const [pendingRes, recentRes, tokenRes] = await Promise.all([
        admin
          .from("donations")
          .select("id, amount, donation_type, message, created_at")
          .eq("status", "anonymous_pending")
          .order("created_at", { ascending: true }),
        admin
          .from("donations")
          .select("id, status, donator_nickname, credited_channel_id, amount, points, donation_type, created_at")
          .neq("status", "anonymous_pending")
          .order("created_at", { ascending: false })
          .limit(RECENT_LIMIT),
        admin.from("streamer_tokens").select("updated_at").eq("channel_id", OWNER_CHANNEL_ID).maybeSingle(),
      ]);
      for (const r of [pendingRes, recentRes, tokenRes]) {
        if (r.error) throw new Error(`조회 실패: ${r.error.message}`);
      }
      const recentRows = recentRes.data ?? [];
      const channelIds = [...new Set(recentRows.map((r) => r.credited_channel_id).filter(Boolean))] as string[];
      let names = new Map<string, string>();
      if (channelIds.length > 0) {
        const { data: users, error } = await admin.from("users").select("channel_id, channel_name").in("channel_id", channelIds);
        if (error) throw new Error(`users 조회 실패: ${error.message}`);
        names = new Map((users ?? []).map((u) => [u.channel_id, u.channel_name]));
      }
      const { data: last } = await admin
        .from("donations")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return json({
        pending: (pendingRes.data ?? []).map((r) => ({
          id: r.id,
          amount: r.amount,
          points: Math.floor((r.amount * 10) / 100),
          donationType: r.donation_type,
          message: r.message,
          createdAt: r.created_at,
        })),
        recent: recentRows.map((r) => ({
          id: r.id,
          status: r.status,
          nickname: r.donator_nickname,
          channelId: r.credited_channel_id,
          channelName: r.credited_channel_id ? names.get(r.credited_channel_id) ?? null : null,
          amount: r.amount,
          points: r.points,
          donationType: r.donation_type,
          createdAt: r.created_at,
        })),
        link: {
          tokenSaved: !!tokenRes.data,
          tokenUpdatedAt: tokenRes.data?.updated_at ?? null,
          lastDonationAt: last?.created_at ?? null,
        },
      }, 200);
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const body = await req.json().catch(() => ({}));
    const id = Number(body.id);
    if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "missing_id" }, 400);

    if (body.action === "assign") {
      if (typeof body.channelId !== "string" || !body.channelId) return json({ error: "missing_channel_id" }, 400);
      const { data, error } = await admin.rpc("assign_anonymous_donation", { p_donation_id: id, p_channel_id: body.channelId });
      if (error) {
        const known = knownError(error.message);
        if (known) return json({ error: known }, 400);
        throw new Error(`assign_anonymous_donation 실패: ${error.message}`);
      }
      return json(data, 200);
    }

    if (body.action === "dismiss") {
      const { error } = await admin.rpc("dismiss_anonymous_donation", { p_donation_id: id });
      if (error) {
        const known = knownError(error.message);
        if (known) return json({ error: known }, 400);
        throw new Error(`dismiss_anonymous_donation 실패: ${error.message}`);
      }
      return json({ ok: true }, 200);
    }

    return json({ error: "unknown_action" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "admin_donations_failed" }, 500);
  }
});
