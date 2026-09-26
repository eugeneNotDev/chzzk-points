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
//     자체에서 실제로 지우진 않음 — 이 테이블은 잔액 계산의 근거(users.balance가 이 기록으로
//     맞춰짐)라서 오래된 행을 진짜 삭제하면 유저 잔액이 깨짐. 마이페이지 개인 로그(me/index.ts)는
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
//       ownedTitles: [{ id, name, color, kind, equipped }],
//       page, pageSize, totalCount, totalPages }
//     (유저 한 명의 전체 내역 — list-points-log와 달리 24시간 제한 없이 전체 기간, 페이지당 10개.
//     관리자 유저 목록에서 행을 클릭하면 뜨는 상세 모달용.)
// POST { action: "grant-custom-title", channelId: string, name: string, color: "#rrggbb" | "rainbow" 등 }
//   → { title: { id, name, color, kind: "custom" } } | { error: "invalid_title_name" | "invalid_title_color" | "user_not_found" }
//     (관리자가 특정 유저한테 칭호를 직접 줌 — 이름/색을 정해서 그 유저 전용 칭호를 새로 만들고
//     보유 기록(user_purchased_titles)을 넣음. 유저가 마이페이지 칭호 목록에서 직접 장착함.)
// POST { action: "revoke-title", channelId: string, titleId: string }
//   → { revoked: true } | { error: "not_owned" }
//     (그 유저에게서 칭호 하나를 회수 — 보유 기록을 지우고 장착 중이었으면 해제. 관리자가 준
//     칭호(custom)는 더 이상 가진 사람이 없으면 칭호 자체도 지움. 상점 칭호는 상품이 남아있으니
//     칭호는 그대로 두고 이 유저의 보유 기록만 지움.)
// POST { action: "create-prediction", title: string, options: string[](2개 이상), durationMinutes: 5|10|15 }
//   → { predictionId } | { error: "already_open" | "invalid_title" | "invalid_options" | "invalid_duration" }
//     (진행 중(open)인 투표가 이미 있으면 already_open으로 거절 — "한 번에 하나만" 규칙을 여기서 지킴.)
// POST { action: "cancel-prediction", predictionId: number }
//   → { predictionId, cancelled: true } | { error: "not_found" | "not_open" }
//     (진행 중인 투표를 중도 취소하고 이미 걸린 포인트를 전액 환불함 — points_ledger에 보정 행 추가,
//     원장 행 자체는 안 지움.)
// POST { action: "resolve-prediction", predictionId: number, winningOptionId: number }
//   → { predictionId, resolved: true } | { error: "not_found" | "not_open" | "not_closed_yet" | "invalid_option" }
//     (마감시각(closes_at)이 지난 뒤에만 가능 — 정산: 전체 풀을 승자들 지분대로 나눠서 points_ledger에
//     지급 행 추가. 승리 항목에 아무도 안 걸었으면 승자가 없으니 전액 환불로 처리함.)
// POST { action: "get-prediction-status" }
//   → { prediction: null } | { prediction: { id, title, status, closesAt, resolvedAt, cancelledAt,
//       winningOptionId, options: [{ id, label, totalAmount, percent }], totalPool,
//       bets: [{ channelId, channelName, optionId, amount, payout, createdAt }] } }
//     (가장 최근 투표 1건 — 관리자 화면용이라 predictions 함수(유저용 GET)와 달리 개별 베팅 내역까지
//     그대로 보여줌(요청사항: 관리자에게는 비익명).)

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
    .select("channel_id, channel_name, is_public, banned, balance", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + ADMIN_USER_PAGE_SIZE - 1);
  if (q && q.trim().length > 0) {
    query = query.ilike("channel_name", `%${q.trim()}%`);
  }
  const { data: users, error, count } = await query;
  if (error) throw new Error(`users 검색 실패: ${error.message}`);
  if (!users || users.length === 0) return { users: [], totalCount: count ?? 0 };

  const mapped = users.map((u) => ({
    channelId: u.channel_id,
    channelName: u.channel_name,
    isPublic: u.is_public,
    banned: u.banned,
    balance: Number(u.balance ?? 0),
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
  return await getUserBalance(admin, channelId);
}

// 잔액은 users.balance(points_ledger 트리거가 자동 갱신 — 0032_users_balance.sql).
async function getUserBalance(admin: ReturnType<typeof getAdminClient>, channelId: string): Promise<number> {
  const { data, error } = await admin.from("users").select("balance").eq("channel_id", channelId).maybeSingle();
  if (error) throw new Error(`잔액 조회 실패: ${error.message}`);
  return Number(data?.balance ?? 0);
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
  const balance = await getUserBalance(admin, channelId);

  if (balance !== 0) {
    const { error: insertError } = await admin.from("points_ledger").insert({
      channel_id: channelId,
      amount: -balance,
      reason: "계정 정지 처리: 포인트 초기화",
      created_at: resetTimestamp,
    });
    if (insertError) throw new Error(`points_ledger insert 실패: ${insertError.message}`);
  }

  const { data: ownedRows, error: ownedError } = await admin
    .from("user_purchased_titles")
    .select("title_id")
    .eq("channel_id", channelId);
  if (ownedError) throw new Error(`user_purchased_titles 조회 실패: ${ownedError.message}`);

  const { error: purchasedError } = await admin
    .from("user_purchased_titles")
    .delete()
    .eq("channel_id", channelId);
  if (purchasedError) throw new Error(`user_purchased_titles 삭제 실패: ${purchasedError.message}`);

  // 관리자가 이 유저한테 줬던 칭호(custom)는 이제 주인이 없으니 칭호 자체도 정리함.
  for (const row of ownedRows ?? []) {
    await deleteCustomTitleIfUnowned(admin, row.title_id);
  }
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

// --- 관리자 커스텀 칭호 ---
// 칭호 id는 "custom-" + 랜덤 12자리(상점 상품 id와 안 겹치게 접두사를 붙임). min_points는 상점
// 칭호와 같은 "못 찍는 큰 값" — 포인트로는 안 풀리고 보유 기록으로만 가짐(me/index.ts 장착 검증도
// 그대로 통과함).
const CUSTOM_TITLE_MIN_POINTS = 999999999999;
// "#rrggbb" 또는 특수 스타일 이름("rainbow" 등) — shop-items 함수의 COLOR_PATTERN과 같은 규칙.
const TITLE_COLOR_PATTERN = /^(#[0-9a-fA-F]{6}|[a-z][a-z0-9-]{1,31})$/;
const TITLE_NAME_MAX = 20;

async function grantCustomTitle(admin: ReturnType<typeof getAdminClient>, channelId: string, name: string, color: string) {
  const { data: user, error: userError } = await admin.from("users").select("channel_id").eq("channel_id", channelId).maybeSingle();
  if (userError) throw new Error(`users 조회 실패: ${userError.message}`);
  if (!user) return { ok: false as const, error: "user_not_found" as const };

  const { data: maxSortRow } = await admin
    .from("titles")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const id = `custom-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const title = { id, name, color: color.toLowerCase(), kind: "custom" };

  const { error: titleError } = await admin.from("titles").insert({
    ...title,
    min_points: CUSTOM_TITLE_MIN_POINTS,
    sort_order: (maxSortRow?.sort_order ?? 0) + 1,
  });
  if (titleError) throw new Error(`titles insert 실패: ${titleError.message}`);

  const { error: ownError } = await admin.from("user_purchased_titles").insert({ channel_id: channelId, title_id: id });
  if (ownError) {
    await admin.from("titles").delete().eq("id", id);
    throw new Error(`user_purchased_titles insert 실패: ${ownError.message}`);
  }
  return { ok: true as const, title };
}

// 관리자 칭호(custom)인데 가진 사람이 아무도 없으면 칭호 row 자체를 지움(쓰레기 데이터 안 남게).
async function deleteCustomTitleIfUnowned(admin: ReturnType<typeof getAdminClient>, titleId: string) {
  const { data: title, error: titleError } = await admin.from("titles").select("kind").eq("id", titleId).maybeSingle();
  if (titleError) throw new Error(`titles 조회 실패: ${titleError.message}`);
  if (!title || title.kind !== "custom") return;
  const { count, error: countError } = await admin
    .from("user_purchased_titles")
    .select("*", { count: "exact", head: true })
    .eq("title_id", titleId);
  if (countError) throw new Error(`보유자 수 조회 실패: ${countError.message}`);
  if ((count ?? 0) === 0) {
    const { error } = await admin.from("titles").delete().eq("id", titleId);
    if (error) throw new Error(`titles delete 실패: ${error.message}`);
  }
}

async function revokeTitle(admin: ReturnType<typeof getAdminClient>, channelId: string, titleId: string) {
  const { data: removed, error: deleteError } = await admin
    .from("user_purchased_titles")
    .delete()
    .eq("channel_id", channelId)
    .eq("title_id", titleId)
    .select("title_id");
  if (deleteError) throw new Error(`user_purchased_titles 삭제 실패: ${deleteError.message}`);
  if (!removed || removed.length === 0) return { ok: false as const, error: "not_owned" as const };

  const { error: unequipError } = await admin
    .from("users")
    .update({ selected_title_id: null })
    .eq("channel_id", channelId)
    .eq("selected_title_id", titleId);
  if (unequipError) throw new Error(`selected_title_id 해제 실패: ${unequipError.message}`);

  await deleteCustomTitleIfUnowned(admin, titleId);
  return { ok: true as const };
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

// 유저 상세 모달은 팝업 안에 들어가는 목록이라 한 페이지에 10개씩 보여주면 스크롤이 길어져서
// 5개로 줄임 (요청사항) — 포인트 로그/상점 내역 탭은 페이지 전체를 쓰는 목록이라 그대로 10개.
const USER_DETAIL_LOG_PAGE_SIZE = 5;

async function getUserDetail(admin: ReturnType<typeof getAdminClient>, channelId: string, page: number) {
  const { data: user, error: userError } = await admin
    .from("users")
    .select("channel_id, channel_name, is_public, banned, created_at, max_balance_reached, balance, selected_title_id")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (userError) throw new Error(`users 조회 실패: ${userError.message}`);
  if (!user) return null;

  const offset = (page - 1) * USER_DETAIL_LOG_PAGE_SIZE;

  const [
    { data: logRows, error: logError, count: logTotalCount },
    { count: attendanceCount, error: attendanceError },
    { data: ownedRows, error: ownedError },
  ] = await Promise.all([
    admin
      .from("points_ledger")
      .select("id, amount, reason, processed, admin_action, undone, created_at", { count: "exact" })
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .range(offset, offset + USER_DETAIL_LOG_PAGE_SIZE - 1),
    admin.from("attendance").select("*", { count: "exact", head: true }).eq("channel_id", channelId),
    admin
      .from("user_purchased_titles")
      .select("title_id, purchased_at, titles(id, name, color, kind)")
      .eq("channel_id", channelId)
      .order("purchased_at", { ascending: true }),
  ]);
  if (logError) throw new Error(`points_ledger 조회 실패: ${logError.message}`);
  if (attendanceError) throw new Error(`attendance 조회 실패: ${attendanceError.message}`);
  if (ownedError) throw new Error(`user_purchased_titles 조회 실패: ${ownedError.message}`);

  // 보유 칭호(상점 구매 + 관리자 지급) — 상세 모달에서 보여주고 회수할 수 있게.
  // deno-lint-ignore no-explicit-any
  const ownedTitles = (ownedRows ?? []).map((r: any) => {
    const t = Array.isArray(r.titles) ? r.titles[0] : r.titles;
    return {
      id: r.title_id,
      name: t?.name ?? r.title_id,
      color: t?.color ?? null,
      kind: t?.kind ?? "shop",
      equipped: user.selected_title_id === r.title_id,
    };
  });

  const balance = Number(user.balance ?? 0);
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
    ownedTitles,
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

// --- predictions (투표/승부예측) ---
// 치지직 승부예측과 같은 pari-mutuel 방식 — 관리자가 만들고(create-prediction), 시간 지나면
// 승자를 골라서(resolve-prediction) 정산하거나, 필요하면 중간에 취소해서 전액 환불함
// (cancel-prediction). 유저 쪽 조회/베팅은 predictions 함수(별도)에서 처리 — 여기는 관리자
// 전용 생성/취소/정산 + 개별 베팅 내역 조회(get-prediction-status, 요청사항에 따라 관리자에게는
// 익명 처리 없이 그대로 보여줌).

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

async function createPrediction(
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
async function cancelPrediction(admin: ReturnType<typeof getAdminClient>, predictionId: number) {
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
async function resolvePrediction(admin: ReturnType<typeof getAdminClient>, predictionId: number, winningOptionId: number) {
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
async function getPredictionStatus(admin: ReturnType<typeof getAdminClient>) {
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

    if (body.action === "grant-custom-title") {
      const { channelId } = body;
      if (typeof channelId !== "string" || !channelId) return jsonResponse({ error: "missing_channel_id" }, 400);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length === 0 || name.length > TITLE_NAME_MAX) return jsonResponse({ error: "invalid_title_name" }, 400);
      if (typeof body.color !== "string" || !TITLE_COLOR_PATTERN.test(body.color)) {
        return jsonResponse({ error: "invalid_title_color" }, 400);
      }
      const result = await grantCustomTitle(admin, channelId, name, body.color);
      if (!result.ok) return jsonResponse({ error: result.error }, 400);
      return jsonResponse({ title: result.title }, 200);
    }

    if (body.action === "revoke-title") {
      const { channelId, titleId } = body;
      if (typeof channelId !== "string" || !channelId) return jsonResponse({ error: "missing_channel_id" }, 400);
      if (typeof titleId !== "string" || !titleId) return jsonResponse({ error: "missing_title_id" }, 400);
      const result = await revokeTitle(admin, channelId, titleId);
      if (!result.ok) return jsonResponse({ error: result.error }, 400);
      return jsonResponse({ revoked: true }, 200);
    }

    if (body.action === "create-prediction") {
      const { title, options, durationMinutes } = body;
      if (typeof title !== "string" || !title.trim()) return jsonResponse({ error: "invalid_title" }, 400);
      if (
        !Array.isArray(options) ||
        options.length < 2 ||
        options.some((o: unknown) => typeof o !== "string" || !o.trim())
      ) {
        return jsonResponse({ error: "invalid_options" }, 400);
      }
      if (![5, 10, 15].includes(durationMinutes)) return jsonResponse({ error: "invalid_duration" }, 400);
      const trimmedOptions = (options as string[]).map((o) => o.trim());
      const result = await createPrediction(admin, title.trim(), trimmedOptions, durationMinutes);
      if (!result.ok) return jsonResponse({ error: result.error }, 400);
      return jsonResponse({ predictionId: result.predictionId }, 200);
    }

    if (body.action === "cancel-prediction") {
      const { predictionId } = body;
      if (typeof predictionId !== "number" || !Number.isFinite(predictionId)) {
        return jsonResponse({ error: "missing_prediction_id" }, 400);
      }
      const result = await cancelPrediction(admin, Math.trunc(predictionId));
      if (!result.ok) return jsonResponse({ error: result.error }, 400);
      return jsonResponse({ predictionId, cancelled: true }, 200);
    }

    if (body.action === "resolve-prediction") {
      const { predictionId, winningOptionId } = body;
      if (typeof predictionId !== "number" || !Number.isFinite(predictionId)) {
        return jsonResponse({ error: "missing_prediction_id" }, 400);
      }
      if (typeof winningOptionId !== "number" || !Number.isFinite(winningOptionId)) {
        return jsonResponse({ error: "missing_winning_option_id" }, 400);
      }
      const result = await resolvePrediction(admin, Math.trunc(predictionId), Math.trunc(winningOptionId));
      if (!result.ok) return jsonResponse({ error: result.error }, 400);
      return jsonResponse({ predictionId, resolved: true }, 200);
    }

    if (body.action === "get-prediction-status") {
      const status = await getPredictionStatus(admin);
      return jsonResponse({ prediction: status }, 200);
    }

    return jsonResponse({ error: "unknown_action" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return jsonResponse({ error: "admin_failed" }, 500);
  }
});
