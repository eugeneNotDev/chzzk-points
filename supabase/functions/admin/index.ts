// 관리자 전용 기능 (유저 검색/포인트 지급·차감/밴 처리) 한 함수에 몰아넣음.
// Authorization: Bearer <세션토큰> 필수, session.channelId가 OWNER_CHANNEL_ID와
// 일치해야만 허용 (아니면 403). 전부 POST + body.action으로 분기함.
//
// POST { action: "search-users", q?: string, page?: number }
//   → { users: [{ channelId, channelName, isPublic, banned, balance }], page, pageSize, totalCount, totalPages }
//     (channel_name ilike 검색, q 없으면 전체. 페이지당 10명 — list-points-log와 같은 페이지네이션 패턴.)
// POST { action: "adjust-points", channelId: string, amount: number, reason?: string }
//   → { channelId, balance }  (points_ledger에 한 줄 추가. amount는 음수 가능 — 차감. admin_action=true로
//     남아서 undo-adjustment로 나중에 취소할 수 있음.)
// POST { action: "set-ban", channelId: string, banned: boolean }
//   → { channelId, banned }  (밴 걸면 랭킹에서도 빠지고 재로그인도 막힘 — oauth-callback, public.ranking 참고.
//     banned=true로 새로 거는 순간 그 계정의 포인트/칭호 보유분을 전부 초기화함(resetAccountHoldings) —
//     이후 밴을 풀어도 초기화된 상태 그대로 유지되고 되돌아오지 않음. banned=false(밴 해제)는
//     초기화를 하지 않고 플래그만 내림. 이때 users.reset_at도 같이 찍어두는데, 이건 points_ledger
//     행 자체를 지우진 않지만(잔액 계산 근거 보존 — resetAccountHoldings 주석 참고) me/index.ts의
//     마이페이지 개인 로그 조회가 이 시각 이전 기록은 걸러서 안 보여주는 기준값으로 씀 — 유저
//     입장에선 로그까지 완전히 비워진 것처럼 보임. 관리자용 로그(list-points-log/get-user-detail)는
//     감사 목적이라 이 필터를 적용하지 않고 항상 전체 기록을 보여줌.)
// POST { action: "bulk-adjust-points", target: "all" | "selected", channelIds?: string[], amount: number, reason?: string }
//   → { affected: number }  (points_ledger에 대상 전원 몫으로 한 줄씩 insert. amount는 음수 가능 — 일괄 차감.
//     target="all"이면 서버가 banned=false && 관리자 계정 제외한 전체 유저를 대상으로 계산함(클라이언트가
//     보고 있는 검색 목록/페이지와 무관하게 진짜 전체). target="selected"면 channelIds에 담아 보낸 유저들만
//     대상 — 관리자 화면에서 체크박스로 고른 유저 목록. 각 행 admin_action=true로 남아서 개별로
//     undo-adjustment 취소 가능.)
// POST { action: "undo-adjustment", id: number }
//   → { id, undone: true } | { error: "not_found" | "not_undoable" | "already_undone" }
//     (points_ledger의 한 행(adjust-points/bulk-adjust-points로 생긴 admin_action=true 행만 대상)을
//     취소함 — 원래 행을 지우거나 고치지 않고, 반대 부호의 보정 행을 새로 추가하는 방식(reason:
//     "실행취소: <원래 reason>", admin_action=false — 보정 행 자체는 다시 취소 대상이 아님).
//     원래 행엔 undone=true를 세워서 중복 취소를 막음. 출석체크/상점 사용/밴 초기화 등 admin_action이
//     아닌 행은 애초에 대상이 아니라서 "not_undoable"로 거절함 — 프론트에서 버튼 자체를 admin_action
//     행에만 보여주지만(admin.html), 여기서도 한 번 더 확인함.)
// POST { action: "list-points-log", q?: string, page?: number }
//   → { entries: [{ id, channelId, channelName, amount, reason, processed, adminAction, undone, createdAt }], page, pageSize, totalCount, totalPages }
//     (points_ledger 최근 기록(지급/차감/상점 사용/출석체크 등 전부), 페이지당 10개. q 있으면 그
//     이름을 가진 유저 기록만, 없으면 전체 유저 통틀어 최신순 — 오버레이 놓쳤을 때 누가 언제 뭘
//     했는지 훑어보는 용도. 최근 24시간 것만 보여줌 — 그 이상 지난 관리자 모니터링용 로그는
//     화면에 굳이 안 보여줘도 된다고 판단(요청사항). 단, 이건 "화면 표시" 필터일 뿐 points_ledger
//     자체에서 실제로 지우진 않음 — 이 테이블은 잔액 계산의 근거(getBalance가 여기 전체를
//     합산)라서 오래된 행을 진짜 삭제하면 유저 잔액이 깨짐. 마이페이지 개인 로그(me/index.ts)는
//     이 24시간 제한 없이 전체 기록을 그대로 보여줌.
//     처리완료 체크는 여기 없음 — 상점 사용 처리는 아래 list-spend-log 전용 화면에서만 함
//     (한 화면에 모든 종류 기록 + 체크박스가 섞여 있으니 오히려 헷갈린다는 피드백으로 분리함).
// POST { action: "list-spend-log", q?: string, page?: number }
//   → { entries: [{ id, channelId, channelName, amount, reason, processed, createdAt }], page, pageSize, totalCount, totalPages }
//     (points_ledger에서 상점 사용("포인트 상점 사용: ..." reason) 기록만 걸러서 보여줌 —
//     list-points-log와 달리 24시간 제한 없이 전체 기간. 예전에 처리해둔 것도 나중에 다시 찾아볼
//     수 있어야 해서 기간을 안 자름. admin.html의 "상점 내역" 탭 전용 — 처리완료 체크박스는 여기
//     항목에만 뜸.)
// POST { action: "set-processed", id: number, processed: boolean }
//   → { id, processed }  (points_ledger 한 행의 처리완료 표시를 토글. 오버레이 상점 사용 알림을
//     놓쳤을 때, 상점 내역에서 이미 처리한 건지 체크해두는 용도 — 0019_admin_features.sql 참고.
//     어떤 행에든 걸 수 있는 범용 필드지만, 화면(admin.html)에서는 상점 내역 탭에서만 씀.)
// POST { action: "bulk-set-processed", ids: number[], processed: boolean }
//   → { affected: number }  (points_ledger 여러 행의 처리완료 표시를 한 번에 토글 — 상점 내역
//     탭에서 체크박스로 여러 항목을 고른 뒤 "일괄 처리완료로 표시" 같은 버튼을 누르면 여기로
//     들어옴. set-processed와 같은 컬럼을 건드리지만 여러 id를 한 쿼리로 처리.)
// POST { action: "get-stats" }
//   → { userCount, bannedCount, totalPoints, todaySpendCount, todayAttendanceCount }
//     (관리자 페이지 상단 요약 카드용 — 전체 가입자 수, 밴된 유저 수, 현재 전체 유저 잔액 합계,
//     오늘(KST) 상점 사용 건수, 오늘(KST) 출석체크 인원.)
// POST { action: "get-user-detail", channelId: string, page?: number }
//   → { channelId, channelName, isPublic, banned, createdAt, maxBalanceReached, balance,
//       attendanceCount, log: [{ id, amount, reason, processed, adminAction, undone, createdAt }],
//       page, pageSize, totalCount, totalPages }
//     (유저 한 명의 전체 내역 — list-points-log와 달리 24시간 제한 없이 전체 기간, 페이지당 10개.
//     관리자 유저 목록에서 행을 클릭하면 뜨는 상세 모달용.)

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

