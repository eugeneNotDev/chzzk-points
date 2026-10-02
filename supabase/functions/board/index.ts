// 게시판(익명 자유게시판 'free' + 방송 후기 'review') — 읽기/쓰기 전부 이 함수(service_role)로만 함
// (0056_board.sql). 자유게시판은 익명이라 작성자 channel_id가 프론트로 새면 안 돼서 테이블을 직접 못 읽게 막음.
//
// 전부 POST { action, ... }. 읽기(list/get/review-status)는 로그인 없이도 되지만, 로그인하면 "내 글" 여부와
// (관리자면) 자유게시판 작성자 닉네임이 같이 옴. 쓰기는 로그인 필수(+ 차단 유저 불가).
//
// list           { board, page? }            → { posts: [{id,title,author,commentCount,hasImages,createdAt,mine}], hasMore }
// get            { id }                      → { post, images:[url], comments:[...] }
// create         { board, title, body, images?: [path] } → { id, rewarded }  (후기 + 방송 중/종료 6시간 이내 + 첫 후기면 rewarded=100)
// update         { id, title, body, images? } → { ok }
// delete         { id }                      → { ok, revoked }  (보상 받은 후기면 100P 회수)
// comment        { postId, body }            → { ok }
// delete-comment { id }                      → { ok }
// upload-urls    { files: [{fileName,sizeBytes}] } → { uploads: [{path,token,signedUrl}] }
// review-status  {}                          → { isLive, eligible, alreadyRewarded, reward }
// 오류: 400 invalid_* / 401 unauthorized / 403 forbidden|banned / 404 not_found / 429 too_fast

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

const BUCKET = "board-images";
const PAGE_SIZE = 20;
const REVIEW_REWARD = 100;
const REVIEW_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_TITLE = 60;
const MAX_BODY = 5000;
const MAX_COMMENT = 500;
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
const POST_COOLDOWN_MS = 30_000;
const COMMENT_COOLDOWN_MS = 8_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function getAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, key);
}
type Admin = ReturnType<typeof getAdmin>;

function imageUrl(path: string) {
  return `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${BUCKET}/${path}`;
}

// 치지직 live-detail(비공식) — 방송 중이면 openDate, 꺼졌으면 마지막 방송의 openDate/closeDate("YYYY-MM-DD HH:MM:SS" KST).
interface LiveWindow { isLive: boolean; openDate: string | null; closeDate: string | null }
let liveCache: { at: number; v: LiveWindow } | null = null;
async function getLiveWindow(): Promise<LiveWindow> {
  if (liveCache && Date.now() - liveCache.at < 15_000) return liveCache.v;
  let v: LiveWindow = { isLive: false, openDate: null, closeDate: null };
  try {
    const res = await fetch(`https://api.chzzk.naver.com/service/v2/channels/${OWNER_CHANNEL_ID}/live-detail`);
    if (res.ok) {
      const c = (await res.json())?.content;
      const isLive = c?.status === "OPEN";
      v = {
        isLive,
        openDate: typeof c?.openDate === "string" ? c.openDate : null,
        closeDate: !isLive && typeof c?.closeDate === "string" ? c.closeDate : null,
      };
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
  }
  liveCache = { at: Date.now(), v };
  return v;
}

// 후기 보상 대상 방송 키(= openDate). 방송 중이거나, 끝난 지 6시간 이내면 키를 돌려주고 아니면 null.
function eligibleBroadcastKey(w: LiveWindow): string | null {
  if (!w.openDate) return null;
  if (w.isLive) return w.openDate;
  if (!w.closeDate) return null;
  const closed = Date.parse(w.closeDate.replace(" ", "T") + "+09:00");
  if (Number.isNaN(closed)) return null;
  return Date.now() - closed <= REVIEW_WINDOW_MS ? w.openDate : null;
}

function cleanText(v: unknown, max: number, min = 1): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\r\n/g, "\n").trim();
  return t.length >= min && t.length <= max ? t : null;
}

function cleanImages(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_IMAGES) return null;
  for (const p of v) {
    if (typeof p !== "string" || !/^posts\/[0-9a-f-]{36}\.(jpg|jpeg|png|gif|webp)$/.test(p)) return null;
  }
  return v as string[];
}

