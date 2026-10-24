// admin 함수 — 칭호 지급/회수(커스텀 칭호 만들기 포함).
import { getAdminClient } from "../_shared/db.ts";

// --- 관리자 커스텀 칭호 ---
// 칭호 id는 "custom-" + 랜덤 12자리(상점 상품 id와 안 겹치게 접두사를 붙임). min_points는 상점
// 칭호와 같은 "못 찍는 큰 값" — 포인트로는 안 풀리고 보유 기록으로만 가짐(me/index.ts 장착 검증도
// 그대로 통과함).
const CUSTOM_TITLE_MIN_POINTS = 999999999999;
// "#rrggbb" 또는 특수 스타일 이름("rainbow" 등) — shop-items 함수의 COLOR_PATTERN과 같은 규칙.
export const TITLE_COLOR_PATTERN = /^(#[0-9a-fA-F]{6}|[a-z][a-z0-9-]{1,31})$/;
export const TITLE_NAME_MAX = 20;

export async function grantCustomTitle(admin: ReturnType<typeof getAdminClient>, channelId: string, name: string, color: string) {
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
export async function deleteCustomTitleIfUnowned(admin: ReturnType<typeof getAdminClient>, titleId: string) {
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

export async function grantExistingTitle(admin: ReturnType<typeof getAdminClient>, channelId: string, titleId: string) {
  const { data: user, error: userError } = await admin.from("users").select("channel_id").eq("channel_id", channelId).maybeSingle();
  if (userError) throw new Error(`users 조회 실패: ${userError.message}`);
  if (!user) return { ok: false as const, error: "user_not_found" as const };

  const { data: title, error: titleError } = await admin.from("titles").select("id, kind").eq("id", titleId).maybeSingle();
  if (titleError) throw new Error(`titles 조회 실패: ${titleError.message}`);
  if (!title) return { ok: false as const, error: "title_not_found" as const };
  if (title.kind === "tier") return { ok: false as const, error: "not_grantable" as const };

  const { error: ownError } = await admin.from("user_purchased_titles").insert({ channel_id: channelId, title_id: titleId });
  if (ownError) {
    if (ownError.code === "23505") return { ok: false as const, error: "already_owned" as const };
    throw new Error(`user_purchased_titles insert 실패: ${ownError.message}`);
  }
  return { ok: true as const };
}

export async function revokeTitle(admin: ReturnType<typeof getAdminClient>, channelId: string, titleId: string) {
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
