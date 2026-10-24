import { Fragment, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { afterActivity, type ActivityGrant } from "../../lib/board";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, EyeOff, MessageCircle, Pencil, Trash2 } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { PageHead } from "../../components/ui";
import { Avatar } from "../../components/Avatar";
import { ApiError, startLogin, useAuth } from "../../lib/auth";
import { LoadError } from "../../components/LoadError";
import {
  BOARD_CFG, boardCall, boardErrCode, boardErrText, boardTime, markSeen, type BoardComment, type BoardKind, type FullPost,
} from "../../lib/board";
import { AdminChip, Who } from "./BoardList";
import { ReportModal, type ReportTarget } from "./ReportModal";
import { useListUnderneath, type ListState } from "../../lib/listBack";
import styles from "./Board.module.css";
import { alertDialog, confirmDialog, toast } from "../../lib/dialog";
import { SkeletonPost } from "../../components/Skeleton";
import { CommentForm, CommentItem } from "./Comments";
import { LikeButton, PostBody, ReportButton, authorOf } from "./PostParts";

function goBackOr(nav: ReturnType<typeof useNavigate>, fromList: boolean, fallback: string) {
  // 게시판 목록에서 들어왔으면 뒤로가기(보던 페이지·검색 유지), 홈·알림·주소로 바로 열었으면 그 게시판 목록으로
  if (fromList) nav(-1);
  else nav(fallback);
}