const ADMIN_USER_PAGE_SIZE = 10;

async function searchUsers(admin: ReturnType<typeof getAdminClient>, q: string | undefined, page: number) {
  const offset = (page - 1) * ADMIN_USER_PAGE_SIZE;
  let query = admin
    .from("users")
    .select("channel_id, channel_name, is_public, banned", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + ADMIN_USER_PAGE_SIZE - 1);
  if (q && q.trim().length > 0) {
    query = query.ilike("channel_name", `%${q.trim()}%`);
  }
  const { data: users, error, count } = await query;
  if (error) throw new Error(`users 검색 실패: ${error.message}`);
  if (!users || users.length === 0) return { users: [], totalCount: count ?? 0 };

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

  const mapped = users.map((u) => ({
    channelId: u.channel_id,
    channelName: u.channel_name,
    isPublic: u.is_public,
    banned: u.banned,
    balance: balanceByChannel.get(u.channel_id) ?? 0,
  }));
  return { users: mapped, totalCount: count ?? 0 };
}

async function adjustPoints(
  admin: ReturnType<typeof getAdminClient>,
  channelId: string,
  amount: number,
  reason: string,
) {
  const { error: insertError } = await admin
    .from("points_ledger")
    .insert({ channel_id: channelId, amount, reason: reason || "관리자 지급/차감", admin_action: true });
  if (insertError) throw new Error(`points_ledger insert 실패: ${insertError.message}`);

  const { data: ledgerRows, error: ledgerError } = await admin
    .from("points_ledger")
    .select("amount")
    .eq("channel_id", channelId);
  if (ledgerError) throw new Error(`points_ledger 조회 실패: ${ledgerError.message}`);
  const balance = (ledgerRows ?? []).reduce((sum, row) => sum + row.amount, 0);
  return balance;
}

