// 게시판(익명 자유게시판 'free' + 방송 후기 'review') — 읽기/쓰기 전부 이 함수(service_role)로만 함
// (0056_board.sql). 자유게시판은 익명이라 작성자 channel_id가 프론트로 새면 안 돼서 테이블을 직접 못 읽게 막음.
//
// 전부 POST { action, ... }. 읽기(list/get/review-status)는 로그인 없이도 되지만, 로그인하면 "내 글" 여부와
// (관리자면) 자유게시판 작성자 닉네임이 같이 옴. 쓰기는 로그인 필수(+ 차단 유저 불가).
//
// list           { board, page?, size?(10|15|20|30, 기본 20), q?, field?("title"|"all"|"author") }            → { posts: [{id,title,author,commentCount,hasImages,createdAt,mine}], hasMore }
// get            { id }                      → { post, images:[url], comments:[...] }
// create         { board, title, body, images?: [path] } → { id, rewarded, activity }  (후기 + 방송 중/종료 12시간 이내 + 첫 후기면 rewarded=100)
//                activity: { amount, reason, used?, max? } — 게시판 활동 보상(아래 ACTIVITY). reason: ok|too_short|daily_limit|own_post|per_post_limit
// update         { id, title, body, images? } → { ok }
// delete         { id }                      → { ok, revoked }  (보상 받은 후기면 100P 회수)
// comment        { postId, body, parentId?, replyToId? } → { ok, id, activity }  (답글: parentId=원댓글, replyToId=실제로 답한 댓글 — 0062_board_replies.sql)
// delete-comment { id }                      → { ok }  (답글 달린 원댓글은 "삭제된 댓글" 자리만 남김)
// upload-urls    { files: [{fileName,sizeBytes}] } → { uploads: [{path,token,signedUrl}] }
// review-status  {}                          → { isLive, eligible, alreadyRewarded, reward }
// like           { targetType: "post"|"comment", targetId, on: boolean } → { liked, count }  (0063_board_likes.sql, 내 글·댓글은 불가)
// report         { targetType: "post"|"comment", targetId, reason, memo? } → { ok, hidden }  (0057_board_reports.sql)
//                서로 다른 5명이 신고(처리 안 된 신고 기준)하면 자동으로 가림. 본인 글·스트리머 글은 신고 불가, 같은 대상은 1번만.
// notifications  {}                          → { items: [{id,kind:"comment"|"reply",postId,board,postTitle,body,author,createdAt}] }
//                최근 30일 — 내 글에 달린 남의 댓글 + 내 댓글에 달린 남의 답글(최신 30개, 로그인 필수). 읽음 여부는 화면(브라우저)이 기억.
// activity-status {}                         → { date, post: {used,max,amount,minLen}, comment: {used,max,amount,minLen,perPost} }  (오늘 남은 활동 보상)
// my-activity    {}                          → { posts, comments, postCount, commentCount, rewardTotal }  (로그인 필수, 마이페이지 "내 활동")
// admin-reports  { status: "open"|"done" }   → { items: [...], openCount }   (관리자 전용, 대상별로 묶어서)
// admin-resolve  { targetType, targetId, resolve: "restore"|"dismiss"|"delete" } → { ok }  (관리자 전용)
// 오류: 400 invalid_* / 401 unauthorized / 403 forbidden|banned / 404 not_found / 429 too_fast

import { getAdminClient } from "../_shared/db.ts";
import { json } from "../_shared/http.ts";
import { handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";
import { activityStatus } from "./activity.ts";
import { allowed, clientIp, getUser } from "./common.ts";
import { myActivity, notifications } from "./mine.ts";
import { getPost, list, reviewStatus } from "./read.ts";
import { adminReports, adminResolve, reportTarget } from "./reports.ts";
import { addComment, createPost, deleteComment, deletePost, likeTarget, updatePost, uploadUrls } from "./write.ts";

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
    const admin = getAdminClient();

    // 읽기는 로그인 없이도 되니 IP당 1분 120번까지(자동으로 마구 부르는 것 방지)
    if (action === "list" || action === "get" || action === "review-status") {
      if (!(await allowed(admin, `board_read:${me ?? clientIp(req)}`, 60, 120))) return json({ error: "too_fast" }, 429);
    }
    if (action === "list") return await list(admin, body, me, isAdmin);
    if (action === "get") return await getPost(admin, body, me, isAdmin);
    if (action === "review-status") return await reviewStatus(admin, me);

    if (!session || !me) return json({ error: "unauthorized" }, 401);
    const user = await getUser(admin, me);
    if (!user) return json({ error: "unauthorized" }, 401);
    if (user.banned) return json({ error: "banned" }, 403);

    if (action === "upload-urls") return await uploadUrls(admin, body, me);
    if (action === "create") return await createPost(admin, body, user);
    if (action === "update") return await updatePost(admin, body, me, isAdmin);
    if (action === "delete") return await deletePost(admin, body, me, isAdmin);
    if (action === "comment") return await addComment(admin, body, me);
    if (action === "delete-comment") return await deleteComment(admin, body, me, isAdmin);
    if (action === "report") return await reportTarget(admin, body, me);
    if (action === "like") return await likeTarget(admin, body, me);
    if (action === "my-activity") return await myActivity(admin, me);
    if (action === "activity-status") return await activityStatus(admin, me);
    if (action === "notifications") return await notifications(admin, me);
    if (action === "admin-reports") return isAdmin ? await adminReports(admin, body) : json({ error: "forbidden" }, 403);
    if (action === "admin-resolve") return isAdmin ? await adminResolve(admin, body) : json({ error: "forbidden" }, 403);
    return json({ error: "invalid_action" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "board_failed" }, 500);
  }
});
