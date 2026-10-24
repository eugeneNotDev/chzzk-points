// board 함수 — 이미지 업로드, 글·댓글 쓰기·고치기·지우기, 좋아요.
import type { Admin } from "../_shared/db.ts";
import { json } from "../_shared/http.ts";
import { grantActivity, revokeActivity, tooFast } from "./activity.ts";
import { BUCKET, COMMENT_COOLDOWN_MS, IMAGE_EXT, MAX_BODY, MAX_COMMENT, MAX_IMAGES, MAX_IMAGE_BYTES, MAX_TITLE, POST_COOLDOWN_MS, REVIEW_REWARD, allowed, closeReports, cleanImages, cleanText, ownsImages, reviewBroadcastKey, setImages } from "./common.ts";

export async function uploadUrls(admin: Admin, body: any, me: string) {
  const files = body.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_IMAGES) return json({ error: "invalid_files" }, 400);
  // 업로드 주소는 10분에 10번(사진 최대 50장)까지 — 글에 안 붙일 파일을 마구 올리는 것 방지
  if (!(await allowed(admin, `board_upload:${me}`, 600, 10))) return json({ error: "too_fast" }, 429);
  await purgeStaleUploads(admin);
  const uploads = [];
  for (const f of files) {
    const name = typeof f?.fileName === "string" ? f.fileName : "";
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    if (!IMAGE_EXT.has(ext)) return json({ error: "unsupported_file_type" }, 400);
    if (typeof f.sizeBytes !== "number" || f.sizeBytes > MAX_IMAGE_BYTES) return json({ error: "file_too_large" }, 400);
    const path = `posts/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw new Error(`signed upload url 발급 실패: ${error.message}`);
    const { error: oErr } = await admin.from("board_uploads").insert({ path, channel_id: me });
    if (oErr) throw new Error(`board_uploads insert 실패: ${oErr.message}`);
    uploads.push({ path: data.path, token: data.token, signedUrl: data.signedUrl });
  }
  return json({ uploads });
}

// 주소만 받고 2시간 넘게 글에 안 붙인 사진은 지움(한 번에 50개씩, 업로드할 때마다 조금씩 정리)
async function purgeStaleUploads(admin: Admin) {
  const cutoff = new Date(Date.now() - 2 * 3600_000).toISOString();
  const { data: old } = await admin.from("board_uploads").select("path").lt("created_at", cutoff).order("created_at").limit(50);
  const paths = (old ?? []).map((r: { path: string }) => r.path);
  if (!paths.length) return;
  const { data: used } = await admin.from("board_images").select("storage_path").in("storage_path", paths);
  const usedSet = new Set((used ?? []).map((u: { storage_path: string }) => u.storage_path));
  const stale = paths.filter((p) => !usedSet.has(p));
  if (stale.length) {
    await admin.storage.from(BUCKET).remove(stale);
    await admin.from("board_uploads").delete().in("path", stale);
  }
}

export async function createPost(admin: Admin, body: any, user: { channel_id: string }) {
  const board = body.board;
  if (board !== "free" && board !== "review") return json({ error: "invalid_board" }, 400);
  const title = cleanText(body.title, MAX_TITLE);
  const text = cleanText(body.body, MAX_BODY);
  const images = cleanImages(body.images);
  if (!title) return json({ error: "invalid_title" }, 400);
  if (!text) return json({ error: "invalid_body" }, 400);
  if (!images) return json({ error: "invalid_images" }, 400);
  if (!(await ownsImages(admin, user.channel_id, images, null))) return json({ error: "invalid_images" }, 400);
  if (await tooFast(admin, "post", user.channel_id, POST_COOLDOWN_MS)) return json({ error: "too_fast" }, 429);

  let key: string | null = null;
  if (board === "review") key = (await reviewBroadcastKey(admin)).key;

  const { data, error } = await admin
    .from("board_posts")
    .insert({ board, channel_id: user.channel_id, title, body: text, broadcast_key: key })
    .select("id")
    .single();
  if (error) throw new Error(`board_posts insert 실패: ${error.message}`);
  if (images.length) await setImages(admin, data.id, images);

  let rewarded = 0;
  if (board === "review" && key) {
    // (channel_id, broadcast_key) PK → 방송 하나당 한 번만 들어감
    const { error: rErr } = await admin
      .from("board_review_rewards")
      .insert({ channel_id: user.channel_id, broadcast_key: key, post_id: data.id, amount: REVIEW_REWARD });
    if (!rErr) {
      const { error: lErr } = await admin
        .from("points_ledger")
        .insert({ channel_id: user.channel_id, amount: REVIEW_REWARD, reason: "방송 후기 보상" });
      if (lErr) {
        await admin.from("board_review_rewards").delete().eq("channel_id", user.channel_id).eq("broadcast_key", key);
        throw new Error(`후기 보상 지급 실패: ${lErr.message}`);
      }
      rewarded = REVIEW_REWARD;
    }
  }
  // 방송 후기는 후기 보상만(활동 보상 글 개수에 안 셈)
  const act = board === "free" ? await grantActivity(admin, user.channel_id, "post", data.id, text, null, null) : null;
  return json({ id: data.id, rewarded, activity: act });
}

async function loadPost(admin: Admin, id: number) {
  const { data } = await admin.from("board_posts").select("id, board, channel_id").eq("id", id).maybeSingle();
  return data as { id: number; board: string; channel_id: string } | null;
}

export async function updatePost(admin: Admin, body: any, me: string, isAdmin: boolean) {
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "invalid_id" }, 400);
  const title = cleanText(body.title, MAX_TITLE);
  const text = cleanText(body.body, MAX_BODY);
  const images = cleanImages(body.images);
  if (!title) return json({ error: "invalid_title" }, 400);
  if (!text) return json({ error: "invalid_body" }, 400);
  if (!images) return json({ error: "invalid_images" }, 400);
  const p = await loadPost(admin, id);
  if (!p) return json({ error: "not_found" }, 404);
  // 수정은 작성자 본인만(관리자는 삭제만 가능 — 남의 글 내용을 바꾸진 않음)
  if (p.channel_id !== me) return json({ error: "forbidden" }, 403);
  void isAdmin;
  if (!(await ownsImages(admin, me, images, id))) return json({ error: "invalid_images" }, 400);
  const { error } = await admin.from("board_posts").update({ title, body: text, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`board_posts update 실패: ${error.message}`);
  await setImages(admin, id, images);
  return json({ ok: true });
}

export async function deletePost(admin: Admin, body: any, me: string, isAdmin: boolean) {
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "invalid_id" }, 400);
  const p = await loadPost(admin, id);
  if (!p) return json({ error: "not_found" }, 404);
  if (p.channel_id !== me && !isAdmin) return json({ error: "forbidden" }, 403);

  // 보상 받은 후기면 먼저 100P 회수(revoked 표시를 먼저 걸어서 중복 회수 방지)
  let revoked = 0;
  if (p.board === "review") {
    const { data: rw } = await admin
      .from("board_review_rewards")
      .update({ revoked: true })
      .eq("post_id", id)
      .eq("revoked", false)
      .select("channel_id, amount");
    for (const r of rw ?? []) {
      const { error } = await admin.from("points_ledger").insert({ channel_id: r.channel_id, amount: -r.amount, reason: "방송 후기 삭제 (보상 회수)" });
      if (error) throw new Error(`후기 보상 회수 실패: ${error.message}`);
      revoked += r.amount;
    }
  }
  const { data: ims } = await admin.from("board_images").select("storage_path").eq("post_id", id);
  const { error } = await admin.from("board_posts").delete().eq("id", id);
  if (error) throw new Error(`board_posts delete 실패: ${error.message}`);
  // 이 글과 글에 달린 댓글들의 대기 중 신고를 정리(작성자가 지웠는지, 관리자가 지웠는지 구분)
  await closeReports(admin, { postId: id }, p.channel_id === me ? "author_deleted" : "deleted");
  // 활동 보상도 회수(언제 지우든)
  revoked += await revokeActivity(admin, "post", id);
  if (ims?.length) await admin.storage.from(BUCKET).remove(ims.map((i: { storage_path: string }) => i.storage_path));
  return json({ ok: true, revoked });
}

export async function addComment(admin: Admin, body: any, me: string) {
  const postId = Number(body.postId);
  const text = cleanText(body.body, MAX_COMMENT);
  if (!Number.isSafeInteger(postId) || postId <= 0) return json({ error: "invalid_id" }, 400);
  if (!text) return json({ error: "invalid_body" }, 400);
  const post = await loadPost(admin, postId);
  if (!post) return json({ error: "not_found" }, 404);
  // 답글: 원댓글은 최상위 댓글이어야 하고(답글의 답글은 같은 원댓글 아래로), 실제로 답한 댓글은 그 묶음 안에 있어야 함.
  let parentId: number | null = null;
  let replyToId: number | null = null;
  if (body.parentId !== undefined && body.parentId !== null) {
    parentId = Number(body.parentId);
    if (!Number.isSafeInteger(parentId) || parentId <= 0) return json({ error: "invalid_id" }, 400);
    const { data: parent } = await admin.from("board_comments").select("id, post_id, parent_id, deleted").eq("id", parentId).maybeSingle();
    if (!parent || parent.post_id !== postId || parent.parent_id !== null || parent.deleted) return json({ error: "not_found" }, 404);
    replyToId = parentId;
    if (body.replyToId !== undefined && body.replyToId !== null && Number(body.replyToId) !== parentId) {
      const rid = Number(body.replyToId);
      if (!Number.isSafeInteger(rid) || rid <= 0) return json({ error: "invalid_id" }, 400);
      const { data: rt } = await admin.from("board_comments").select("id, parent_id, deleted").eq("id", rid).maybeSingle();
      if (!rt || rt.parent_id !== parentId || rt.deleted) return json({ error: "not_found" }, 404);
      replyToId = rid;
    }
  }
  if (await tooFast(admin, "comment", me, COMMENT_COOLDOWN_MS)) return json({ error: "too_fast" }, 429);
  const { data: ins, error } = await admin.from("board_comments").insert({ post_id: postId, channel_id: me, body: text, parent_id: parentId, reply_to_id: replyToId }).select("id").single();
  if (error) throw new Error(`board_comments insert 실패: ${error.message}`);
  const act = post.board === "free" ? await grantActivity(admin, me, "comment", ins.id, text, postId, post.channel_id) : null; // 활동 보상은 자유게시판만(방송 후기는 따로 후기 보상)
  return json({ ok: true, id: ins.id, activity: act });
}

export async function deleteComment(admin: Admin, body: any, me: string, isAdmin: boolean) {
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "invalid_id" }, 400);
  const { data: c } = await admin.from("board_comments").select("id, channel_id, parent_id, deleted").eq("id", id).maybeSingle();
  if (!c || c.deleted) return json({ error: "not_found" }, 404);
  if (c.channel_id !== me && !isAdmin) return json({ error: "forbidden" }, 403);
  // 답글이 달린 원댓글은 자리만 남기고(본문 비움), 아니면 행을 지움.
  const { count: replyCount } = c.parent_id === null
    ? await admin.from("board_comments").select("id", { count: "exact", head: true }).eq("parent_id", id)
    : { count: 0 };
  const { error } = (replyCount ?? 0) > 0
    ? await admin.from("board_comments").update({ deleted: true, body: "" }).eq("id", id)
    : await admin.from("board_comments").delete().eq("id", id);
  if (error) throw new Error(`board_comments delete 실패: ${error.message}`);
  // 답글을 지워서 "삭제된 원댓글" 아래 답글이 하나도 안 남았으면 그 자리도 정리.
  if (c.parent_id !== null) {
    const { data: parent } = await admin.from("board_comments").select("id, deleted").eq("id", c.parent_id).maybeSingle();
    if (parent?.deleted) {
      const { count: left } = await admin.from("board_comments").select("id", { count: "exact", head: true }).eq("parent_id", parent.id);
      if ((left ?? 0) === 0) await admin.from("board_comments").delete().eq("id", parent.id);
    }
  }
  await closeReports(admin, { type: "comment", id }, c.channel_id === me ? "author_deleted" : "deleted");
  const revoked = await revokeActivity(admin, "comment", id);
  return json({ ok: true, revoked });
}

// ---------- 좋아요 ----------
export async function likeTarget(admin: Admin, body: any, me: string) {
  const type = body.targetType;
  const targetId = Number(body.targetId);
  const on = body.on === true;
  if (type !== "post" && type !== "comment") return json({ error: "invalid_target" }, 400);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return json({ error: "invalid_target" }, 400);
  const table = type === "post" ? "board_post_likes" : "board_comment_likes";
  const col = type === "post" ? "post_id" : "comment_id";
  if (type === "post") {
    const { data: p } = await admin.from("board_posts").select("id, channel_id, hidden").eq("id", targetId).maybeSingle();
    if (!p || p.hidden) return json({ error: "not_found" }, 404);
    if (p.channel_id === me) return json({ error: "own_target" }, 400);
  } else {
    const { data: c } = await admin.from("board_comments").select("id, channel_id, hidden, deleted").eq("id", targetId).maybeSingle();
    if (!c || c.hidden || c.deleted) return json({ error: "not_found" }, 404);
    if (c.channel_id === me) return json({ error: "own_target" }, 400);
  }
  if (on) {
    const { error } = await admin.from(table).upsert({ [col]: targetId, channel_id: me }, { onConflict: `${col},channel_id`, ignoreDuplicates: true });
    if (error) throw new Error(`${table} insert 실패: ${error.message}`);
  } else {
    const { error } = await admin.from(table).delete().eq(col, targetId).eq("channel_id", me);
    if (error) throw new Error(`${table} delete 실패: ${error.message}`);
  }
  const { count } = await admin.from(table).select("channel_id", { count: "exact", head: true }).eq(col, targetId);
  return json({ liked: on, count: count ?? 0 });
}