// 밴 처리 시 계정이 보유한 것들을 전부 초기화함(요청사항: "밴을 하면 이후에 풀든 뭘 하든 해당
// 계정은 초기화" — 즉 되돌아오지 않는 일회성 초기화). points_ledger는 잔액 계산의 근거라 행을
// 지우지 않고, 대신 현재 잔액을 0으로 만드는 보정 행을 하나 추가함(감사 기록도 남음). 그 외
// max_balance_reached(포인트 구간 칭호 자동 판정 기준)와 selected_title_id(상점 칭호 장착)는
// 직접 0/null로 되돌리고, user_purchased_titles(구매한 칭호 보유 기록)는 행 자체를 지움 — 나중에
// 밴이 풀려도 이 셋은 그대로 초기화된 채로 남음(0022_title_tiers.sql의 자동 배지 구조라, 다시
// 포인트를 쌓아야만 구간 칭호가 재부여됨).
// resetTimestamp: setBan에서 미리 계산해서 넘겨주는 시각(ISO 문자열) — 아래 보정 행의 created_at과
// users.reset_at(호출부에서 세팅)을 정확히 같은 값으로 맞추기 위함. 각자 따로 now()를 부르면(DB
// 트리거의 now()든 별도 insert/update 문의 now()든) 두 값이 미세하게 어긋날 수 있고, 그러면
// me/index.ts가 "reset_at보다 이후"로 거르는 필터가 이 보정 행 자체를 걸러내지 못해 유저 로그에
// "계정 정지 처리: 포인트 초기화" 행이 그대로 남아버림 — 그걸 막으려고 같은 값을 명시적으로 씀.
async function resetAccountHoldings(admin: ReturnType<typeof getAdminClient>, channelId: string, resetTimestamp: string) {
  const { data: ledgerRows, error: ledgerError } = await admin
    .from("points_ledger")
    .select("amount")
    .eq("channel_id", channelId);
  if (ledgerError) throw new Error(`points_ledger 조회 실패: ${ledgerError.message}`);
  const balance = (ledgerRows ?? []).reduce((sum, row) => sum + row.amount, 0);

  if (balance !== 0) {
    const { error: insertError } = await admin.from("points_ledger").insert({
      channel_id: channelId,
      amount: -balance,
      reason: "계정 정지 처리: 포인트 초기화",
      created_at: resetTimestamp,
    });
    if (insertError) throw new Error(`points_ledger insert 실패: ${insertError.message}`);
  }

  const { error: purchasedError } = await admin
    .from("user_purchased_titles")
    .delete()
    .eq("channel_id", channelId);
  if (purchasedError) throw new Error(`user_purchased_titles 삭제 실패: ${purchasedError.message}`);
}

async function setBan(admin: ReturnType<typeof getAdminClient>, channelId: string, banned: boolean) {
  if (banned) {
    const resetTimestamp = new Date().toISOString();
    await resetAccountHoldings(admin, channelId, resetTimestamp);
    const { error } = await admin
      .from("users")
      .update({ banned: true, max_balance_reached: 0, selected_title_id: null, reset_at: resetTimestamp })
      .eq("channel_id", channelId);
    if (error) throw new Error(`banned 갱신 실패: ${error.message}`);
    return;
  }
  const { error } = await admin.from("users").update({ banned: false }).eq("channel_id", channelId);
  if (error) throw new Error(`banned 갱신 실패: ${error.message}`);
}

