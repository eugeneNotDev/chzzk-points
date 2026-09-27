// 홀짝 엔드포인트. oddeven.html이 호출함(Authorization: Bearer <세션토큰>).
//
// GET  → 홀짝 화면에 필요한 내 상태
//   { balance, maxBalanceReached, requiredPoints, requiredTierName, eligible, minBet, winMultiplier,
//     cooldownSeconds(지금 남은 쿨타임, 없으면 0), recent: [{ bet, pick, card, result, payout, createdAt }] }
// POST { bet: number, pick: "odd" | "even" } → 한 판
//   성공: { card(1~10, 1은 A), result: "win" | "lose", payout, net, balance }
//   실패: 401 unauthorized / 403 banned
//         400 { error: "invalid_bet" | "invalid_pick" | "tier_required" | "insufficient_balance" | "cooldown" (retryAfterSeconds 포함) }
//
// 카드와 결과는 DB 함수 odd_even_play()가 유저 행을 잠근 채로 뽑고 포인트 기록까지 한 번에 처리함
// (0039_odd_even.sql). 맞히면 1.9배, 틀리면 0.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";

const MIN_BET = 100;
const RECENT_LIMIT = 10;
const COOLDOWN_SECONDS = 3; // odd_even_play()의 쿨타임과 같은 값(화면 안내용)
const WIN_MULTIPLIER = 1.9; // odd_even_play()의 배당과 같은 값(화면 안내용)
const PICKS = ["odd", "even"];

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

type Admin = ReturnType<typeof getAdminClient>;

// 가장 낮은 구간 칭호(브론즈) 기준 포인트와 이름.
async function getRequiredTier(admin: Admin): Promise<{ points: number; name: string | null }> {
  const { data, error } = await admin
    .from("titles")
    .select("name, min_points")
    .eq("kind", "tier")
    .order("min_points", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`titles 조회 실패: ${error.message}`);
  return { points: Number(data?.min_points ?? 0), name: data?.name ?? null };
}

async function handleGet(admin: Admin, channelId: string) {
  const { data: user, error: userError } = await admin
    .from("users")
    .select("balance, max_balance_reached, banned")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (userError) throw new Error(`users 조회 실패: ${userError.message}`);
  if (!user) return jsonResponse({ error: "unauthorized" }, 401);
  if (user.banned) return jsonResponse({ error: "banned" }, 403);

  const required = await getRequiredTier(admin);

  const { data: recent, error: recentError } = await admin
    .from("odd_even_games")
    .select("bet, pick, card, result, payout, created_at")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);
  if (recentError) throw new Error(`odd_even_games 조회 실패: ${recentError.message}`);

  let cooldownSeconds = 0;
  if (recent && recent.length > 0) {
    const elapsed = (Date.now() - new Date(recent[0].created_at).getTime()) / 1000;
    if (elapsed < COOLDOWN_SECONDS) cooldownSeconds = Math.ceil(COOLDOWN_SECONDS - elapsed);
  }

  const maxBalanceReached = Number(user.max_balance_reached);
  return jsonResponse(
    {
      balance: Number(user.balance),
      maxBalanceReached,
      requiredPoints: required.points,
      requiredTierName: required.name,
      eligible: maxBalanceReached >= required.points,
      minBet: MIN_BET,
      winMultiplier: WIN_MULTIPLIER,
      cooldownSeconds,
      recent: (recent ?? []).map((r) => ({
        bet: Number(r.bet),
        pick: r.pick,
        card: Number(r.card),
        result: r.result,
        payout: Number(r.payout),
        createdAt: r.created_at,
      })),
    },
    200,
  );
}

async function handlePost(admin: Admin, channelId: string, req: Request) {
  const body = await req.json().catch(() => ({}));
  const bet = typeof body.bet === "number" ? body.bet : Number.NaN;
  if (!Number.isInteger(bet) || bet < MIN_BET) return jsonResponse({ error: "invalid_bet" }, 400);
  const pick = typeof body.pick === "string" ? body.pick : "";
  if (!PICKS.includes(pick)) return jsonResponse({ error: "invalid_pick" }, 400);

  const { data, error } = await admin.rpc("odd_even_play", { p_channel_id: channelId, p_bet: bet, p_pick: pick });
  if (error) {
    const msg = error.message || "";
    if (msg.includes("banned")) return jsonResponse({ error: "banned" }, 403);
    if (msg.includes("user_not_found")) return jsonResponse({ error: "unauthorized" }, 401);
    if (msg.includes("invalid_bet")) return jsonResponse({ error: "invalid_bet" }, 400);
    if (msg.includes("invalid_pick")) return jsonResponse({ error: "invalid_pick" }, 400);
    if (msg.includes("tier_required")) return jsonResponse({ error: "tier_required" }, 400);
    if (msg.includes("insufficient_balance")) return jsonResponse({ error: "insufficient_balance" }, 400);
    const cooldown = msg.match(/cooldown:(\d+)/);
    if (cooldown) return jsonResponse({ error: "cooldown", retryAfterSeconds: Number(cooldown[1]) }, 400);
    throw new Error(`odd_even_play 실패: ${msg}`);
  }

  return jsonResponse(
    {
      card: Number(data.card),
      result: data.result,
      payout: Number(data.payout),
      net: Number(data.net),
      balance: Number(data.balance),
    },
    200,
  );
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const session = await requireSession(req);
  if (!session) return jsonResponse({ error: "unauthorized" }, 401);

  try {
    const admin = getAdminClient();
    if (req.method === "GET") return await handleGet(admin, session.channelId);
    if (req.method === "POST") return await handlePost(admin, session.channelId, req);
    return jsonResponse({ error: "method_not_allowed" }, 405);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return jsonResponse({ error: "odd_even_failed" }, 500);
  }
});
