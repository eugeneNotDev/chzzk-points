// 관리자 전용 기능 (유저 검색/포인트 지급·차감/밴 처리) 한 함수에 몰아넣음.
// Authorization: Bearer <세션토큰> 필수, session.channelId가 OWNER_CHANNEL_ID와
// 일치해야만 허용 (아니면 403). 전부 POST + body.action으로 분기한다.
//
// POST { action: "search-users", q?: string }
//   → { users: [{ channelId, channelName, isPublic, banned, balance }] } (channel_name ilike 검색, q 없으면 전체 최대 50명)
// POST { action: "adjust-points", channelId: string, amount: number, reason?: string }
//   → { channelId, balance }  (points_ledger에 한 줄 추가. amount는 음수 가능 — 차감)
// POST { action: "set-ban", channelId: string, banned: boolean }
//   → { channelId, banned }  (밴 걸면 랭킹에서도 빠지고 재로그인도 막힘 — oauth-callback, public.ranking 참고)
// POST { action: "list-points-log", q?: string, limit?: number }
//   → { entries: [{ id, channelId, channelName, amount, reason, createdAt }] }
//     (points_ledger 최근 기록. q 있으면 그 이름을 가진 유저 기록만, 없으면 전체 유저 통틀어
//     최신순 — 오버레이 놓쳤을 때 누가 언제 뭘 썼는지 대조용. limit 기본 100, 최대 300)

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

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function searchUsers(admin: ReturnType<typeof getAdminClient>, q: string | undefined) {
  let query = admin
    .from("users")
    .select("channel_id, channel_name, is_public, banned")
    .order("created_at", { ascending: false })
    .limit(50);
  if (q && q.trim().length > 0) {
    query = query.ilike("channel_name", `%${q.trim()}%`);
  }
  const { data: users, error } = await query;
  if (error) throw new Error(`users 검색 실패: ${error.message}`);
  if (!users || users.length === 0) return [];

  const channelIds = users.map((u) => u.channel_id);
  const { data: ledgerRows, error: ledgerError } = await admin
    .from("points_ledger")
    .select("channel_id, amount")
    .in("channel_id", channelIds);
  if (ledgerError) throw new Error(`points_ledger 조회 실패: ${ledgerError.message}`);

  const balanceByChannel = new Map<string, number>();
  for (const row of ledgerRows ?? []) {
    balanceByChannel.set(row.channel_id, (balanceByChannel.get(row.channel_id) ?? 0) + row.amount);
  }

  return users.map((u) => ({
    channelId: u.channel_id,
    channelName: u.channel_name,
    isPublic: u.is_public,
    banned: u.banned,
    balance: balanceByChannel.get(u.channel_id) ?? 0,
  }));
}

async function adjustPoints(
  admin: ReturnType<typeof getAdminClient>,
  channelId: string,
  amount: number,
  reason: string,
) {
  const { error: insertError } = await admin
    .from("points_ledger")
    .insert({ channel_id: channelId, amount, reason: reason || "관리자 지급/차감" });
  if (insertError) throw new Error(`points_ledger insert 실패: ${insertError.message}`);

  const { data: ledgerRows, error: ledgerError } = await admin
    .from("points_ledger")
    .select("amount")
    .eq("channel_id", channelId);
  if (ledgerError) throw new Error(`points_ledger 조회 실패: ${ledgerError.message}`);
  const balance = (ledgerRows ?? []).reduce((sum, row) => sum + row.amount, 0);
  return balance;
}

async function setBan(admin: ReturnType<typeof getAdminClient>, channelId: string, banned: boolean) {
  const { error } = await admin.from("users").update({ banned }).eq("channel_id", channelId);
  if (error) throw new Error(`banned 갱신 실패: ${error.message}`);
}

async function listPointsLog(
  admin: ReturnType<typeof getAdminClient>,
  q: string | undefined,
  limit: number,
) {
  let channelIdFilter: string[] | null = null;
  if (q && q.trim().length > 0) {
    // 이름으로 먼저 유저를 찾고, 그 채널ID들의 기록만 본다 (points_ledger엔 이름이 없어서
    // 역방향 조회 — 이름이 없는 유저는 검색으로는 못 찾음, channel_id 직접 검색은 아직 미지원).
    const { data: matchedUsers, error: userError } = await admin
      .from("users")
      .select("channel_id")
      .ilike("channel_name", `%${q.trim()}%`);
    if (userError) throw new Error(`users 검색 실패: ${userError.message}`);
    channelIdFilter = (matchedUsers ?? []).map((u) => u.channel_id);
    if (channelIdFilter.length === 0) return [];
  }

  let query = admin
    .from("points_ledger")
    .select("id, channel_id, amount, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (channelIdFilter) query = query.in("channel_id", channelIdFilter);

  const { data: rows, error } = await query;
  if (error) throw new Error(`points_ledger 조회 실패: ${error.message}`);
  if (!rows || rows.length === 0) return [];

  const channelIds = [...new Set(rows.map((r) => r.channel_id))];
  const { data: users, error: usersError } = await admin
    .from("users")
    .select("channel_id, channel_name")
    .in("channel_id", channelIds);
  if (usersError) throw new Error(`users 조회 실패: ${usersError.message}`);
  const nameByChannel = new Map((users ?? []).map((u) => [u.channel_id, u.channel_name]));

  return rows.map((r) => ({
    id: r.id,
    channelId: r.channel_id,
    channelName: nameByChannel.get(r.channel_id) ?? null,
    amount: r.amount,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const session = await requireSession(req);
  if (!session) return jsonResponse({ error: "unauthorized" }, 401);
  if (session.channelId !== OWNER_CHANNEL_ID) return jsonResponse({ error: "forbidden" }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const admin = getAdminClient();

    if (body.action === "search-users") {
      const users = await searchUsers(admin, typeof body.q === "string" ? body.q : undefined);
      return jsonResponse({ users }, 200);
    }

    if (body.action === "adjust-points") {
      const { channelId, amount, reason } = body;
      if (typeof channelId !== "string" || !channelId) return jsonResponse({ error: "missing_channel_id" }, 400);
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
        return jsonResponse({ error: "invalid_amount" }, 400);
      }
      const balance = await adjustPoints(admin, channelId, Math.trunc(amount), typeof reason === "string" ? reason : "");
      return jsonResponse({ channelId, balance }, 200);
    }

    if (body.action === "set-ban") {
      const { channelId, banned } = body;
      if (typeof channelId !== "string" || !channelId) return jsonResponse({ error: "missing_channel_id" }, 400);
      if (typeof banned !== "boolean") return jsonResponse({ error: "invalid_banned" }, 400);
      await setBan(admin, channelId, banned);
      return jsonResponse({ channelId, banned }, 200);
    }

    if (body.action === "list-points-log") {
      const q = typeof body.q === "string" ? body.q : undefined;
      const rawLimit = typeof body.limit === "number" ? Math.trunc(body.limit) : 100;
      const limit = Math.min(Math.max(rawLimit, 1), 300);
      const entries = await listPointsLog(admin, q, limit);
      return jsonResponse({ entries }, 200);
    }

    return jsonResponse({ error: "unknown_action" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return jsonResponse({ error: "admin_failed" }, 500);
  }
});