// target="all"용 — banned 유저와 관리자 계정(OWNER_CHANNEL_ID)은 제외한 전체 채널ID 목록.
async function getAllActiveChannelIds(admin: ReturnType<typeof getAdminClient>): Promise<string[]> {
  const { data, error } = await admin
    .from("users")
    .select("channel_id")
    .eq("banned", false)
    .neq("channel_id", OWNER_CHANNEL_ID);
  if (error) throw new Error(`users 조회 실패: ${error.message}`);
  return (data ?? []).map((u) => u.channel_id);
}

async function bulkAdjustPoints(
  admin: ReturnType<typeof getAdminClient>,
  channelIds: string[],
  amount: number,
  reason: string,
): Promise<number> {
  if (channelIds.length === 0) return 0;
  const rows = channelIds.map((channelId) => ({
    channel_id: channelId,
    amount,
    reason: reason || "관리자 일괄 지급/차감",
    admin_action: true,
  }));
  const { error } = await admin.from("points_ledger").insert(rows);
  if (error) throw new Error(`points_ledger 일괄 insert 실패: ${error.message}`);
  return channelIds.length;
}

// 관리자 지급/차감 실행취소. 원래 행을 지우거나 고치지 않고(잔액 계산 근거 보존 — resetAccountHoldings와
// 같은 원칙) 반대 부호의 보정 행을 새로 추가하는 방식. admin_action=true인 행만 대상 — 텍스트(reason)
// 매칭이 아니라 0024_admin_adjustment_undo.sql에서 추가한 컬럼으로 판정하므로, 관리자가 reason을
// 자유 입력했어도 정확히 걸러짐. 이미 취소된 행(undone=true)은 다시 취소 못 하게 막음.
async function undoAdjustment(admin: ReturnType<typeof getAdminClient>, id: number) {
  const { data: row, error: rowError } = await admin
    .from("points_ledger")
    .select("id, channel_id, amount, reason, admin_action, undone")
    .eq("id", id)
    .maybeSingle();
  if (rowError) throw new Error(`points_ledger 조회 실패: ${rowError.message}`);
  if (!row) return { ok: false as const, error: "not_found" as const };
  if (!row.admin_action) return { ok: false as const, error: "not_undoable" as const };
  if (row.undone) return { ok: false as const, error: "already_undone" as const };

  const { error: insertError } = await admin.from("points_ledger").insert({
    channel_id: row.channel_id,
    amount: -row.amount,
    reason: `실행취소: ${row.reason}`,
    admin_action: false,
  });
  if (insertError) throw new Error(`points_ledger insert 실패: ${insertError.message}`);

  const { error: updateError } = await admin.from("points_ledger").update({ undone: true }).eq("id", id);
  if (updateError) throw new Error(`undone 갱신 실패: ${updateError.message}`);

  return { ok: true as const };
}

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

async function setProcessed(admin: ReturnType<typeof getAdminClient>, id: number, processed: boolean) {
  const { error } = await admin.from("points_ledger").update({ processed }).eq("id", id);
  if (error) throw new Error(`processed 갱신 실패: ${error.message}`);
}

async function bulkSetProcessed(admin: ReturnType<typeof getAdminClient>, ids: number[], processed: boolean): Promise<number> {
  if (ids.length === 0) return 0;
  const { error } = await admin.from("points_ledger").update({ processed }).in("id", ids);
  if (error) throw new Error(`processed 일괄 갱신 실패: ${error.message}`);
  return ids.length;
}

async function getStats(admin: ReturnType<typeof getAdminClient>) {
  const todayStr = kstDateString(new Date());
  // 오늘(KST) 00:00을 UTC ISO로 — spend_events.created_at(timestamptz) 비교용.
  const todayStartIso = new Date(`${todayStr}T00:00:00+09:00`).toISOString();

  const [
    { count: userCount, error: userCountError },
    { count: bannedCount, error: bannedCountError },
    { data: ledgerRows, error: ledgerError },
    { count: todaySpendCount, error: spendCountError },
    { count: todayAttendanceCount, error: attendanceCountError },
  ] = await Promise.all([
    admin.from("users").select("*", { count: "exact", head: true }),
    admin.from("users").select("*", { count: "exact", head: true }).eq("banned", true),
    admin.from("points_ledger").select("amount"),
    admin.from("spend_events").select("*", { count: "exact", head: true }).gte("created_at", todayStartIso),
    admin.from("attendance").select("*", { count: "exact", head: true }).eq("attended_on", todayStr),
  ]);
  for (const e of [userCountError, bannedCountError, ledgerError, spendCountError, attendanceCountError]) {
    if (e) throw new Error(`통계 조회 실패: ${e.message}`);
  }

  const totalPoints = (ledgerRows ?? []).reduce((sum, row) => sum + row.amount, 0);

  return {
    userCount: userCount ?? 0,
    bannedCount: bannedCount ?? 0,
    totalPoints,
    todaySpendCount: todaySpendCount ?? 0,
    todayAttendanceCount: todayAttendanceCount ?? 0,
  };
}

