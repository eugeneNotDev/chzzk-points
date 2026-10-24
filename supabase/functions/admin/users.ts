// admin 함수 — 유저 검색·포인트 지급/차감(일괄·실행취소)·밴·유저 상세.
import { getAdminClient } from "../_shared/db.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";
import { deleteCustomTitleIfUnowned } from "./titles.ts";

export const ADMIN_USER_PAGE_SIZE = 10;

export async function searchUsers(admin: ReturnType<typeof getAdminClient>, q: string | undefined, page: number) {
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

export async function adjustPoints(
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

export async function setBan(admin: ReturnType<typeof getAdminClient>, channelId: string, banned: boolean) {
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
export async function getAllActiveChannelIds(admin: ReturnType<typeof getAdminClient>): Promise<string[]> {
  const { data, error } = await admin
    .from("users")
    .select("channel_id")
    .eq("banned", false)
    .neq("channel_id", OWNER_CHANNEL_ID);
  if (error) throw new Error(`users 조회 실패: ${error.message}`);
  return (data ?? []).map((u) => u.channel_id);
}

export async function bulkAdjustPoints(
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
export async function undoAdjustment(admin: ReturnType<typeof getAdminClient>, id: number) {
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

// 유저 상세 모달은 팝업 안에 들어가는 목록이라 한 페이지에 10개씩 보여주면 스크롤이 길어져서
// 5개로 줄임 (요청사항) — 포인트 로그/상점 내역 탭은 페이지 전체를 쓰는 목록이라 그대로 10개.
export const USER_DETAIL_LOG_PAGE_SIZE = 5;

export async function getUserDetail(admin: ReturnType<typeof getAdminClient>, channelId: string, page: number) {
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
