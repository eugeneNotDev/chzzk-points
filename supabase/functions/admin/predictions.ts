// admin 함수 — 투표(승부예측) 만들기·취소·정산·현황.
import { getAdminClient } from "../_shared/db.ts";

async function getOpenPrediction(admin: ReturnType<typeof getAdminClient>) {
  const { data, error } = await admin
    .from("predictions")
    .select("id, title, status, closes_at")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`predictions 조회 실패: ${error.message}`);
  return data;
}

export async function createPrediction(
  admin: ReturnType<typeof getAdminClient>,
  title: string,
  optionLabels: string[],
  durationMinutes: number,
) {
  const existing = await getOpenPrediction(admin);
  if (existing) return { ok: false as const, error: "already_open" as const };

  const closesAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
  const { data: prediction, error: predictionError } = await admin
    .from("predictions")
    .insert({ title, closes_at: closesAt })
    .select("id")
    .single();
  if (predictionError) throw new Error(`predictions insert 실패: ${predictionError.message}`);

  const rows = optionLabels.map((label, i) => ({ prediction_id: prediction.id, label, display_order: i }));
  const { error: optionsError } = await admin.from("prediction_options").insert(rows);
  if (optionsError) throw new Error(`prediction_options insert 실패: ${optionsError.message}`);

  return { ok: true as const, predictionId: prediction.id as number };
}

// 진행 중인 투표를 중도 취소함 — 이미 건 포인트는 전액 그대로 돌려줌(요청사항). points_ledger는
// 원장이라 행을 지우지 않고, 각 베팅 금액만큼 양수 보정 행을 하나씩 추가하는 방식(다른 정산
// 로직과 같은 원칙 — resetAccountHoldings/undoAdjustment 참고).
export async function cancelPrediction(admin: ReturnType<typeof getAdminClient>, predictionId: number) {
  const { data: prediction, error: predictionError } = await admin
    .from("predictions")
    .select("id, title, status")
    .eq("id", predictionId)
    .maybeSingle();
  if (predictionError) throw new Error(`predictions 조회 실패: ${predictionError.message}`);
  if (!prediction) return { ok: false as const, error: "not_found" as const };
  if (prediction.status !== "open") return { ok: false as const, error: "not_open" as const };

  const { data: bets, error: betsError } = await admin
    .from("prediction_bets")
    .select("channel_id, amount")
    .eq("prediction_id", predictionId);
  if (betsError) throw new Error(`prediction_bets 조회 실패: ${betsError.message}`);

  if (bets && bets.length > 0) {
    const refundRows = bets.map((b) => ({
      channel_id: b.channel_id,
      amount: b.amount,
      reason: `투표 취소 환불: ${prediction.title}`,
    }));
    const { error: refundError } = await admin.from("points_ledger").insert(refundRows);
    if (refundError) throw new Error(`환불 points_ledger insert 실패: ${refundError.message}`);
  }

  const { error: updateError } = await admin
    .from("predictions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", predictionId);
  if (updateError) throw new Error(`predictions 갱신 실패: ${updateError.message}`);

  return { ok: true as const };
}