// 유저 상세 모달은 팝업 안에 들어가는 목록이라 한 페이지에 10개씩 보여주면 스크롤이 길어져서
// 5개로 줄임 (요청사항) — 포인트 로그/상점 내역 탭은 페이지 전체를 쓰는 목록이라 그대로 10개.
const USER_DETAIL_LOG_PAGE_SIZE = 5;

async function getUserDetail(admin: ReturnType<typeof getAdminClient>, channelId: string, page: number) {
  const { data: user, error: userError } = await admin
    .from("users")
    .select("channel_id, channel_name, is_public, banned, created_at, max_balance_reached")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (userError) throw new Error(`users 조회 실패: ${userError.message}`);
  if (!user) return null;

  const offset = (page - 1) * USER_DETAIL_LOG_PAGE_SIZE;

  const [
    { data: balanceRows, error: balanceError },
    { data: logRows, error: logError, count: logTotalCount },
    { count: attendanceCount, error: attendanceError },
  ] = await Promise.all([
    admin.from("points_ledger").select("amount").eq("channel_id", channelId),
    admin
      .from("points_ledger")
      .select("id, amount, reason, processed, admin_action, undone, created_at", { count: "exact" })
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .range(offset, offset + USER_DETAIL_LOG_PAGE_SIZE - 1),
    admin.from("attendance").select("*", { count: "exact", head: true }).eq("channel_id", channelId),
  ]);
  if (balanceError) throw new Error(`points_ledger 조회 실패: ${balanceError.message}`);
  if (logError) throw new Error(`points_ledger 조회 실패: ${logError.message}`);
  if (attendanceError) throw new Error(`attendance 조회 실패: ${attendanceError.message}`);

  const balance = (balanceRows ?? []).reduce((sum, row) => sum + row.amount, 0);
  const log = (logRows ?? []).map((r) => ({
    id: r.id,
    amount: r.amount,
    reason: r.reason,
    processed: r.processed,
    adminAction: r.admin_action,
    undone: r.undone,
    createdAt: r.created_at,
  }));

  return {
    channelId: user.channel_id,
    channelName: user.channel_name,
    isPublic: user.is_public,
    banned: user.banned,
    createdAt: user.created_at,
    maxBalanceReached: user.max_balance_reached,
    balance,
    attendanceCount: attendanceCount ?? 0,
    log,
    logTotalCount: logTotalCount ?? 0,
  };
}

const POINTS_LOG_PAGE_SIZE = 10;
const POINTS_LOG_WINDOW_HOURS = 24;

