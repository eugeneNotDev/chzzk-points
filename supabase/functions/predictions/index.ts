// 투표(승부예측) 조회 + 베팅. 치지직 승부예측과 같은 방식 — 항목별로 걸린 포인트 총합 기준
// pari-mutuel 정산(관리자가 승자를 고르면 패자 포인트가 승자들에게 건 금액 비율대로 재분배됨).
// 투표 생성/취소/정산은 admin 함수 쪽(관리자 전용)에서 함 — 이 함수는 조회(GET)와 베팅(POST)만.
//
// GET (로그인 필요) → 가장 최근 투표 1건(상태 무관 — open/resolved/cancelled) + 항목별 집계.
//   { prediction: null } | {
//     prediction: {
//       id, title, status, closesAt, resolvedAt, cancelledAt, winningOptionId,
//       options: [{ id, label, totalAmount, percent, multiplier }],
//       totalPool,
//       myBet: { optionId, amount, payout } | null
//     }
//   }
//   percent/multiplier는 totalPool(또는 그 항목 금액)이 0이면 0으로 내려줌(0으로 나누기 방지).
//   status가 open이어도 closesAt이 지났으면 "마감, 정산 대기중"으로 프론트가 판단함(별도 필드 없음
//   — 프론트가 그냥 Date.now()랑 closesAt을 비교).
//
// POST { predictionId, optionId, amount } (로그인 필요) — 처음 베팅, 또는 이미 건 항목에 추가 베팅
//   성공: { balance, bet: { optionId, amount(이 투표에 건 합계), added(추가 베팅이었는지) } }
//   실패: 401 unauthorized, 403 banned,
//         400 { error: "invalid_request" | "prediction_not_found" | "prediction_closed"
//               | "invalid_option" | "amount_too_small" | "insufficient_balance" | "different_option" }
//
// 익명 범위(요청사항): 다른 유저에게는 완전 익명 — 개별 베팅 내역이 담긴 prediction_bets 테이블에
// anon 읽기 정책 자체가 없어서(0030_predictions.sql) 이 함수(service_role) 밖에서는 아무도 남의
// 베팅을 못 봄. 관리자에게는 비익명(admin 함수의 get-prediction-status가 개별 내역까지 조회 가능
// — 어뷰징/정산 오류 대응용, 요청사항).
//
// 베팅 변경(요청사항): 처음 건 항목은 못 바꾸고, 같은 항목에만 더 걸 수 있음(0052_prediction_add_bet.sql).
// 한 사람당 prediction_bets 행은 하나(unique 제약)라서 추가 베팅은 그 행의 amount에 더해짐 — 정산은 합계 기준.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";

const MIN_BET_AMOUNT = 100;

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

async function isBanned(admin: ReturnType<typeof getAdminClient>, channelId: string): Promise<boolean> {
  const { data, error } = await admin.from("users").select("banned").eq("channel_id", channelId).maybeSingle();
  if (error) throw new Error(`banned 조회 실패: ${error.message}`);
  return data?.banned === true;
}

interface PredictionRow {
  id: number;
  title: string;
  status: string;
  closes_at: string;
  resolved_at: string | null;
  cancelled_at: string | null;
  winning_option_id: number | null;
}

