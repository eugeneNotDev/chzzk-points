// board 함수 — 신고, 관리자 신고 처리.
import type { Admin } from "../_shared/db.ts";
import { json } from "../_shared/http.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";
import { revokeActivity } from "./activity.ts";
import { closeReports, MAX_REPORT_MEMO, REPORT_HIDE_THRESHOLD, REPORT_RATE_MAX, REPORT_RATE_WINDOW_MS, REPORT_REASONS } from "./common.ts";
import { deleteComment, deletePost } from "./write.ts";

export async function reportTarget(admin: Admin, body: any, me: string) {
  const type = body.targetType;
  const targetId = Number(body.targetId);
  if (type !== "post" && type !== "comment") return json({ error: "invalid_target" }, 400);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return json({ error: "invalid_target" }, 400);
  if (!REPORT_REASONS.has(body.reason)) return json({ error: "invalid_reason" }, 400);
  const memo = typeof body.memo === "string" ? body.memo.trim().slice(0, MAX_REPORT_MEMO) : "";

  // 대상 + 스냅샷
  let author: string, postId: number, board: string, snapTitle = "", snapBody = "";
  if (type === "post") {
    const { data: p } = await admin.from("board_posts").select("id, board, channel_id, title, body").eq("id", targetId).maybeSingle();
    if (!p) return json({ error: "not_found" }, 404);
    author = p.channel_id; postId = p.id; board = p.board; snapTitle = p.title; snapBody = String(p.body).slice(0, 500);
  } else {
    const { data: c } = await admin.from("board_comments").select("id, post_id, channel_id, body, deleted").eq("id", targetId).maybeSingle();
    if (!c || c.deleted) return json({ error: "not_found" }, 404);
    const { data: p } = await admin.from("board_posts").select("board, title").eq("id", c.post_id).maybeSingle();
    if (!p) return json({ error: "not_found" }, 404);
    author = c.channel_id; postId = c.post_id; board = p.board; snapTitle = p.title; snapBody = String(c.body).slice(0, 500);
  }
  if (author === me) return json({ error: "own_target" }, 400);
  if (author === OWNER_CHANNEL_ID) return json({ error: "forbidden" }, 403);

  // 짧은 시간에 신고 남발 방지
  const since = new Date(Date.now() - REPORT_RATE_WINDOW_MS).toISOString();
  const { count: recent } = await admin.from("board_reports").select("id", { count: "exact", head: true }).eq("reporter", me).gte("created_at", since);
  if ((recent ?? 0) >= REPORT_RATE_MAX) return json({ error: "too_fast" }, 429);

  const { error } = await admin.from("board_reports").insert({
    target_type: type, target_id: targetId, reporter: me, reason: body.reason, memo,
    board, post_id: postId, author, snap_title: snapTitle, snap_body: snapBody,
  });
  if (error) {
    if (error.code === "23505") return json({ error: "already_reported" }, 409);
    throw new Error(`board_reports insert 실패: ${error.message}`);
  }

  // 처리 안 된 신고가 서로 다른 5명 이상이면 자동으로 가림
  const { count } = await admin
    .from("board_reports")
    .select("id", { count: "exact", head: true })
    .eq("target_type", type).eq("target_id", targetId).is("resolution", null);
  let hidden = false;
  if ((count ?? 0) >= REPORT_HIDE_THRESHOLD) {
    const table = type === "post" ? "board_posts" : "board_comments";
    await admin.from(table).update({ hidden: true }).eq("id", targetId);
    hidden = true;
    // 신고 누적으로 숨겨지면 활동 보상도 회수
    await revokeActivity(admin, type === "post" ? "post" : "comment", targetId);
  }
  return json({ ok: true, hidden });
}