async function listPointsLog(
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

const SPEND_LOG_PAGE_SIZE = 10;

// listPointsLog와 거의 같지만 (1) 상점 사용 기록만 걸러내고 (2) 24시간 제한이 없음 — "상점 내역"
// 탭은 처리완료 체크를 위한 전용 화면이라, 예전에 놓친 것도 뒤늦게 찾아서 체크할 수 있어야 함.
async function listSpendLog(
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
    .select("id, channel_id, amount, reason, processed, created_at", { count: "exact" })
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
    createdAt: r.created_at,
  }));

  return { entries, totalCount: count ?? 0 };
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
      const q = typeof body.q === "string" ? body.q : undefined;
      const rawPage = typeof body.page === "number" ? Math.trunc(body.page) : 1;
      const page = Math.max(rawPage, 1);
      const { users, totalCount } = await searchUsers(admin, q, page);
      const totalPages = Math.max(Math.ceil(totalCount / ADMIN_USER_PAGE_SIZE), 1);
      return jsonResponse({ users, page, pageSize: ADMIN_USER_PAGE_SIZE, totalCount, totalPages }, 200);
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

    if (body.action === "bulk-adjust-points") {
      const { target, amount, reason } = body;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
        return jsonResponse({ error: "invalid_amount" }, 400);
      }
      const truncAmount = Math.trunc(amount);

      let channelIds: string[];
      if (target === "all") {
        channelIds = await getAllActiveChannelIds(admin);
      } else if (target === "selected") {
        if (!Array.isArray(body.channelIds) || body.channelIds.some((c: unknown) => typeof c !== "string" || !c)) {
          return jsonResponse({ error: "invalid_channel_ids" }, 400);
        }
        channelIds = [...new Set(body.channelIds as string[])];
      } else {
        return jsonResponse({ error: "invalid_target" }, 400);
      }

      const affected = await bulkAdjustPoints(admin, channelIds, truncAmount, typeof reason === "string" ? reason : "");
      return jsonResponse({ affected }, 200);
    }

    if (body.action === "undo-adjustment") {
      const { id } = body;
      if (typeof id !== "number" || !Number.isFinite(id)) return jsonResponse({ error: "missing_id" }, 400);
      const result = await undoAdjustment(admin, Math.trunc(id));
      if (!result.ok) return jsonResponse({ error: result.error }, 400);
      return jsonResponse({ id, undone: true }, 200);
    }

    if (body.action === "list-points-log") {
      const q = typeof body.q === "string" ? body.q : undefined;
      const rawPage = typeof body.page === "number" ? Math.trunc(body.page) : 1;
      const page = Math.max(rawPage, 1);
      const { entries, totalCount } = await listPointsLog(admin, q, page);
      const totalPages = Math.max(Math.ceil(totalCount / POINTS_LOG_PAGE_SIZE), 1);
      return jsonResponse({ entries, page, pageSize: POINTS_LOG_PAGE_SIZE, totalCount, totalPages }, 200);
    }

    if (body.action === "list-spend-log") {
      const q = typeof body.q === "string" ? body.q : undefined;
      const rawPage = typeof body.page === "number" ? Math.trunc(body.page) : 1;
      const page = Math.max(rawPage, 1);
      const { entries, totalCount } = await listSpendLog(admin, q, page);
      const totalPages = Math.max(Math.ceil(totalCount / SPEND_LOG_PAGE_SIZE), 1);
      return jsonResponse({ entries, page, pageSize: SPEND_LOG_PAGE_SIZE, totalCount, totalPages }, 200);
    }

    if (body.action === "set-processed") {
      const { id, processed } = body;
      if (typeof id !== "number" || !Number.isFinite(id)) return jsonResponse({ error: "missing_id" }, 400);
      if (typeof processed !== "boolean") return jsonResponse({ error: "invalid_processed" }, 400);
      await setProcessed(admin, id, processed);
      return jsonResponse({ id, processed }, 200);
    }

    if (body.action === "bulk-set-processed") {
      const { ids, processed } = body;
      if (!Array.isArray(ids) || ids.length === 0 || ids.some((i: unknown) => typeof i !== "number" || !Number.isFinite(i))) {
        return jsonResponse({ error: "invalid_ids" }, 400);
      }
      if (typeof processed !== "boolean") return jsonResponse({ error: "invalid_processed" }, 400);
      const affected = await bulkSetProcessed(admin, ids as number[], processed);
      return jsonResponse({ affected }, 200);
    }

    if (body.action === "get-stats") {
      const stats = await getStats(admin);
      return jsonResponse(stats, 200);
    }

    if (body.action === "get-user-detail") {
      const { channelId } = body;
      if (typeof channelId !== "string" || !channelId) return jsonResponse({ error: "missing_channel_id" }, 400);
      const rawPage = typeof body.page === "number" ? Math.trunc(body.page) : 1;
      const page = Math.max(rawPage, 1);
      const detail = await getUserDetail(admin, channelId, page);
      if (!detail) return jsonResponse({ error: "user_not_found" }, 404);
      const totalPages = Math.max(Math.ceil(detail.logTotalCount / USER_DETAIL_LOG_PAGE_SIZE), 1);
      return jsonResponse({ ...detail, page, pageSize: USER_DETAIL_LOG_PAGE_SIZE, totalPages }, 200);
    }

    return jsonResponse({ error: "unknown_action" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return jsonResponse({ error: "admin_failed" }, 500);
  }
});