async function getLatestPrediction(admin: ReturnType<typeof getAdminClient>): Promise<PredictionRow | null> {
  const { data, error } = await admin
    .from("predictions")
    .select("id, title, status, closes_at, resolved_at, cancelled_at, winning_option_id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`predictions 조회 실패: ${error.message}`);
  return data;
}

// 항목별 집계(걸린 포인트 총합) + 내 베팅(있으면). 이 두 조회를 위해서만 prediction_bets를
// service_role로 읽음 — anon 정책이 없어서 이 함수 밖에선 아무도 개별 행을 못 봄(익명 요구사항).
async function buildPredictionResponse(
  admin: ReturnType<typeof getAdminClient>,
  prediction: PredictionRow,
  channelId: string,
) {
  const [{ data: options, error: optionsError }, { data: bets, error: betsError }] = await Promise.all([
    admin
      .from("prediction_options")
      .select("id, label, display_order")
      .eq("prediction_id", prediction.id)
      .order("display_order", { ascending: true }),
    admin
      .from("prediction_bets")
      .select("option_id, amount, channel_id, payout")
      .eq("prediction_id", prediction.id),
  ]);
  if (optionsError) throw new Error(`prediction_options 조회 실패: ${optionsError.message}`);
  if (betsError) throw new Error(`prediction_bets 조회 실패: ${betsError.message}`);

  const totalByOption = new Map<number, number>();
  let totalPool = 0;
  for (const bet of bets ?? []) {
    totalByOption.set(bet.option_id, (totalByOption.get(bet.option_id) ?? 0) + bet.amount);
    totalPool += bet.amount;
  }

  const optionsOut = (options ?? []).map((opt) => {
    const totalAmount = totalByOption.get(opt.id) ?? 0;
    const percent = totalPool > 0 ? (totalAmount / totalPool) * 100 : 0;
    // 배당률 = 전체 풀 / 이 항목에 걸린 금액 (치지직 승부예측과 동일한 표기 — "1.8배" 식).
    // 아무도 안 걸었으면(totalAmount=0) 배당률 자체가 정의 안 되니 0으로.
    const multiplier = totalAmount > 0 ? totalPool / totalAmount : 0;
    return { id: opt.id, label: opt.label, totalAmount, percent, multiplier };
  });

  const myBetRow = (bets ?? []).find((b) => b.channel_id === channelId) ?? null;
  const myBet = myBetRow ? { optionId: myBetRow.option_id, amount: myBetRow.amount, payout: myBetRow.payout } : null;

  return {
    id: prediction.id,
    title: prediction.title,
    status: prediction.status,
    closesAt: prediction.closes_at,
    resolvedAt: prediction.resolved_at,
    cancelledAt: prediction.cancelled_at,
    winningOptionId: prediction.winning_option_id,
    options: optionsOut,
    totalPool,
    myBet,
  };
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (!["GET", "POST"].includes(req.method)) {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const session = await requireSession(req);
  if (!session) return jsonResponse({ error: "unauthorized" }, 401);

  try {
    const admin = getAdminClient();
    if (await isBanned(admin, session.channelId)) return jsonResponse({ error: "banned" }, 403);

    if (req.method === "GET") {
      const prediction = await getLatestPrediction(admin);
      if (!prediction) return jsonResponse({ prediction: null }, 200);
      const out = await buildPredictionResponse(admin, prediction, session.channelId);
      return jsonResponse({ prediction: out }, 200);
    }

    // POST — 베팅 / 추가 베팅. 검사와 베팅 행 갱신·포인트 차감은 DB 함수 place_prediction_bet()이 한 번에 처리함
    // (0052_prediction_add_bet.sql) — 연타나 동시 요청에도 금액이 꼬이지 않음.
    const body = await req.json().catch(() => ({}));
    const predictionId = Number(body.predictionId);
    const optionId = Number(body.optionId);
    const amount = Number(body.amount);
    if (!Number.isFinite(predictionId) || !Number.isFinite(optionId) || !Number.isInteger(amount)) {
      return jsonResponse({ error: "invalid_request" }, 400);
    }
    if (amount < MIN_BET_AMOUNT) return jsonResponse({ error: "amount_too_small" }, 400);

    const { data, error } = await admin.rpc("place_prediction_bet", {
      p_prediction_id: predictionId,
      p_option_id: optionId,
      p_channel_id: session.channelId,
      p_amount: amount,
    });
    if (error) throw new Error(`place_prediction_bet 실패: ${error.message}`);
    if (data?.error) {
      if (data.error === "user_not_found") return jsonResponse({ error: "unauthorized" }, 401);
      const known = ["prediction_not_found", "prediction_closed", "invalid_option", "amount_too_small", "different_option", "insufficient_balance"];
      return jsonResponse({ error: known.includes(data.error) ? data.error : "prediction_failed" }, 400);
    }

    return jsonResponse(
      { balance: Number(data.balance), bet: { optionId: Number(data.optionId), amount: Number(data.amount), added: data.added === true } },
      200,
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return jsonResponse({ error: "prediction_failed" }, 500);
  }
});