export async function adminReports(admin: Admin, body: any) {
  const done = body.status === "done";
  let q = admin.from("board_reports").select("*").order("created_at", { ascending: false }).limit(done ? 300 : 1000);
  q = done ? q.not("resolution", "is", null) : q.is("resolution", null);
  const { data: rows, error } = await q;
  if (error) throw new Error(`board_reports 조회 실패: ${error.message}`);

  // 대상별로 묶기
  const groups = new Map<string, any>();
  for (const r of rows ?? []) {
    const key = `${r.target_type}:${r.target_id}:${done ? r.resolved_at : ""}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        targetType: r.target_type, targetId: r.target_id, board: r.board, postId: r.post_id, author: r.author,
        title: r.snap_title, body: r.snap_body, count: 0, reasons: {} as Record<string, number>, memos: [] as any[],
        lastAt: r.created_at, resolution: r.resolution, resolvedAt: r.resolved_at, reporters: [] as string[],
      };
      groups.set(key, g);
    }
    g.count += 1;
    g.reasons[r.reason] = (g.reasons[r.reason] ?? 0) + 1;
    if (r.memo) g.memos.push({ memo: r.memo, reporter: r.reporter });
    g.reporters.push(r.reporter);
  }
  const items = [...groups.values()];

  // 현재 숨김 상태 + 닉네임
  const postIds = items.filter((g) => g.targetType === "post").map((g) => g.targetId);
  const commentIds = items.filter((g) => g.targetType === "comment").map((g) => g.targetId);
  const hiddenSet = new Set<string>();
  const existsSet = new Set<string>();
  if (postIds.length) {
    const { data } = await admin.from("board_posts").select("id, hidden").in("id", postIds);
    for (const p of data ?? []) { existsSet.add(`post:${p.id}`); if (p.hidden) hiddenSet.add(`post:${p.id}`); }
  }
  if (commentIds.length) {
    const { data } = await admin.from("board_comments").select("id, hidden").in("id", commentIds);
    for (const c of data ?? []) { existsSet.add(`comment:${c.id}`); if (c.hidden) hiddenSet.add(`comment:${c.id}`); }
  }
  const ids = new Set<string>();
  for (const g of items) { ids.add(g.author); for (const m of g.memos) ids.add(m.reporter); }
  const names = new Map<string, string | null>();
  if (ids.size) {
    const { data } = await admin.from("users").select("channel_id, channel_name").in("channel_id", [...ids]);
    for (const u of data ?? []) names.set(u.channel_id, u.channel_name);
  }
  const out = items.map((g) => ({
    targetType: g.targetType, targetId: g.targetId, board: g.board, postId: g.postId,
    authorName: names.get(g.author) ?? "알 수 없음", title: g.title, body: g.body,
    count: g.count, reasons: g.reasons,
    memos: g.memos.map((m: any) => ({ memo: m.memo, reporterName: names.get(m.reporter) ?? "알 수 없음" })),
    lastAt: g.lastAt, resolution: g.resolution, resolvedAt: g.resolvedAt,
    hidden: hiddenSet.has(`${g.targetType}:${g.targetId}`),
    exists: existsSet.has(`${g.targetType}:${g.targetId}`),
  }));
  let openCount = out.length;
  if (done) {
    const { data: openRows } = await admin.from("board_reports").select("target_type, target_id").is("resolution", null);
    openCount = new Set((openRows ?? []).map((r: any) => `${r.target_type}:${r.target_id}`)).size;
  }
  return json({ items: out, openCount });
}

export async function adminResolve(admin: Admin, body: any) {
  const type = body.targetType;
  const targetId = Number(body.targetId);
  const action = body.resolve;
  if (type !== "post" && type !== "comment") return json({ error: "invalid_target" }, 400);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return json({ error: "invalid_target" }, 400);
  if (action !== "restore" && action !== "dismiss" && action !== "delete") return json({ error: "invalid_action" }, 400);

  if (action === "delete") {
    // 기존 삭제 로직 재사용(후기 보상 회수·이미지 정리 포함) — 관리자 권한으로 호출
    const res = type === "post"
      ? await deletePost(admin, { id: targetId }, OWNER_CHANNEL_ID, true)
      : await deleteComment(admin, { id: targetId }, OWNER_CHANNEL_ID, true);
    // 이미 지워진 대상이면 신고만 정리
    if (res.status === 404) await closeReports(admin, { type, id: targetId }, "deleted");
    return json({ ok: true });
  }
  const table = type === "post" ? "board_posts" : "board_comments";
  await admin.from(table).update({ hidden: false }).eq("id", targetId);
  await closeReports(admin, { type, id: targetId }, action === "restore" ? "restored" : "dismissed");
  return json({ ok: true });
}
