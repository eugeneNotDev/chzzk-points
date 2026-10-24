// admin 함수 — 통계, 포인트 로그, 상점 사용 로그(처리 체크).
import { getAdminClient } from "../_shared/db.ts";

// 주어진 시각을 "한국 시간(KST) 기준 YYYY-MM-DD" 문자열로 (attendance-check/index.ts와 동일 —
// 페이지 하나 분량이라 공용 파일로 안 빼고 필요한 곳마다 둠).
function kstDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function setProcessed(admin: ReturnType<typeof getAdminClient>, id: number, processed: boolean) {
  const { error } = await admin.from("points_ledger").update({ processed }).eq("id", id);
  if (error) throw new Error(`processed 갱신 실패: ${error.message}`);
}

export async function bulkSetProcessed(admin: ReturnType<typeof getAdminClient>, ids: number[], processed: boolean): Promise<number> {
  if (ids.length === 0) return 0;
  const { error } = await admin.from("points_ledger").update({ processed }).in("id", ids);
  if (error) throw new Error(`processed 일괄 갱신 실패: ${error.message}`);
  return ids.length;
}

export async function getStats(admin: ReturnType<typeof getAdminClient>) {
  const todayStr = kstDateString(new Date());
  // 오늘(KST) 00:00을 UTC ISO로 — spend_events.created_at(timestamptz) 비교용.
  const todayStartIso = new Date(`${todayStr}T00:00:00+09:00`).toISOString();

  const [
    { count: userCount, error: userCountError },
    { count: bannedCount, error: bannedCountError },
    { data: totalPointsData, error: ledgerError },
    { count: todaySpendCount, error: spendCountError },
    { count: todayAttendanceCount, error: attendanceCountError },
  ] = await Promise.all([
    admin.from("users").select("*", { count: "exact", head: true }),
    admin.from("users").select("*", { count: "exact", head: true }).eq("banned", true),
    admin.rpc("total_points_issued"),
    admin.from("spend_events").select("*", { count: "exact", head: true }).gte("created_at", todayStartIso),
    admin.from("attendance").select("*", { count: "exact", head: true }).eq("attended_on", todayStr),
  ]);
  for (const e of [userCountError, bannedCountError, ledgerError, spendCountError, attendanceCountError]) {
    if (e) throw new Error(`통계 조회 실패: ${e.message}`);
  }

  const totalPoints = Number(totalPointsData ?? 0);

  return {
    userCount: userCount ?? 0,
    bannedCount: bannedCount ?? 0,
    totalPoints,
    todaySpendCount: todaySpendCount ?? 0,
    todayAttendanceCount: todayAttendanceCount ?? 0,
  };
}

export const POINTS_LOG_PAGE_SIZE = 10;
const POINTS_LOG_WINDOW_HOURS = 24;

