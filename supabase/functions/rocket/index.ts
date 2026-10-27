// 양 로켓(크래시 게임) 엔드포인트. 오늘의 미니게임(minigame.html)의 양 로켓 화면이 호출함.
//
// GET → { balance, maxBalanceReached, requiredPoints, requiredTierName, eligible, blocked, blockedUntil, minBet, maxBet,
//         growth, maxMultiplier, cooldownSeconds: 0, rotation, active(진행 중인 판 or null), serverNow, recent }
// POST { action: "start", bet, auto? }   → 발사(베팅만큼 바로 빠짐). auto: 자동 내리기 배수(선택)
// POST { action: "cashout", roundId }    → 지금 배수로 내리기(요청이 DB에 도착한 순간 기준)
// POST { action: "watch", roundId }      → 판이 끝날 때까지(최대 25초) 기다렸다가 상태를 돌려줌.
//                                          끝나는 시각 전엔 절대 응답하지 않아서 터지는 배수가 미리 새지 않음.
// 판 상태: { roundId, status: flying|cashed|crashed, bet, autoAt, startedAt, crashAt(끝난 뒤에만), cashedAt, payout, net, balance, serverNow }
//
// 터지는 배수·정산은 전부 DB 함수(0101_rocket_roulette_x10.sql)가 유저 행을 잠근 채 처리함.