async function getUser(admin: Admin, channelId: string) {
  const { data } = await admin.from("users").select("channel_id, channel_name, banned").eq("channel_id", channelId).maybeSingle();
  return data as { channel_id: string; channel_name: string | null; banned: boolean } | null;
}

async function setImages(admin: Admin, postId: number, paths: string[]) {
  const { data: old } = await admin.from("board_images").select("storage_path").eq("post_id", postId);
  const keep = new Set(paths);
  const removed = (old ?? []).map((r: { storage_path: string }) => r.storage_path).filter((p: string) => !keep.has(p));
  await admin.from("board_images").delete().eq("post_id", postId);
  if (paths.length) {
    const { error } = await admin.from("board_images").insert(paths.map((p, i) => ({ post_id: postId, storage_path: p, sort_order: i })));
    if (error) throw new Error(`board_images insert 실패: ${error.message}`);
  }
  if (removed.length) await admin.storage.from(BUCKET).remove(removed);
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const session = await requireSession(req);
  const me = session?.channelId ?? null;
  const isAdmin = me === OWNER_CHANNEL_ID;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  try {
    const admin = getAdmin();

    if (action === "list") return await list(admin, body, me, isAdmin);
    if (action === "get") return await getPost(admin, body, me, isAdmin);
    if (action === "review-status") return await reviewStatus(admin, me);

    if (!session || !me) return json({ error: "unauthorized" }, 401);
    const user = await getUser(admin, me);
    if (!user) return json({ error: "unauthorized" }, 401);
    if (user.banned) return json({ error: "banned" }, 403);

    if (action === "upload-urls") return await uploadUrls(admin, body);
    if (action === "create") return await createPost(admin, body, user);
    if (action === "update") return await updatePost(admin, body, me, isAdmin);
    if (action === "delete") return await deletePost(admin, body, me, isAdmin);
    if (action === "comment") return await addComment(admin, body, me);
    if (action === "delete-comment") return await deleteComment(admin, body, me, isAdmin);
    return json({ error: "invalid_action" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "board_failed" }, 500);
  }
});

interface Who { name: string | null; badge: { name: string; color: string | null } | null }

// 작성자 정보(닉네임 + 장착 칭호). 후기 게시판 표시와 관리자의 자유게시판 작성자 확인용.
async function loadWho(admin: Admin, cids: string[]): Promise<Map<string, Who>> {
  const m = new Map<string, Who>();
  if (!cids.length) return m;
  const { data: us } = await admin.from("users").select("channel_id, channel_name, selected_title_id").in("channel_id", cids);
  const tids = [...new Set((us ?? []).map((u: any) => u.selected_title_id).filter(Boolean))];
  const titles = new Map<string, { name: string; color: string | null }>();
  if (tids.length) {
    const { data: ts } = await admin.from("titles").select("id, name, color").in("id", tids);
    for (const t of ts ?? []) titles.set(t.id, { name: t.name, color: t.color ?? null });
  }
  for (const u of us ?? []) m.set(u.channel_id, { name: u.channel_name, badge: u.selected_title_id ? titles.get(u.selected_title_id) ?? null : null });
  return m;
}

// "2026-09-26 21:00:03" → "9/26"
function broadcastLabel(key: string | null): string | null {
  const m = key ? /^\d{4}-(\d{2})-(\d{2})/.exec(key) : null;
  return m ? `${Number(m[1])}/${Number(m[2])}` : null;
}