// 마감 후 승자를 골라 정산함. 전체 풀(totalPool)을 승자들끼리 건 금액 비율대로 나눠 가짐
// (치지직 승부예측과 동일한 pari-mutuel 방식) — 패자 포인트가 승자에게 재분배되는 구조라
// 새로 포인트가 생기지도, 사라지지도 않음(승자가 아무도 없는 경우만 예외, 아래 참고).
// 소수점은 항상 내림(Math.floor) — 올림으로 하면 반올림 오차가 쌓여 실제 지급 총액이 전체 풀을
// 넘어버릴 수 있어서, 안전하게 내림만 씀(반올림으로 깎이는 몇 포인트는 그냥 시스템에서 사라짐 —
// 사용자가 체감할 수준이 아니고, "전체 발행 포인트"가 새로 생기는 것보다 안전함).
export async function resolvePrediction(admin: ReturnType<typeof getAdminClient>, predictionId: number, winningOptionId: number) {
  const { data: prediction, error: predictionError } = await admin
    .from("predictions")
    .select("id, title, status, closes_at")
    .eq("id", predictionId)
    .maybeSingle();
  if (predictionError) throw new Error(`predictions 조회 실패: ${predictionError.message}`);
  if (!prediction) return { ok: false as const, error: "not_found" as const };
  if (prediction.status !== "open") return { ok: false as const, error: "not_open" as const };
  if (new Date(prediction.closes_at).getTime() > Date.now()) {
    return { ok: false as const, error: "not_closed_yet" as const };
  }

  const { data: option, error: optionError } = await admin
    .from("prediction_options")
    .select("id, label")
    .eq("id", winningOptionId)
    .eq("prediction_id", predictionId)
    .maybeSingle();
  if (optionError) throw new Error(`prediction_options 조회 실패: ${optionError.message}`);
  if (!option) return { ok: false as const, error: "invalid_option" as const };

  const { data: bets, error: betsError } = await admin
    .from("prediction_bets")
    .select("id, channel_id, option_id, amount")
    .eq("prediction_id", predictionId);
  if (betsError) throw new Error(`prediction_bets 조회 실패: ${betsError.message}`);

  const allBets = bets ?? [];
  const totalPool = allBets.reduce((sum, b) => sum + b.amount, 0);
  const winningBets = allBets.filter((b) => b.option_id === winningOptionId);
  const winningPool = winningBets.reduce((sum, b) => sum + b.amount, 0);

  if (totalPool > 0) {
    if (winningPool > 0) {
      // 승자가 있으면 정상 정산 — 승자는 지분대로 payout, 패자는 payout=0.
      const payoutRows: { id: number; payout: number }[] = [];
      const ledgerRows: { channel_id: string; amount: number; reason: string }[] = [];
      for (const bet of allBets) {
        const isWinner = bet.option_id === winningOptionId;
        const payout = isWinner ? Math.floor((bet.amount * totalPool) / winningPool) : 0;
        payoutRows.push({ id: bet.id, payout });
        if (isWinner && payout > 0) {
          ledgerRows.push({
            channel_id: bet.channel_id,
            amount: payout,
            reason: `투표 정산: ${prediction.title} - ${option.label} 적중`,
          });
        }
      }
      if (ledgerRows.length > 0) {
        const { error: ledgerError } = await admin.from("points_ledger").insert(ledgerRows);
        if (ledgerError) throw new Error(`정산 points_ledger insert 실패: ${ledgerError.message}`);
      }
      for (const row of payoutRows) {
        const { error: payoutError } = await admin.from("prediction_bets").update({ payout: row.payout }).eq("id", row.id);
        if (payoutError) throw new Error(`prediction_bets payout 갱신 실패: ${payoutError.message}`);
      }
    } else {
      // 아무도 정답을 안 맞혔으면(승리 항목에 아무도 안 걸었으면) 나눠줄 승자가 없으니
      // 전액 그대로 돌려줌 — cancelPrediction과 같은 환불 로직.
      const refundRows = allBets.map((b) => ({
        channel_id: b.channel_id,
        amount: b.amount,
        reason: `투표 정산: ${prediction.title} - 적중자 없음, 환불`,
      }));
      const { error: refundError } = await admin.from("points_ledger").insert(refundRows);
      if (refundError) throw new Error(`환불 points_ledger insert 실패: ${refundError.message}`);
      for (const bet of allBets) {
        const { error: payoutError } = await admin.from("prediction_bets").update({ payout: bet.amount }).eq("id", bet.id);
        if (payoutError) throw new Error(`prediction_bets payout 갱신 실패: ${payoutError.message}`);
      }
    }
  }

  const { error: updateError } = await admin
    .from("predictions")
    .update({ status: "resolved", resolved_at: new Date().toISOString(), winning_option_id: winningOptionId })
    .eq("id", predictionId);
  if (updateError) throw new Error(`predictions 갱신 실패: ${updateError.message}`);

  return { ok: true as const };
}

// 관리자 화면용 — 현재(가장 최근) 투표 + 항목별 집계 + 개별 베팅 내역(요청사항: 관리자에게는
// 비익명). 익명 처리가 없는 것 빼면 predictions 함수의 GET 응답과 거의 같은 모양.
export async function getPredictionStatus(admin: ReturnType<typeof getAdminClient>) {
  const { data: prediction, error: predictionError } = await admin
    .from("predictions")
    .select("id, title, status, closes_at, resolved_at, cancelled_at, winning_option_id, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (predictionError) throw new Error(`predictions 조회 실패: ${predictionError.message}`);
  if (!prediction) return null;

  const [{ data: options, error: optionsError }, { data: bets, error: betsError }] = await Promise.all([
    admin
      .from("prediction_options")
      .select("id, label, display_order")
      .eq("prediction_id", prediction.id)
      .order("display_order", { ascending: true }),
    admin
      .from("prediction_bets")
      .select("channel_id, option_id, amount, payout, created_at")
      .eq("prediction_id", prediction.id)
      .order("created_at", { ascending: false }),
  ]);
  if (optionsError) throw new Error(`prediction_options 조회 실패: ${optionsError.message}`);
  if (betsError) throw new Error(`prediction_bets 조회 실패: ${betsError.message}`);

  const channelIds = [...new Set((bets ?? []).map((b) => b.channel_id))];
  let nameByChannel = new Map<string, string | null>();
  if (channelIds.length > 0) {
    const { data: users, error: usersError } = await admin
      .from("users")
      .select("channel_id, channel_name")
      .in("channel_id", channelIds);
    if (usersError) throw new Error(`users 조회 실패: ${usersError.message}`);
    nameByChannel = new Map((users ?? []).map((u) => [u.channel_id, u.channel_name]));
  }

  const totalByOption = new Map<number, number>();
  let totalPool = 0;
  for (const bet of bets ?? []) {
    totalByOption.set(bet.option_id, (totalByOption.get(bet.option_id) ?? 0) + bet.amount);
    totalPool += bet.amount;
  }

  const optionsOut = (options ?? []).map((opt) => {
    const totalAmount = totalByOption.get(opt.id) ?? 0;
    const percent = totalPool > 0 ? (totalAmount / totalPool) * 100 : 0;
    return { id: opt.id, label: opt.label, totalAmount, percent };
  });

  const betsOut = (bets ?? []).map((b) => ({
    channelId: b.channel_id,
    channelName: nameByChannel.get(b.channel_id) ?? null,
    optionId: b.option_id,
    amount: b.amount,
    payout: b.payout,
    createdAt: b.created_at,
  }));

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
    bets: betsOut,
  };
}
