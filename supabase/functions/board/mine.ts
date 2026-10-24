// board 함수 — 마이페이지 "내 활동", 알림.
import type { Admin } from "../_shared/db.ts";
import { json } from "../_shared/http.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";
import { broadcastLabel, loadWho } from "./common.ts";

// ---------- 마이페이지 "내 활동" ----------
// 내가 쓴 글/댓글(최근 50개씩) + 개수 + 받은 후기 보상 합계. 익명 글도 본인에게는 보여줌(본인 것만 조회하니까).
export async function myActivity(admin: Admin, me: string) {
  const [{ data: posts }, { count: postCount }, { data: comments }, { count: commentCount }, { data: rewards }] = await Promise.all([
    admin.from("board_posts").select("id, board, title, created_at, broadcast_key, hidden").eq("channel_id", me).order("id", { ascending: false }).limit(50),
    admin.from("board_posts").select("id", { count: "exact", head: true }).eq("channel_id", me),
    admin.from("board_comments").select("id, post_id, body, created_at, hidden").eq("channel_id", me).eq("deleted", false).order("id", { ascending: false }).limit(50),
    admin.from("board_comments").select("id", { count: "exact", head: true }).eq("channel_id", me).eq("deleted", false),
    admin.from("board_review_rewards").select("post_id, amount").eq("channel_id", me).eq("revoked", false),
  ]);
  const postIds = (posts ?? []).map((p: any) => p.id);
  const commentCounts = new Map<number, number>();
  if (postIds.length) {
    const { data: cs } = await admin.from("board_comments").select("post_id").in("post_id", postIds).eq("deleted", false);
    for (const c of cs ?? []) commentCounts.set(c.post_id, (commentCounts.get(c.post_id) ?? 0) + 1);
  }
  const paid = new Set((rewards ?? []).map((r: any) => r.post_id));
  const parentIds = [...new Set((comments ?? []).map((c: any) => c.post_id))];
  const parents = new Map<number, { board: string; title: string; hidden: boolean }>();
  if (parentIds.length) {
    const { data: ps } = await admin.from("board_posts").select("id, board, title, hidden").in("id", parentIds);
    for (const p of ps ?? []) parents.set(p.id, { board: p.board, title: p.title, hidden: !!p.hidden });
  }
  return json({
    posts: (posts ?? []).map((p: any) => ({
      id: p.id, board: p.board, title: p.title, createdAt: p.created_at, hidden: !!p.hidden,
      commentCount: commentCounts.get(p.id) ?? 0, broadcast: broadcastLabel(p.broadcast_key), paid: paid.has(p.id),
    })),
    comments: (comments ?? []).map((c: any) => {
      const parent = parents.get(c.post_id);
      return {
        id: c.id, postId: c.post_id, body: c.body, createdAt: c.created_at, hidden: !!c.hidden,
        board: parent?.board ?? null, postTitle: parent ? (parent.hidden ? "" : parent.title) : null,
      };
    }),
    postCount: postCount ?? 0,
    commentCount: commentCount ?? 0,
    rewardTotal: (rewards ?? []).reduce((a: number, r: any) => a + (r.amount ?? 0), 0),
  });
}

// 알림 종 — 내 글에 달린 남의 댓글, 내 댓글에 달린 남의 답글(최근 30일, 최신 30개).
// 자유게시판은 익명이라 작성자를 "익명"으로(스트리머 계정만 닉네임), 방송 후기는 닉네임.
// 삭제됐거나 신고로 가려진 댓글은 뺌. 읽음 여부는 따로 저장하지 않고 화면이 마지막으로 본 시각으로 판단.
export async function notifications(admin: Admin, me: string) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: myPosts }, { data: myComments }] = await Promise.all([
    admin.from("board_posts").select("id").eq("channel_id", me).order("id", { ascending: false }).limit(300),
    admin.from("board_comments").select("id").eq("channel_id", me).gte("created_at", since).order("id", { ascending: false }).limit(300),
  ]);
  const postIds = (myPosts ?? []).map((p: any) => p.id);
  const commentIds = (myComments ?? []).map((c: any) => c.id);
  const cols = "id, post_id, channel_id, body, created_at, reply_to_id";
  const [onPosts, replies] = await Promise.all([
    postIds.length
      ? admin.from("board_comments").select(cols).in("post_id", postIds).neq("channel_id", me).eq("deleted", false).eq("hidden", false)
          .gte("created_at", since).order("id", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] as any[] }),
    commentIds.length
      ? admin.from("board_comments").select(cols).in("reply_to_id", commentIds).neq("channel_id", me).eq("deleted", false).eq("hidden", false)
          .gte("created_at", since).order("id", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const byId = new Map<number, any>();
  // 답글이 내 글에도 달린 거면 "답글"로 보여줌(더 구체적이라)
  for (const c of onPosts.data ?? []) byId.set(c.id, { ...c, kind: "comment" });
  for (const c of replies.data ?? []) byId.set(c.id, { ...c, kind: "reply" });
  const list = [...byId.values()].sort((a, b) => b.id - a.id).slice(0, 30);
  if (!list.length) return json({ items: [] });

  const { data: posts } = await admin.from("board_posts").select("id, board, title").in("id", [...new Set(list.map((c) => c.post_id))]);
  const postMap = new Map((posts ?? []).map((p: any) => [p.id, p]));
  const named = list.filter((c) => postMap.get(c.post_id)?.board === "review" || c.channel_id === OWNER_CHANNEL_ID).map((c) => c.channel_id);
  const who = await loadWho(admin, [...new Set(named)]);
  return json({
    items: list
      .filter((c) => postMap.has(c.post_id))
      .map((c) => {
        const p: any = postMap.get(c.post_id);
        const showName = p.board === "review" || c.channel_id === OWNER_CHANNEL_ID;
        return {
          id: c.id,
          kind: c.kind,
          postId: c.post_id,
          board: p.board,
          postTitle: p.title,
          body: String(c.body).replace(/\s+/g, " ").trim().slice(0, 80),
          author: showName ? (who.get(c.channel_id)?.name ?? "알 수 없음") : "익명",
          createdAt: c.created_at,
        };
      }),
  });
}
