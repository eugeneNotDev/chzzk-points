// 관리자: 유저 특수 칭호 조회/지급/회수 (0054_special_titles.sql). 관리자 세션 필수.
// 특수 칭호 = 랭킹에서 닉네임 위 작은 글씨. 유저가 마이페이지에서 하나 골라 장착(0069_special_title_equip.sql).
// forced(고정)로 주면 항상 그게 보이고 유저가 해제·변경 못 함. 지난달 1~3위 칭호(source: monthly)는 매달 자동 지급(DB).
//
// GET  ?channelId=...                                   → { titles: [{ id, name, color, forced, source, grantedAt }] }
// POST { channelId, name, color, forced?, bonusPct? }  → 지급 → 같은 모양 (bonusPct: 장착 중 출석·방송 코드·후기·게시판 적립 +n%, 0~30)
// POST { channelId, action: "revoke", id }              → 회수 → 같은 모양
// POST { channelId, action: "force", id, forced }       → 고정/고정 풀기 → 같은 모양
// POST { channelId, action: "bonus", id, bonusPct }     → 적립 보너스 바꾸기 → 같은 모양
// 오류 400: missing_channel_id / invalid_title_name / invalid_title_color / too_many_titles / already_owned / user_not_found

import { getAdminClient } from "../_shared/db.ts";
import { json } from "../_shared/http.ts";
import { handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

const MAX_PER_USER = 5;

// deno-lint-ignore no-explicit-any
async function listTitles(admin: any, channelId: string) {
  const { data, error } = await admin
    .from("user_special_titles")
    .select("id, name, color, forced, source, bonus_pct, granted_at")
    .eq("channel_id", channelId)
    .order("id", { ascending: true });
  if (error) throw new Error(`user_special_titles 조회 실패: ${error.message}`);
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, color: r.color, forced: r.forced, source: r.source, bonusPct: r.bonus_pct ?? 0, grantedAt: r.granted_at }));
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
      return json({ titles: await listTitles(admin, channelId) }, 200);
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const body = await req.json().catch(() => ({}));
    const channelId = typeof body.channelId === "string" ? body.channelId : "";
    if (!channelId) return json({ error: "missing_channel_id" }, 400);

    if (body.action === "revoke") {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return json({ error: "invalid_id" }, 400);
      const { error } = await admin.from("user_special_titles").delete().eq("id", id).eq("channel_id", channelId);
      if (error) throw new Error(`user_special_titles 회수 실패: ${error.message}`);
      return json({ titles: await listTitles(admin, channelId) }, 200);
    }

    if (body.action === "force") {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return json({ error: "invalid_id" }, 400);
      const { error } = await admin.from("user_special_titles").update({ forced: body.forced === true }).eq("id", id).eq("channel_id", channelId);
      if (error) throw new Error(`user_special_titles 고정 변경 실패: ${error.message}`);
      return json({ titles: await listTitles(admin, channelId) }, 200);
    }

    if (body.action === "bonus") {
      const id = Number(body.id);
      const pct = Number(body.bonusPct);
      if (!Number.isInteger(id)) return json({ error: "invalid_id" }, 400);
      if (!Number.isInteger(pct) || pct < 0 || pct > 30) return json({ error: "invalid_bonus" }, 400);
      const { error } = await admin.from("user_special_titles").update({ bonus_pct: pct }).eq("id", id).eq("channel_id", channelId);
      if (error) throw new Error(`user_special_titles 보너스 변경 실패: ${error.message}`);
      return json({ titles: await listTitles(admin, channelId) }, 200);
    }

    const bonusPct = body.bonusPct == null ? 0 : Number(body.bonusPct);
    if (!Number.isInteger(bonusPct) || bonusPct < 0 || bonusPct > 30) return json({ error: "invalid_bonus" }, 400);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 1 || name.length > 20) return json({ error: "invalid_title_name" }, 400);
    // 꾸미기 값(예: "#00e5a0", "glow-wolfh-b22222", "shine-crown-d4af37", "rainbow") — 글자/숫자/#/- 만 허용.
    const color = typeof body.color === "string" ? body.color.trim() : "";
    if (!/^[A-Za-z0-9#-]{1,80}$/.test(color)) return json({ error: "invalid_title_color" }, 400);

    const { data: user, error: userErr } = await admin.from("users").select("channel_id").eq("channel_id", channelId).maybeSingle();
    if (userErr) throw new Error(`users 조회 실패: ${userErr.message}`);
    if (!user) return json({ error: "user_not_found" }, 400);

    const current = await listTitles(admin, channelId);
    // 개수 제한은 관리자가 준 것만 셈(지난달 순위 칭호는 빼고)
    if (current.filter((t: { source: string }) => t.source === "admin").length >= MAX_PER_USER) return json({ error: "too_many_titles" }, 400);
    if (current.some((t: { name: string }) => t.name === name)) return json({ error: "already_owned" }, 400);

    const { error } = await admin.from("user_special_titles").insert({ channel_id: channelId, name, color, forced: body.forced === true, bonus_pct: bonusPct });
    if (error) throw new Error(`user_special_titles 지급 실패: ${error.message}`);
    return json({ titles: await listTitles(admin, channelId) }, 200);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "admin_special_title_failed" }, 500);
  }
});
