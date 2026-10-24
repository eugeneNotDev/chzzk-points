// board 함수 — 글 목록·글 보기·후기 작성 가능 여부.
import type { Admin } from "../_shared/db.ts";
import { json } from "../_shared/http.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";
import { PAGE_SIZE, REVIEW_REWARD, broadcastLabel, imageUrl, loadWho, reviewBroadcastKey, whoToLoad } from "./common.ts";

export async function list(admin: Admin, body: any, me: string | null, isAdmin: boolean) {
  const board = body.board;
  if (board !== "free" && board !== "review") return json({ error: "invalid_board" }, 400);
  const review = board === "review";
  const page = Math.max(0, Math.min(Number(body.page) || 0, 10000));
  // 한 페이지 글 수 — 새 사이트는 10개(size: 10), 예전 화면은 안 보내서 기본 20개 그대로.
  const size = [10, 15, 20, 30].includes(Number(body.size)) ? Number(body.size) : PAGE_SIZE;
  // 검색(선택) — q: 검색어(최대 40자), field: "title"(제목) | "all"(제목+내용) | "author"(작성자 — 방송 후기만, 자유게시판은 익명이라 안 됨).
  // ilike 특수문자(% _ \)는 글자 그대로 찾게 이스케이프, or() 문법을 깨는 , ( ) " 는 공백으로 바꿈.
  const q = String(body.q ?? "").replace(/[,()"]/g, " ").trim().slice(0, 40);
  const field = body.field === "all" || body.field === "author" ? body.field : "title";
  let query = admin
    .from("board_posts")
    .select("id, title, body, channel_id, created_at, broadcast_key, hidden", { count: "exact" })
    .eq("board", board);
  if (q) {
    const pat = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    // 신고로 가려진 글은 일반 사용자 검색 결과에 안 나옴(가려진 내용이 검색으로 새지 않게)
    if (!isAdmin) query = query.eq("hidden", false);
    if (field === "author") {
      if (!review) return json({ posts: [], total: 0, pageSize: size });
      const { data: us } = await admin.from("users").select("channel_id").ilike("channel_name", pat).limit(200);
      const cids = (us ?? []).map((u: any) => u.channel_id);
      if (!cids.length) return json({ posts: [], total: 0, pageSize: size });
      query = query.in("channel_id", cids);
    } else if (field === "all") {
      // or() 안의 큰따옴표 값은 백슬래시가 한 번 더 풀리므로 두 번 씀
      const qp = pat.replace(/\\/g, "\\\\");
      query = query.or(`title.ilike."${qp}",body.ilike."${qp}"`);
    } else {
      query = query.ilike("title", pat);
    }
  }
  const { data: posts, error, count } = await query
    .order("id", { ascending: false })
    .range(page * size, page * size + size - 1);
  // 글 수보다 뒤쪽 페이지를 달라고 하면 PostgREST가 "범위 밖" 오류(PGRST103)를 냄 → 오류 대신 빈 페이지로
  if (error?.code === "PGRST103") {
    const { count: n } = await admin.from("board_posts").select("id", { count: "exact", head: true }).eq("board", board);
    return json({ posts: [], total: n ?? 0, pageSize: size });
  }
  if (error) throw new Error(`board_posts 조회 실패: ${error.message}`);
  const slice = posts ?? [];
  const ids = slice.map((p: any) => p.id);

  const commentCounts = new Map<number, number>();
  const likeCounts = new Map<number, number>();
  const withImages = new Set<number>();
  const paid = new Set<number>();
  if (ids.length) {
    const { data: lks } = await admin.from("board_post_likes").select("post_id").in("post_id", ids);
    for (const l of lks ?? []) likeCounts.set(l.post_id, (likeCounts.get(l.post_id) ?? 0) + 1);
    const [{ data: cs }, { data: ims }, rw] = await Promise.all([
      admin.from("board_comments").select("post_id").in("post_id", ids).eq("deleted", false),
      admin.from("board_images").select("post_id").in("post_id", ids),
      review
        ? admin.from("board_review_rewards").select("post_id").in("post_id", ids).eq("revoked", false)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    for (const c of cs ?? []) commentCounts.set(c.post_id, (commentCounts.get(c.post_id) ?? 0) + 1);
    for (const i of ims ?? []) withImages.add(i.post_id);
    for (const r of rw.data ?? []) paid.add(r.post_id);
  }
  const who = await loadWho(admin, whoToLoad(review, isAdmin, [...new Set(slice.map((p: any) => p.channel_id as string))]));
  return json({
    posts: slice.map((p: any) => {
      const w = who.get(p.channel_id);
      const staff = p.channel_id === OWNER_CHANNEL_ID;
      const named = review || staff;
      // 신고로 가려진 글: 일반 사용자에겐 제목/미리보기를 아예 안 보냄. 관리자는 내용 그대로 + hidden 표시.
      const veiled = p.hidden && !isAdmin;
      return {
        id: p.id,
        hidden: !!p.hidden,
        title: veiled ? "" : p.title,
        preview: veiled ? "" : String(p.body).replace(/\s+/g, " ").trim().slice(0, 120),
        author: named ? (w?.name ?? "알 수 없음") : "익명",
        staff,
        badge: named ? (w?.badge ?? null) : null,
        adminName: !named && isAdmin ? (w?.name ?? "알 수 없음") : null,
        broadcast: broadcastLabel(p.broadcast_key),
        paid: paid.has(p.id),
        commentCount: commentCounts.get(p.id) ?? 0,
        likeCount: likeCounts.get(p.id) ?? 0,
        hasImages: !veiled && withImages.has(p.id),
        createdAt: p.created_at,
        mine: me !== null && p.channel_id === me,
      };
    }),
    total: count ?? slice.length,
    pageSize: size,
  });
}

export async function getPost(admin: Admin, body: any, me: string | null, isAdmin: boolean) {
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "invalid_id" }, 400);
  const { data: p } = await admin.from("board_posts").select("*").eq("id", id).maybeSingle();
  if (!p) return json({ error: "not_found" }, 404);
  const [{ data: ims }, { data: cs }, rw] = await Promise.all([
    admin.from("board_images").select("storage_path").eq("post_id", id).order("sort_order"),
    admin.from("board_comments").select("id, channel_id, body, created_at, hidden, parent_id, reply_to_id, deleted").eq("post_id", id).order("id"),
    admin.from("board_review_rewards").select("post_id").eq("post_id", id).eq("revoked", false),
  ]);
  const comments = cs ?? [];
  const review = p.board === "review";
  const who = await loadWho(admin, whoToLoad(review, isAdmin, [...new Set([p.channel_id as string, ...comments.map((c: any) => c.channel_id as string)])]));
  // 자유게시판 익명 번호: 글쓴이는 "익명(글쓴이)", 나머지는 이 글 안에서 처음 나온 순서대로 익명 1, 익명 2…
  // 스트리머 계정은 번호를 안 매기고 닉네임으로 보여줌.
  const anonNo = new Map<string, number>();
  const view = (cid: string) => {
    const w = who.get(cid);
    const staff = cid === OWNER_CHANNEL_ID;
    const op = cid === p.channel_id;
    if (review || staff) {
      return { author: w?.name ?? "알 수 없음", avatar: null as string | null, avatarImg: w?.img ?? null, op, staff, badge: w?.badge ?? null, adminName: null as string | null };
    }
    let n = 0;
    if (!op) {
      if (!anonNo.has(cid)) anonNo.set(cid, anonNo.size + 1);
      n = anonNo.get(cid)!;
    }
    return {
      author: op ? "익명(글쓴이)" : `익명 ${n}`,
      avatar: op ? "글쓴이" : `익${n}`,
      avatarImg: null as string | null,
      op,
      staff: false,
      badge: null,
      adminName: isAdmin ? (w?.name ?? "알 수 없음") : null,
    };
  };
  const pv = view(p.channel_id);
  const postAuthor = review || pv.staff ? pv.author : "익명";
  // 내가 이미 신고한 대상(신고 버튼 대신 "신고함" 표시용)
  const reportedPost = new Set<number>();
  const reportedComments = new Set<number>();
  if (me) {
    const { data: mine } = await admin
      .from("board_reports")
      .select("target_type, target_id")
      .eq("reporter", me)
      .eq("post_id", id);
    for (const r of mine ?? []) (r.target_type === "post" ? reportedPost : reportedComments).add(r.target_id);
  }
  // 댓글 — 익명 번호가 지워진 댓글 때문에 밀리지 않게 전부 view()를 거친 뒤, 지워진 댓글은 작성자·본문을 비움.
  // 좋아요 개수 + 내가 눌렀는지(누가 눌렀는지는 안 내려줌)
  const commentIds = (comments as any[]).map((c) => c.id);
  const [{ data: pl }, { data: cl }] = await Promise.all([
    admin.from("board_post_likes").select("channel_id").eq("post_id", id),
    commentIds.length ? admin.from("board_comment_likes").select("comment_id, channel_id").in("comment_id", commentIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const postLikeCount = (pl ?? []).length;
  const postLiked = me !== null && (pl ?? []).some((l: any) => l.channel_id === me);
  const cLikeCount = new Map<number, number>();
  const cLiked = new Set<number>();
  for (const l of (cl ?? []) as any[]) {
    cLikeCount.set(l.comment_id, (cLikeCount.get(l.comment_id) ?? 0) + 1);
    if (me !== null && l.channel_id === me) cLiked.add(l.comment_id);
  }
  const viewById = new Map<number, ReturnType<typeof view>>();
  for (const c of comments as any[]) viewById.set(c.id, view(c.channel_id));
  const byId = new Map<number, any>((comments as any[]).map((c) => [c.id, c]));
  const commentViews = (comments as any[]).map((c) => {
    const v = viewById.get(c.id)!;
    const rt = c.reply_to_id && c.reply_to_id !== c.parent_id ? byId.get(c.reply_to_id) : null;
    const replyTo = rt ? (rt.deleted ? "삭제된 댓글" : viewById.get(rt.id)!.author) : null;
    if (c.deleted) {
      return { id: c.id, parentId: c.parent_id ?? null, deleted: true, body: "", createdAt: c.created_at, author: null, avatar: null, avatarImg: null, op: false, staff: false, badge: null, adminName: null, mine: false, canDelete: false, hidden: false, reported: false, replyTo: null };
    }
    return {
      id: c.id, parentId: c.parent_id ?? null, deleted: false, replyTo,
      body: c.hidden && !isAdmin ? "" : c.body, hidden: !!c.hidden, reported: reportedComments.has(c.id),
      createdAt: c.created_at, ...v,
      likeCount: cLikeCount.get(c.id) ?? 0, liked: cLiked.has(c.id),
      mine: me !== null && c.channel_id === me, canDelete: isAdmin || (me !== null && c.channel_id === me),
    };
  });
  const postVeiled = p.hidden && !isAdmin;
  return json({
    post: {
      id: p.id, board: p.board, hidden: !!p.hidden, reported: reportedPost.has(p.id),
      title: postVeiled ? "" : p.title, body: postVeiled ? "" : p.body,
      author: postAuthor, staff: pv.staff, badge: pv.badge, avatarImg: pv.avatarImg, adminName: pv.adminName,
      broadcast: broadcastLabel(p.broadcast_key), paid: (rw.data ?? []).length > 0,
      createdAt: p.created_at, updatedAt: p.updated_at,
      likeCount: postLikeCount, liked: postLiked,
      mine: me !== null && p.channel_id === me, canDelete: isAdmin || (me !== null && p.channel_id === me),
    },
    images: postVeiled ? [] : (ims ?? []).map((i: any) => ({ path: i.storage_path, url: imageUrl(i.storage_path) })),
    comments: commentViews,
  });
}

export async function reviewStatus(admin: Admin, me: string | null) {
  const { key, isLive } = await reviewBroadcastKey(admin);
  let already = false;
  if (key && me) {
    const { data } = await admin.from("board_review_rewards").select("channel_id").eq("channel_id", me).eq("broadcast_key", key).maybeSingle();
    already = !!data;
  }
  return json({ isLive, eligible: key !== null, alreadyRewarded: already, reward: REVIEW_REWARD });
}