async function list(admin: Admin, body: any, me: string | null, isAdmin: boolean) {
  const board = body.board;
  if (board !== "free" && board !== "review") return json({ error: "invalid_board" }, 400);
  const page = Math.max(0, Math.min(Number(body.page) || 0, 10000));
  const { data: posts, error, count } = await admin
    .from("board_posts")
    .select("id, title, body, channel_id, created_at, broadcast_key", { count: "exact" })
    .eq("board", board)
    .order("id", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (error) throw new Error(`board_posts 조회 실패: ${error.message}`);
  const slice = posts ?? [];
  const ids = slice.map((p: any) => p.id);

  const commentCounts = new Map<number, number>();
  const withImages = new Set<number>();
  const paid = new Set<number>();
  if (ids.length) {
    const [{ data: cs }, { data: ims }, rw] = await Promise.all([
      admin.from("board_comments").select("post_id").in("post_id", ids),
      admin.from("board_images").select("post_id").in("post_id", ids),
      board === "review"
        ? admin.from("board_review_rewards").select("post_id").in("post_id", ids).eq("revoked", false)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    for (const c of cs ?? []) commentCounts.set(c.post_id, (commentCounts.get(c.post_id) ?? 0) + 1);
    for (const i of ims ?? []) withImages.add(i.post_id);
    for (const r of rw.data ?? []) paid.add(r.post_id);
  }
  const who = board === "review" || isAdmin ? await loadWho(admin, [...new Set(slice.map((p: any) => p.channel_id))]) : new Map<string, Who>();
  return json({
    posts: slice.map((p: any) => {
      const w = who.get(p.channel_id);
      return {
        id: p.id,
        title: p.title,
        preview: String(p.body).replace(/\s+/g, " ").trim().slice(0, 120),
        author: board === "review" ? (w?.name ?? "알 수 없음") : "익명",
        badge: board === "review" ? (w?.badge ?? null) : null,
        adminName: board === "free" && isAdmin ? (w?.name ?? "알 수 없음") : null,
        broadcast: broadcastLabel(p.broadcast_key),
        paid: paid.has(p.id),
        commentCount: commentCounts.get(p.id) ?? 0,
        hasImages: withImages.has(p.id),
        createdAt: p.created_at,
        mine: me !== null && p.channel_id === me,
      };
    }),
    total: count ?? slice.length,
    pageSize: PAGE_SIZE,
  });
}

async function getPost(admin: Admin, body: any, me: string | null, isAdmin: boolean) {
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "invalid_id" }, 400);
  const { data: p } = await admin.from("board_posts").select("*").eq("id", id).maybeSingle();
  if (!p) return json({ error: "not_found" }, 404);
  const [{ data: ims }, { data: cs }, rw] = await Promise.all([
    admin.from("board_images").select("storage_path").eq("post_id", id).order("sort_order"),
    admin.from("board_comments").select("id, channel_id, body, created_at").eq("post_id", id).order("id"),
    admin.from("board_review_rewards").select("post_id").eq("post_id", id).eq("revoked", false),
  ]);
  const comments = cs ?? [];
  const review = p.board === "review";
  const who = review || isAdmin
    ? await loadWho(admin, [...new Set([p.channel_id, ...comments.map((c: any) => c.channel_id)])])
    : new Map<string, Who>();
  // 자유게시판 익명 번호: 글쓴이는 "익명(글쓴이)", 나머지는 이 글 안에서 처음 나온 순서대로 익명 1, 익명 2…
  const anonNo = new Map<string, number>();
  const view = (cid: string) => {
    const w = who.get(cid);
    if (review) return { author: w?.name ?? "알 수 없음", avatar: null as string | null, op: cid === p.channel_id, badge: w?.badge ?? null, adminName: null as string | null };
    const op = cid === p.channel_id;
    let n = 0;
    if (!op) {
      if (!anonNo.has(cid)) anonNo.set(cid, anonNo.size + 1);
      n = anonNo.get(cid)!;
    }
    return {
      author: op ? "익명(글쓴이)" : `익명 ${n}`,
      avatar: op ? "글쓴이" : `익${n}`,
      op,
      badge: null,
      adminName: isAdmin ? (w?.name ?? "알 수 없음") : null,
    };
  };
  const pv = review ? view(p.channel_id) : { author: "익명", adminName: isAdmin ? (who.get(p.channel_id)?.name ?? "알 수 없음") : null, badge: null as any };
  return json({
    post: {
      id: p.id, board: p.board, title: p.title, body: p.body,
      author: pv.author, badge: pv.badge, adminName: pv.adminName,
      broadcast: broadcastLabel(p.broadcast_key), paid: (rw.data ?? []).length > 0,
      createdAt: p.created_at, updatedAt: p.updated_at,
      mine: me !== null && p.channel_id === me, canDelete: isAdmin || (me !== null && p.channel_id === me),
    },
    images: (ims ?? []).map((i: any) => ({ path: i.storage_path, url: imageUrl(i.storage_path) })),
    comments: comments.map((c: any) => ({
      id: c.id, body: c.body, createdAt: c.created_at, ...view(c.channel_id),
      mine: me !== null && c.channel_id === me, canDelete: isAdmin || (me !== null && c.channel_id === me),
    })),
  });
}

async function reviewStatus(admin: Admin, me: string | null) {
  const w = await getLiveWindow();
  const key = eligibleBroadcastKey(w);
  let already = false;
  if (key && me) {
    const { data } = await admin.from("board_review_rewards").select("channel_id").eq("channel_id", me).eq("broadcast_key", key).maybeSingle();
    already = !!data;
  }
  return json({ isLive: w.isLive, eligible: key !== null, alreadyRewarded: already, reward: REVIEW_REWARD });
}

async function uploadUrls(admin: Admin, body: any) {
  const files = body.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_IMAGES) return json({ error: "invalid_files" }, 400);
  const uploads = [];
  for (const f of files) {
    const name = typeof f?.fileName === "string" ? f.fileName : "";
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    if (!IMAGE_EXT.has(ext)) return json({ error: "unsupported_file_type" }, 400);
    if (typeof f.sizeBytes !== "number" || f.sizeBytes > MAX_IMAGE_BYTES) return json({ error: "file_too_large" }, 400);
    const path = `posts/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw new Error(`signed upload url 발급 실패: ${error.message}`);
    uploads.push({ path: data.path, token: data.token, signedUrl: data.signedUrl });
  }
  return json({ uploads });
}

async function tooFast(admin: Admin, table: string, me: string, ms: number) {
  const { data } = await admin.from(table).select("created_at").eq("channel_id", me).order("id", { ascending: false }).limit(1);
  return !!data?.[0] && Date.now() - Date.parse(data[0].created_at) < ms;
}

async function createPost(admin: Admin, body: any, user: { channel_id: string }) {
  const board = body.board;
  if (board !== "free" && board !== "review") return json({ error: "invalid_board" }, 400);
  const title = cleanText(body.title, MAX_TITLE);
  const text = cleanText(body.body, MAX_BODY);
  const images = cleanImages(body.images);
  if (!title) return json({ error: "invalid_title" }, 400);
  if (!text) return json({ error: "invalid_body" }, 400);
  if (!images) return json({ error: "invalid_images" }, 400);
  if (await tooFast(admin, "board_posts", user.channel_id, POST_COOLDOWN_MS)) return json({ error: "too_fast" }, 429);

  let key: string | null = null;
  if (board === "review") key = eligibleBroadcastKey(await getLiveWindow());

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
  return json({ id: data.id, rewarded });
}

async function loadPost(admin: Admin, id: number) {
  const { data } = await admin.from("board_posts").select("id, board, channel_id").eq("id", id).maybeSingle();
  return data as { id: number; board: string; channel_id: string } | null;
}

async function updatePost(admin: Admin, body: any, me: string, isAdmin: boolean) {
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
  const { error } = await admin.from("board_posts").update({ title, body: text, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`board_posts update 실패: ${error.message}`);
  await setImages(admin, id, images);
  return json({ ok: true });
}

async function deletePost(admin: Admin, body: any, me: string, isAdmin: boolean) {
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
  if (ims?.length) await admin.storage.from(BUCKET).remove(ims.map((i: { storage_path: string }) => i.storage_path));
  return json({ ok: true, revoked });
}

async function addComment(admin: Admin, body: any, me: string) {
  const postId = Number(body.postId);
  const text = cleanText(body.body, MAX_COMMENT);
  if (!Number.isSafeInteger(postId) || postId <= 0) return json({ error: "invalid_id" }, 400);
  if (!text) return json({ error: "invalid_body" }, 400);
  if (!(await loadPost(admin, postId))) return json({ error: "not_found" }, 404);
  if (await tooFast(admin, "board_comments", me, COMMENT_COOLDOWN_MS)) return json({ error: "too_fast" }, 429);
  const { error } = await admin.from("board_comments").insert({ post_id: postId, channel_id: me, body: text });
  if (error) throw new Error(`board_comments insert 실패: ${error.message}`);
  return json({ ok: true });
}

async function deleteComment(admin: Admin, body: any, me: string, isAdmin: boolean) {
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "invalid_id" }, 400);
  const { data: c } = await admin.from("board_comments").select("id, channel_id").eq("id", id).maybeSingle();
  if (!c) return json({ error: "not_found" }, 404);
  if (c.channel_id !== me && !isAdmin) return json({ error: "forbidden" }, 403);
  const { error } = await admin.from("board_comments").delete().eq("id", id);
  if (error) throw new Error(`board_comments delete 실패: ${error.message}`);
  return json({ ok: true });
}
