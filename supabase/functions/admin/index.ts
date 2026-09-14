// 관리자 전용 기능 (유저 검색/포인트 지급·차감/밴 처리) 한 함수에 몰아넣음.
// Authorization: Bearer <세션토큰> 필수, session.channelId가 OWNER_CHANNEL_ID와
// 일치해야만 허용 (아니면 403). 전부 POST + body.action으로 분기한다.
//
// POST { action: "search-users", q?: string, page?: number }
//   → { users: [{ channelId, channelName, isPublic, banned, balance }], page, pageSize, totalCount, totalPages }
//     (channel_name ilike 검색, q 없으면 전체. 페이지당 10명 — list-points-log와 같은 페이지네이션 패턴.)
// POST { action: "adjust-points", channelId: string, amount: number, reason?: string }
//   → { channelId, balance }  (points_ledger에 한 줄 추가. amount는 음수 가능 — 차감)
// POST { action: "set-ban", channelId: string, banned: boolean }
//   → { channelId, banned }  (밴 걸면 랭킹에서도 빠지고 재로그인도 막힘 — oauth-callback, public.ranking 참고)
// POST { action: "bulk-adjust-points", target: "all" | "selected", channelIds?: string[], amount: number, reason?: string }
//   → { affected: number }  (points_ledger에 대상 전원 몫으로 한 줄씩 insert. amount는 음수 가능 — 일괄 차감.
//     target="all"이면 서버가 banned=false && 관리자 계정 제외한 전체 유저를 대상으로 계산함(클라이언트가
//     보고 있는 검색 목록/페이지와 무관하게 진짜 전체). target="selected"면 channelIds에 담아 보낸 유저들만
//     대상 — 관리자 화면에서 체크박스로 고른 유저 목록.)
// POST { action: "list-points-log", q?: string, page?: number }
//   → { entries: [{ id, channelId, channelName, amount, reason, processed, createdAt }], page, pageSize, totalCount, totalPages }
//     (points_ledger 최근 기록(지급/차감/상점 사용/출석체크 등 전부), 페이지당 10개. q 있으면 그
//     이름을 가진 유저 기록만, 없으면 전체 유저 통틀어 최신순 — 오버레이 놓쳤을 때 누가 언제 뭘
//     했는지 훑어보는 용도. 최근 24시간 것만 보여준다 — 그 이상 지난 관리자 모니터링용 로그는
//     화면에 굳이 안 보여줘도 된다고 판단(요청사항). 단, 이건 "화면 표시" 필터일 뿐 points_ledger
//     자체에서 실제로 지우진 않는다 — 이 테이블은 잔액 계산의 근거(getBalance가 여기 전체를
//     합산)라서 오래된 행을 진짜 삭제하면 유저 잔액이 깨진다. 마이페이지 개인 로그(me/index.ts)는
//     이 24시간 제한 없이 전체 기록을 그대로 보여줌.
//     처리완료 체크는 여기 없음 — 상점 사용 처리는 아래 list-spend-log 전용 화면에서만 한다
//     (한 화면에 모든 종류 기록 + 체크박스가 섞여 있으니 오히려 헷갈린다는 피드백으로 분리함).
// POST { action: "list-spend-log", q?: string, page?: number }
//   → { entries: [{ id, channelId, channelName, amount, reason, processed, createdAt }], page, pageSize, totalCount, totalPages }
//     (points_ledger에서 상점 사용("포인트 상점 사용: ..." reason) 기록만 걸러서 보여준다 —
//     list-points-log와 달리 24시간 제한 없이 전체 기간. 예전에 처리해둔 것도 나중에 다시 찾아볼
//     수 있어야 해서 기간을 안 자름. admin.html의 "상점 내역" 탭 전용 — 처리완료 체크박스는 여기
//     항목에만 뜬다.)
// POST { action: "set-processed", id: number, processed: boolean }
//   → { id, processed }  (points_ledger 한 행의 처리완료 표시를 토글. 오버레이 상점 사용 알림을
//     놓쳤을 때, 상점 내역에서 이미 처리한 건지 체크해두는 용도 — 0019_admin_features.sql 참고.
//     어떤 행에든 걸 수 있는 범용 필드지만, 화면(admin.html)에서는 상점 내역 탭에서만 쓴다.)
// POST { action: "get-stats" }
//   → { userCount, bannedCount, totalPoints, todaySpendCount, todayAttendanceCount }
//     (관리자 페이지 상단 요약 카드용 — 전체 가입자 수, 밴된 유저 수, 현재 전체 유저 잔액 합계,
//     오늘(KST) 상점 사용 건수, 오늘(KST) 출석체크 인원.)
// POST { action: "get-user-detail", channelId: string, page?: number }
//   → { channelId, channelName, isPublic, banned, createdAt, maxBalanceReached, balance,
//       attendanceCount, log: [{ id, amount, reason, processed, createdAt }], page, pageSize,
//       totalCount, totalPages }
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
  }));
  const { error } = await admin.from("points_ledger").insert(rows);
  if (error) throw new Error(`points_ledger 일괄 insert 실패: ${error.message}`);
  return channelIds.length;
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
// 5개로 줄였다 (요청사항) — 포인트 로그/상점 내역 탭은 페이지 전체를 쓰는 목록이라 그대로 10개.
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
      .select("id, amount, reason, processed, created_at", { count: "exact" })
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
    // 이름으로 먼저 유저를 찾고, 그 채널ID들의 기록만 본다 (points_ledger엔 이름이 없어서
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
    .select("id, channel_id, amount, reason, processed, created_at", { count: "exact" })
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
    createdAt: r.created_at,
  }));

  return { entries, totalCount: count ?? 0 };
}

const SPEND_LOG_PAGE_SIZE = 10;

// listPointsLog와 거의 같지만 (1) 상점 사용 기록만 걸러내고 (2) 24시간 제한이 없다 — "상점 내역"
// 탭은 처리완료 체크를 위한 전용 화면이라, 예전에 놓친 것도 뒤늦게 찾아서 체크할 수 있어야 한다.
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