export async function listPointsLog(
  admin: ReturnType<typeof getAdminClient>,
  q: string | undefined,
  page: number,
) {
  let channelIdFilter: string[] | null = null;
  if (q && q.trim().length > 0) {
    // 이름으로 먼저 유저를 찾고, 그 채널ID들의 기록만 봄 (points_ledger엔 이름이 없어서
    // 역방향 조회 — 이름이 없는 유저는 검색으로는 못 찾음, channel_id 직접 검색은 아직 미지원).
    const { data: matchedUsers, error: userError } = await admin
      .from("users")
      .select("channel_id")
      .ilike("channel_name", `%${q.trim()}%`);
    if (userError) throw new Error(`users 검색 실패: ${userError.message}`);
    channelIdFilter = (matchedUsers ?? []).map((u) => u.channel_id);
    if (channelIdFilter.length === 0) return { entries: [], totalCount: 0 };
  }

  const cutoffIso = new Date(Date.now() - POINTS_LOG_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const offset = (page - 1) * POINTS_LOG_PAGE_SIZE;

  let query = admin
    .from("points_ledger")
    .select("id, channel_id, amount, reason, processed, admin_action, undone, created_at", { count: "exact" })
    .gte("created_at", cutoffIso)
    .order("created_at", { ascending: false })
    .range(offset, offset + POINTS_LOG_PAGE_SIZE - 1);
  if (channelIdFilter) query = query.in("channel_id", channelIdFilter);

  const { data: rows, error, count } = await query;
  if (error) throw new Error(`points_ledger 조회 실패: ${error.message}`);
  if (!rows || rows.length === 0) return { entries: [], totalCount: count ?? 0 };

  const channelIds = [...new Set(rows.map((r) => r.channel_id))];
  const { data: users, error: usersError } = await admin
    .from("users")
    .select("channel_id, channel_name")
    .in("channel_id", channelIds);
  if (usersError) throw new Error(`users 조회 실패: ${usersError.message}`);
  const nameByChannel = new Map((users ?? []).map((u) => [u.channel_id, u.channel_name]));

  const entries = rows.map((r) => ({
    id: r.id,
    channelId: r.channel_id,
    channelName: nameByChannel.get(r.channel_id) ?? null,
    amount: r.amount,
    reason: r.reason,
    processed: r.processed,
    adminAction: r.admin_action,
    undone: r.undone,
    createdAt: r.created_at,
  }));

  return { entries, totalCount: count ?? 0 };
}

export const SPEND_LOG_PAGE_SIZE = 10;

// listPointsLog와 거의 같지만 (1) 상점 사용 기록만 걸러내고 (2) 24시간 제한이 없음 — "상점 내역"
// 탭은 처리완료 체크를 위한 전용 화면이라, 예전에 놓친 것도 뒤늦게 찾아서 체크할 수 있어야 함.
export async function listSpendLog(
  admin: ReturnType<typeof getAdminClient>,
  q: string | undefined,
  page: number,
) {
  let channelIdFilter: string[] | null = null;
  if (q && q.trim().length > 0) {
    const { data: matchedUsers, error: userError } = await admin
      .from("users")
      .select("channel_id")
      .ilike("channel_name", `%${q.trim()}%`);
    if (userError) throw new Error(`users 검색 실패: ${userError.message}`);
    channelIdFilter = (matchedUsers ?? []).map((u) => u.channel_id);
    if (channelIdFilter.length === 0) return { entries: [], totalCount: 0 };
  }

  const offset = (page - 1) * SPEND_LOG_PAGE_SIZE;

  let query = admin
    .from("points_ledger")
    .select("id, channel_id, amount, reason, processed, title_purchase, created_at", { count: "exact" })
    .like("reason", "포인트 상점 사용:%")
    .order("created_at", { ascending: false })
    .range(offset, offset + SPEND_LOG_PAGE_SIZE - 1);
  if (channelIdFilter) query = query.in("channel_id", channelIdFilter);

  const { data: rows, error, count } = await query;
  if (error) throw new Error(`points_ledger 조회 실패: ${error.message}`);
  if (!rows || rows.length === 0) return { entries: [], totalCount: count ?? 0 };

  const channelIds = [...new Set(rows.map((r) => r.channel_id))];
  const { data: users, error: usersError } = await admin
    .from("users")
    .select("channel_id, channel_name")
    .in("channel_id", channelIds);
  if (usersError) throw new Error(`users 조회 실패: ${usersError.message}`);
  const nameByChannel = new Map((users ?? []).map((u) => [u.channel_id, u.channel_name]));

  const entries = rows.map((r) => ({
    id: r.id,
    channelId: r.channel_id,
    channelName: nameByChannel.get(r.channel_id) ?? null,
    amount: r.amount,
    reason: r.reason,
    processed: r.processed,
    titlePurchase: r.title_purchase === true,
    createdAt: r.created_at,
  }));

  return { entries, totalCount: count ?? 0 };
}

// --- predictions (투표/승부예측) ---
// 치지직 승부예측과 같은 pari-mutuel 방식 — 관리자가 만들고(create-prediction), 시간 지나면
// 승자를 골라서(resolve-prediction) 정산하거나, 필요하면 중간에 취소해서 전액 환불함
// (cancel-prediction). 유저 쪽 조회/베팅은 predictions 함수(별도)에서 처리 — 여기는 관리자
// 전용 생성/취소/정산 + 개별 베팅 내역 조회(get-prediction-status, 요청사항에 따라 관리자에게는
// 익명 처리 없이 그대로 보여줌).