export function PostView({ board, id }: { board: BoardKind; id: number }) {
  const cfg = BOARD_CFG[board];
  const review = board === "review";
  const nav = useNavigate();
  const qc = useQueryClient();
  const { isLoggedIn, isAdmin, channelId } = useAuth();
  const key = ["board", "post", id, channelId];
  // 없는 글(404) 같은 4xx는 main.tsx의 기본 재시도 규칙이 바로 실패 처리 — 네트워크·서버 오류만 한 번 더
  const q = useQuery({ queryKey: key, queryFn: () => boardCall<FullPost>({ action: "get", id }) });
  const [replyTo, setReplyTo] = useState<{ parent: number; cid: number; name: string } | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (q.data) markSeen(id);
  }, [q.data, id]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  // 바로 열린 글이면 방문 기록 아래에 목록을 깔아 둠 → 뒤로가기가 항상 목록으로
  useListUnderneath(cfg.path);
  const fromList = !!(useLocation().state as ListState)?.fromList;
  const back = () => goBackOr(nav, fromList, cfg.path);
  // 모바일에선 게시판 이름(PageHead), 그 아래 왼쪽에 "← 목록"
  const head = (
    <>
      <PageHead title={cfg.name} />
      <button type="button" className={styles.backBtn} onClick={back}>
        <ArrowLeft size={18} aria-hidden="true" />
        목록
      </button>
    </>
  );

  if (q.isLoading)
    return (
      <div className="page">
        {head}
        <Card>
          <SkeletonPost />
        </Card>
      </div>
    );
  if (!q.data)
    return (
      <div className="page">
        {head}
        {/* 없는 글·볼 수 없는 글(4xx)은 다시 해도 같으니 안내만, 네트워크·서버 오류는 다시 시도할 수 있게 */}
        {q.error instanceof ApiError && q.error.status < 500 ? (
          <Card>
            <EmptyState>{boardErrCode(q.error) === "not_found" ? "삭제됐거나 없는 글이에요." : "글을 불러오지 못했어요."}</EmptyState>
          </Card>
        ) : (
          <LoadError what="글" onRetry={() => q.refetch()} />
        )}
      </div>
    );

  const { post: p, images, comments } = q.data;
  const veiled = p.hidden && !p.title;
  const refetchKeep = async (focus?: number) => {
    await qc.invalidateQueries({ queryKey: ["board", "post", id] });
    qc.invalidateQueries({ queryKey: ["board", "list", board] });
    if (focus) setFlash(focus);
  };

  const del = async () => {
    const warn = review ? p.paid
        ? "이 후기를 삭제할까요?\n후기 보상으로 받은 포인트가 함께 회수돼요."
        : "이 후기를 삭제할까요?\n받은 활동 보상 포인트가 있다면 함께 회수돼요." : "이 글을 삭제할까요?\n활동 보상으로 받은 포인트가 있다면 함께 회수돼요.";
    if (!(await confirmDialog(warn))) return;
    setDeleting(true);
    try {
      const r = await boardCall<{ revoked?: number }>({ action: "delete", id: p.id });
      if (r.revoked) {
        toast(`삭제했어요. 보상 ${r.revoked}P가 회수됐어요.`, "info");
        qc.invalidateQueries({ queryKey: ["me"] });
      }
      qc.invalidateQueries({ queryKey: ["board", "list", board] });
      qc.invalidateQueries({ queryKey: ["board", "preview"] }); // 홈 미리보기에서도 빠지게
      back();
    } catch (e) {
      setDeleting(false);
      alertDialog(boardErrText(e));
    }
  };
  const delComment = async (cid: number) => {
    if (!(await confirmDialog("댓글을 삭제할까요?\n활동 보상으로 받은 포인트가 있다면 함께 회수돼요.", { danger: true }))) return;
    try {
      const r = await boardCall<{ revoked?: number }>({ action: "delete-comment", id: cid });
      if (r.revoked) {
        toast(`삭제했어요. 보상 ${r.revoked}P가 회수됐어요.`, "info");
        qc.invalidateQueries({ queryKey: ["me"] });
      }
      qc.invalidateQueries({ queryKey: ["board", "activity"] });
      refetchKeep();
    } catch (e) {
      alertDialog(boardErrText(e));
    }
  };
  const toggleReply = (parent: number, c: BoardComment) => {
    if (replyTo?.cid === c.id) return setReplyTo(null);
    if (!isLoggedIn) return startLogin();
    setReplyTo({ parent, cid: c.id, name: authorOf(c) });
  };

  // 댓글 + 답글(한 단계). 서버가 id 순서로 평평하게 주면 원댓글(parentId 없음) 아래에 답글을 묶음.
  const tops = comments.filter((c) => !c.parentId);
  const kids = new Map<number, BoardComment[]>();
  for (const c of comments) if (c.parentId) kids.set(c.parentId, [...(kids.get(c.parentId) || []), c]);
  const reportPreview = report ? (report.type === "post" ? p.title : comments.find((c) => c.id === report.id)?.body ?? "") : "";

  return (
    <div className="page">
      {head}
      <Card>
        <article className={styles.post}>
          <div className={styles.meta}>
            {p.avatarImg && <Avatar name={authorOf(p)} image={p.avatarImg} size={24} />}
            <Who name={authorOf(p)} badge={p.badge} mine={p.mine} />
            <span className={styles.dot}>·</span>
            <span>
              {boardTime(p.createdAt)}
              {p.updatedAt && p.updatedAt !== p.createdAt ? " · 수정됨" : ""}
            </span>
            <AdminChip adminName={p.adminName} shown={p.author} />
            {p.hidden && isAdmin && <span className="tag tag-live">자동 숨김 중</span>}
            <span className={styles.metaRight}>
              <ReportButton x={p} type="post" onReport={setReport} />
            </span>
          </div>
          {veiled ? (
            <div className={styles.veil}>
              <EyeOff size={16} aria-hidden="true" /> 신고가 누적되어 가려진 글이에요
            </div>
          ) : (
            <>
              <h3 className={styles.postTitle}>
                {p.title}
                {review && p.broadcast && <span className="tag">{p.broadcast} 방송</span>}
                {review && p.paid && <span className="tag tag-accent">+100P</span>}
              </h3>
              <div className={styles.content}>
                <PostBody body={p.body} images={images} />
              </div>
              <div className={styles.likeRow}>
                <LikeButton type="post" id={p.id} liked={p.liked} count={p.likeCount} own={p.mine} big />
              </div>
            </>
          )}
          {(p.mine || p.canDelete) && (
            <div className={styles.postActions}>
              {p.mine && (
                <Link className="btn btn-ghost btn-sm" to={`${cfg.path}?post=${p.id}&edit=1`}>
                  <Pencil size={15} aria-hidden="true" /> 수정
                </Link>
              )}
              {p.canDelete && (
                <button type="button" className="btn btn-danger btn-sm" disabled={deleting} onClick={del}>
                  <Trash2 size={15} aria-hidden="true" /> 삭제
                </button>
              )}
            </div>
          )}
        </article>
      </Card>

      <Card
        title={
          <>
            <MessageCircle size={17} aria-hidden="true" /> 댓글 <span className="num">{comments.filter((c) => !c.deleted).length}</span>
          </>
        }
      >
        {tops.length === 0 && <p className={styles.noCm}>첫 댓글을 남겨보세요.</p>}
        <div className={styles.threads}>
          {tops.map((c) => {
            const rs = kids.get(c.id) || [];
            const open = replyTo?.parent === c.id;
            return (
              <div key={c.id} className={styles.thread}>
                <CommentItem
                  c={c}
                  isReply={false}
                  replyOpen={replyTo?.cid === c.id}
                  onReply={() => toggleReply(c.id, c)}
                  onDelete={() => delComment(c.id)}
                  onReport={setReport}
                  flash={flash === c.id}
                />
                {rs.length > 0 && (
                  <div className={styles.replies}>
                    {rs.map((r) => (
                      <Fragment key={r.id}>
                        <CommentItem
                          c={r}
                          isReply
                          replyOpen={replyTo?.cid === r.id}
                          onReply={() => toggleReply(c.id, r)}
                          onDelete={() => delComment(r.id)}
                          onReport={setReport}
                          flash={flash === r.id}
                        />
                      </Fragment>
                    ))}
                  </div>
                )}
                {open && replyTo && (
                  <div className={styles.rwrap}>
                    <div className={styles.rto}>
                      ↳ <b>{replyTo.name}</b>님에게 답글
                    </div>
                    <CommentForm
                      key={replyTo.cid}
                      autoFocus
                      placeholder={review || isAdmin ? "답글 남기기" : "익명으로 답글 남기기"}
                      onCancel={() => setReplyTo(null)}
                      onSubmit={async (text) => {
                        const r = await boardCall<{ id: number; activity?: ActivityGrant }>({ action: "comment", postId: p.id, body: text, parentId: replyTo.parent, replyToId: replyTo.cid });
                        setReplyTo(null);
                        afterActivity(qc, r.activity, "댓글");
                        await refetchKeep(r.id);
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className={styles.cformWrap}>
          <CommentForm
            disabled={!isLoggedIn}
            placeholder={!isLoggedIn ? "로그인하면 댓글을 쓸 수 있어요" : review ? "댓글 남기기" : isAdmin ? "댓글 남기기 (스트리머 계정은 닉네임으로 보여요)" : "익명으로 댓글 남기기"}
            onSubmit={async (text) => {
              const r = await boardCall<{ id: number; activity?: ActivityGrant }>({ action: "comment", postId: p.id, body: text });
              afterActivity(qc, r.activity, "댓글");
              await refetchKeep(r.id);
            }}
          />
          {!review && <p className={styles.note}>같은 글 안에서는 같은 사람이 같은 익명 번호로 보여요.</p>}
        </div>
      </Card>

      <ReportModal target={report} preview={reportPreview} onClose={() => setReport(null)} onDone={() => refetchKeep()} />
    </div>
  );
}