import { getAdminClient, type Admin } from "../_shared/db.ts";
import { json } from "../_shared/http.ts";
import { handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { nextChangeAt, notToday, todayGame } from "../_shared/rotation.ts";

const MIN_BET = 100;
const MAX_BET = 10_000_000;
const GROWTH = 0.13; // 배수 = e^(GROWTH × 초) — DB rocket_mult()와 같은 값
const MAX_MULT = 200;
const RECENT_LIMIT = 10;
const WATCH_MAX_MS = 25_000;

async function getRequiredTier(admin: Admin): Promise<{ points: number; name: string | null }> {
  const { data, error } = await admin.from("titles").select("name, min_points").eq("kind", "tier").order("min_points", { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(`titles 조회 실패: ${error.message}`);
  return { points: Number(data?.min_points ?? 0), name: data?.name ?? null };
}

function minigameBlock(raw: string | null): { blocked: boolean; until: string | null } {
  if (!raw) return { blocked: false, until: null };
  if (raw === "infinity") return { blocked: true, until: null };
  const t = new Date(raw).getTime();
  return Number.isFinite(t) && t > Date.now() ? { blocked: true, until: raw } : { blocked: false, until: null };
}

// DB 에러 메시지 → 응답
function rpcError(msg: string): Response | null {
  if (msg.includes("banned")) return json({ error: "banned" }, 403);
  if (msg.includes("user_not_found")) return json({ error: "unauthorized" }, 401);
  if (msg.includes("invalid_bet")) return json({ error: "invalid_bet" }, 400);
  if (msg.includes("invalid_auto")) return json({ error: "invalid_auto" }, 400);
  if (msg.includes("tier_required")) return json({ error: "tier_required" }, 400);
  if (msg.includes("insufficient_balance")) return json({ error: "insufficient_balance" }, 400);
  if (msg.includes("round_active")) return json({ error: "round_active" }, 400);
  if (msg.includes("round_not_found")) return json({ error: "round_not_found" }, 404);
  return null;
}

async function rpc(admin: Admin, fn: string, args: Record<string, unknown>): Promise<Response> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) {
    const r = rpcError(error.message || "");
    if (r) return r;
    throw new Error(`${fn} 실패: ${error.message}`);
  }
  return json(data, 200);
}

async function handleGet(admin: Admin, channelId: string) {
  const { data: user, error: userError } = await admin
    .from("users")
    .select("balance, max_balance_reached, banned, minigame_blocked_until")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (userError) throw new Error(`users 조회 실패: ${userError.message}`);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (user.banned) return json({ error: "banned" }, 403);

  // 떠나 있는 동안 끝난 판 정리 + 진행 중인 판
  const { data: sync, error: syncError } = await admin.rpc("rocket_sync", { p_channel_id: channelId });
  if (syncError) throw new Error(`rocket_sync 실패: ${syncError.message}`);

  const required = await getRequiredTier(admin);
  const { data: recent, error: recentError } = await admin
    .from("rocket_rounds")
    .select("bet, status, crash_at, cashed_at, payout, ended_at")
    .eq("channel_id", channelId)
    .neq("status", "flying")
    .order("started_at", { ascending: false })
    .limit(RECENT_LIMIT);
  if (recentError) throw new Error(`rocket_rounds 조회 실패: ${recentError.message}`);

  const { data: fresh } = await admin.from("users").select("balance, max_balance_reached").eq("channel_id", channelId).maybeSingle();
  const maxBalanceReached = Number(fresh?.max_balance_reached ?? user.max_balance_reached);
  const block = minigameBlock(user.minigame_blocked_until);
  return json(
    {
      balance: Number(fresh?.balance ?? user.balance),
      maxBalanceReached,
      requiredPoints: required.points,
      requiredTierName: required.name,
      eligible: maxBalanceReached >= required.points && !block.blocked,
      blocked: block.blocked,
      blockedUntil: block.until,
      minBet: MIN_BET,
      maxBet: MAX_BET,
      growth: GROWTH,
      maxMultiplier: MAX_MULT,
      cooldownSeconds: 0,
      rotation: { today: todayGame(), nextChangeAt: nextChangeAt() },
      active: sync?.active ?? null,
      serverNow: sync?.serverNow ?? new Date().toISOString(),
      recent: (recent ?? []).map((r) => ({
        bet: Number(r.bet),
        status: r.status,
        crashAt: Number(r.crash_at),
        cashedAt: r.cashed_at == null ? null : Number(r.cashed_at),
        payout: Number(r.payout),
        createdAt: r.ended_at,
      })),
    },
    200,
  );
}

async function handleWatch(admin: Admin, channelId: string, roundId: number) {
  const { data: r, error } = await admin
    .from("rocket_rounds")
    .select("status, crash_at, auto_at, started_at")
    .eq("id", roundId)
    .eq("channel_id", channelId)
    .maybeSingle();
  if (error) throw new Error(`rocket_rounds 조회 실패: ${error.message}`);
  if (!r) return json({ error: "round_not_found" }, 404);
  if (r.status !== "flying") return await rpc(admin, "rocket_settle", { p_channel_id: channelId, p_round_id: roundId });

  const crash = Number(r.crash_at);
  const auto = r.auto_at == null ? null : Number(r.auto_at);
  const endMult = auto != null && auto < crash ? auto : crash;
  const endAt = new Date(r.started_at).getTime() + (Math.log(endMult) / GROWTH) * 1000;
  const deadline = Date.now() + WATCH_MAX_MS;
  // 끝나는 시각(또는 25초 한도)까지 기다렸다가 DB에 정리를 맡김. 이 서버 시계가 DB보다 조금 빨라서 아직 "flying"이면
  // 바로 돌려주지 않고 조금씩 더 기다림 — 25초 한도 전에 "flying"이 오면 곧 끝난다는 신호가 돼 버려서.
  await new Promise((res) => setTimeout(res, Math.min(deadline, Math.max(Date.now(), endAt + 30)) - Date.now()));
  for (;;) {
    const { data, error } = await admin.rpc("rocket_settle", { p_channel_id: channelId, p_round_id: roundId });
    if (error) {
      const e = rpcError(error.message || "");
      if (e) return e;
      throw new Error(`rocket_settle 실패: ${error.message}`);
    }
    if (data?.status !== "flying" || Date.now() >= deadline) return json(data, 200);
    await new Promise((res) => setTimeout(res, Math.min(100, deadline - Date.now())));
  }
}

async function handlePost(admin: Admin, channelId: string, req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");

  if (action === "cashout" || action === "watch") {
    const roundId = Number(body.roundId);
    if (!Number.isInteger(roundId) || roundId <= 0) return json({ error: "round_not_found" }, 404);
    if (action === "cashout") return await rpc(admin, "rocket_cashout", { p_channel_id: channelId, p_round_id: roundId });
    return await handleWatch(admin, channelId, roundId);
  }
  if (action !== "start") return json({ error: "invalid_action" }, 400);

  const { data: blockRow, error: blockError } = await admin.from("users").select("minigame_blocked_until").eq("channel_id", channelId).maybeSingle();
  if (blockError) throw new Error(`users 조회 실패: ${blockError.message}`);
  const block = minigameBlock(blockRow?.minigame_blocked_until ?? null);
  if (block.blocked) return json({ error: "minigame_blocked", blockedUntil: block.until }, 403);
  // 오늘의 미니게임이 아니면 발사 불가(내리기·지켜보기는 자정을 넘겨도 끝까지 됨)
  const off = notToday("rocket", channelId);
  if (off) return off;

  const bet = typeof body.bet === "number" ? body.bet : Number.NaN;
  if (!Number.isInteger(bet) || bet < MIN_BET || bet > MAX_BET) return json({ error: "invalid_bet" }, 400);
  const auto = body.auto == null || body.auto === "" ? null : Number(body.auto);
  if (auto != null && (!Number.isFinite(auto) || auto < 1.01 || auto > MAX_MULT)) return json({ error: "invalid_auto" }, 400);

  return await rpc(admin, "rocket_start", { p_channel_id: channelId, p_bet: bet, p_auto: auto });
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const session = await requireSession(req);
  if (!session) return json({ error: "unauthorized" }, 401);

  try {
    const admin = getAdminClient();
    if (req.method === "GET") return await handleGet(admin, session.channelId);
    if (req.method === "POST") return await handlePost(admin, session.channelId, req);
    return json({ error: "method_not_allowed" }, 405);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "rocket_failed" }, 500);
  }
});
