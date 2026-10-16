import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { afterActivity, type ActivityGrant } from "../../lib/board";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, EyeOff, Flag, MessageCircle, Pencil, Trash2 } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { PageHead } from "../../components/ui";
import { Avatar } from "../../components/Avatar";
import { startLogin, useAuth } from "../../lib/auth";
import {
  BOARD_CFG,
  IMG_MARK_RE,
  boardCall,
  boardErrCode,
  boardErrText,
  boardTime,
  markSeen,
  type BoardComment,
  type BoardKind,
  type FullPost,
} from "../../lib/board";
import { AdminChip, Who } from "./BoardList";
import { Lightbox } from "../../components/Lightbox";
import { ReportModal, type ReportTarget } from "./ReportModal";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import styles from "./Board.module.css";
import { alertDialog, confirmDialog, toast } from "../../lib/dialog";
import { SkeletonPost } from "../../components/Skeleton";

const authorOf = (x: { adminName: string | null; author: string | null }) => x.adminName || x.author || "";

function goBackOr(nav: ReturnType<typeof useNavigate>, fromList: boolean, fallback: string) {
  // 게시판 목록에서 들어왔으면 뒤로가기(보던 페이지·검색 유지), 홈·알림·주소로 바로 열었으면 그 게시판 목록으로
  if (fromList) nav(-1);
  else nav(fallback);
}

// 본문 + 사진: [[사진:n]] 자리에 그 사진, 표시가 없는 사진(예전 글 포함)은 맨 아래 묶음.
function PostBody({ body, images }: { body: string; images: FullPost["images"] }) {
  // 누르면 크게 보기 — 넘기는 순서는 글에 보이는 순서(본문 속 사진 → 맨 아래 묶음)
  const [view, setView] = useState<number | null>(null);
  const parts = String(body).split(new RegExp(IMG_MARK_RE.source));
  const used = new Set<number>();
  const order: string[] = [];
  const imgBtn = (url: string, key: string | number, cls?: string) => {
    const idx = order.push(url) - 1;
    return (
      <button key={key} type="button" className={`${styles.imgBtn} ${cls ?? ""}`} onClick={() => setView(idx)} aria-label="사진 크게 보기">
        <img src={url} alt="" loading="lazy" />
      </button>
    );
  };
  const out = parts.map((seg, i) => {
    if (i % 2 === 1) {
      const n = Number(seg);
      const im = images[n - 1];
      if (!im || used.has(n)) return null;
      used.add(n);
      return imgBtn(im.url, i, styles.inlineImg);
    }
    const t = seg.replace(/^\n+/, "").replace(/\n+$/, "");
    return t ? (
      <div key={i} className={styles.body}>
        {t}
      </div>
    ) : null;
  });
  const rest = images.filter((_, i) => !used.has(i + 1));
  const restEls = rest.map((im) => imgBtn(im.url, im.path));
  return (
    <>
      {out}
      {rest.length > 0 && <div className={styles.images}>{restEls}</div>}
      <Lightbox images={order} index={view} onIndex={setView} onClose={() => setView(null)} />
    </>
  );
}

// 좋아요 — 누르면 바로 바뀌고(낙관적), 서버 응답 개수로 맞춤. 내 글·댓글은 못 누름(살짝 흔들기).
function LikeButton({ type, id, liked, count, own, big }: { type: "post" | "comment"; id: number; liked: boolean; count: number; own: boolean; big?: boolean }) {
  const { isLoggedIn } = useAuth();
  const [state, setState] = useState({ liked, count });
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [pop, setPop] = useState(0); // 좋아요를 누를 때만 터지는 효과(취소는 조용히)
  useEffect(() => setState({ liked, count }), [liked, count]);
  const click = async () => {
    if (!isLoggedIn) return startLogin();
    if (own) {
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }
    const before = state;
    const on = !state.liked;
    setState({ liked: on, count: Math.max(0, state.count + (on ? 1 : -1)) });
    if (on) setPop((n) => n + 1);
    setBusy(true);
    try {
      const r = await boardCall<{ liked: boolean; count: number }>({ action: "like", targetType: type, targetId: id, on });
      setState({ liked: typeof r.liked === "boolean" ? r.liked : on, count: Number.isFinite(r.count) ? r.count : Math.max(0, before.count + (on ? 1 : -1)) });
    } catch (e) {
      setState(before);
      if (boardErrCode(e) !== "own_target") alertDialog(boardErrText(e));
    } finally {
      setBusy(false);
    }
  };
  const cls = [big ? styles.likeBig : styles.likeSmall, state.liked ? styles.on : "", shake ? styles.shake : ""].join(" ");
  return (
    <button type="button" className={cls} disabled={busy} onClick={click} aria-pressed={state.liked} aria-label="좋아요" title={own ? "내 글에는 좋아요를 누를 수 없어요" : undefined}>
      <HeartBurst on={state.liked} pop={pop} size={big ? 18 : 14} />
      {big && <span>좋아요</span>}
      <span className="num">{big || state.count ? <AnimatedNumber value={Number(state.count) || 0} className={styles.likeNum} /> : ""}</span>
    </button>
  );
}

// Lucian UX/UI Prompt #022 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#022
// 좋아요 하트 터짐 — 하트가 움츠렸다가 빨갛게 차오르며 크게 뛰고(0.7s), 둘레로 고리와 작은 점 일곱 쌍이 터져 나감.
// 원본은 52px 하트 기준이라 모든 크기를 하트 크기(em) 비율로 바꿔서 작은 버튼에도 맞춤.
const BURST = [
  ["0deg", "#FF4D6D", "#FFB26B"],
  ["51deg", "#8B6CFF", "#FF7A93"],
  ["103deg", "#FFB547", "#22C3A6"],
  ["154deg", "#FF4D6D", "#8B6CFF"],
  ["206deg", "#22C3A6", "#FFB547"],
  ["257deg", "#FF7A93", "#3D8BFF"],
  ["309deg", "#3D8BFF", "#FF4D6D"],
];
const HEART_D = "M26 45S5 33 5 18.5C5 11.6 10.4 7 16.4 7c4.3 0 7.6 2.3 9.6 5.6C28 9.3 31.3 7 35.6 7 41.6 7 47 11.6 47 18.5 47 33 26 45 26 45z";
function HeartBurst({ on, pop, size }: { on: boolean; pop: number; size: number }) {
  return (
    <span key={pop} className={`${styles.hb} ${on ? styles.hbOn : ""} ${pop && on ? styles.hbPop : ""}`} style={{ fontSize: size }} aria-hidden="true">
      <span className={styles.hbRing} />
      {BURST.map(([a, c, c2]) => (
        <span key={a} className={styles.hbDot} style={{ "--a": a, "--c": c, "--c2": c2 } as React.CSSProperties}>
          <i />
          <i />
        </span>
      ))}
      <svg viewBox="0 0 52 52" className={styles.hbSvg}>
        <path className={styles.hbF} d={HEART_D} />
        <path className={styles.hbO} d={HEART_D} />
      </svg>
    </span>
  );
}

// Lucian UX/UI Prompt #028 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#028
// 댓글·답글 입력칸 — #028 "늘어나는 댓글 입력창". 글을 쓸수록 높이가 부드럽게 늘어나고(0.25s, 여섯 줄 넘으면 안에서 스크롤),
// 오른쪽 아래 고리가 쓴 만큼 차오름. 20자 남으면 고리가 커지며 주황 + 남은 글자 수.
// Enter = 등록, Shift+Enter = 줄바꿈(한글 조합 중 Enter는 무시).
const COMMENT_MAX = 500;
function CommentForm({
  placeholder,
  disabled,
  onSubmit,
  onCancel,
  autoFocus,
}: {
  placeholder: string;
  disabled?: boolean;
  onSubmit: (text: string) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const { isLoggedIn } = useAuth();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ta.current?.focus();
  }, [autoFocus]);
  const fit = () => {
    const el = ta.current;
    if (!el) return;
    const h = el.style.height;
    el.style.transition = "none";
    el.style.height = "24px";
    const need = Math.min(144, el.scrollHeight);
    el.style.height = h || "24px";
    void el.offsetHeight;
    el.style.transition = "";
    el.style.height = need + "px";
    el.style.overflowY = el.scrollHeight > 144 ? "auto" : "hidden";
  };
  const n = Array.from(text).length;
  const rest = COMMENT_MAX - n;
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!isLoggedIn) return startLogin();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr("");
    try {
      await onSubmit(t);
      setText("");
      requestAnimationFrame(fit);
    } catch (er) {
      setErr(boardErrText(er));
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  };
  return (
    <>
      <form
        className={`${styles.cbox} ${rest <= 20 ? styles.cNear : ""} ${rest <= 0 ? styles.cOver : ""}`}
        style={{ "--p": Math.min(1, n / COMMENT_MAX).toFixed(3) } as React.CSSProperties}
        onSubmit={submit}
      >
        <textarea
          ref={ta}
          className={styles.cta}
          rows={1}
          maxLength={COMMENT_MAX}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            fit();
          }}
          onKeyDown={onKey}
        />
        <div className={styles.cfoot}>
          <span className={styles.cring} aria-hidden="true">
            <svg viewBox="0 0 30 30">
              <circle className={styles.cbg} cx="15" cy="15" r="12" />
              <circle className={styles.cfg} cx="15" cy="15" r="12" />
            </svg>
            <span className={`${styles.cleft} num`}>{rest}</span>
          </span>
          <span className={styles.csep} aria-hidden="true" />
          {onCancel && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
              취소
            </button>
          )}
          <button type="submit" className={styles.csend} disabled={busy} aria-disabled={isLoggedIn && !text.trim()}>
            {isLoggedIn ? "등록" : "로그인"}
          </button>
        </div>
        {rest <= 20 && <span className="sr-only" aria-live="polite">{rest}자 남았어요</span>}
      </form>
      {err && <p className={styles.err}>{err}</p>}
    </>
  );
}

function ReportButton({ x, type, onReport }: { x: { mine: boolean; staff: boolean; reported: boolean; id: number }; type: "post" | "comment"; onReport: (t: ReportTarget) => void }) {
  const { isAdmin } = useAuth();
  if (x.mine || x.staff || isAdmin) return null;
  if (x.reported)
    return (
      <span className={`${styles.reportBtn} ${styles.done}`}>
        <Flag size={12} aria-hidden="true" /> 신고함
      </span>
    );
  return (
    <button type="button" className={styles.reportBtn} onClick={() => onReport({ type, id: x.id })}>
      <Flag size={12} aria-hidden="true" /> 신고
    </button>
  );
}

function CommentItem({
  c,
  isReply,
  replyOpen,
  onReply,
  onDelete,
  onReport,
  flash,
}: {
  c: BoardComment;
  isReply: boolean;
  replyOpen: boolean;
  onReply: () => void;
  onDelete: () => void;
  onReport: (t: ReportTarget) => void;
  flash: boolean;
}) {
  const { isAdmin } = useAuth();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!flash || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    if (r.top < 70 || r.bottom > window.innerHeight - 20) ref.current.scrollIntoView({ block: "center" });
  }, [flash]);
  if (c.deleted)
    return (
      <div className={`${styles.cm} ${isReply ? styles.reply : ""}`}>
        <span className={styles.avGone} />
        <div className={styles.cmMain}>
          <div className={styles.gone}>삭제된 댓글이에요</div>
        </div>
      </div>
    );
  const name = authorOf(c);
  const veiled = c.hidden && !c.body;
  return (
    <div ref={ref} className={`${styles.cm} ${isReply ? styles.reply : ""} ${flash ? styles.flash : ""}`}>
      {c.avatarImg ? (
        <Avatar name={c.avatar || name} image={c.avatarImg} size={isReply ? 28 : 32} />
      ) : (
        <span className={`${styles.anonAv} ${c.op ? styles.op : ""} ${isReply ? styles.small : ""} ${Array.from(c.avatar ?? "").length > 2 ? styles.long : ""}`} aria-hidden="true">
          {c.avatar ?? Array.from(name || "?")[0]}
        </span>
      )}
      <div className={styles.cmMain}>
        <div className={styles.meta}>
          <Who name={name} badge={c.badge} mine={c.mine} />
          <span className={styles.dot}>·</span>
          <span>{boardTime(c.createdAt)}</span>
          <AdminChip adminName={c.adminName} shown={c.author} />
          {c.hidden && isAdmin && <span className="tag tag-live">자동 숨김 중</span>}
          <span className={styles.metaRight}>
            <ReportButton x={c} type="comment" onReport={onReport} />
            {c.canDelete && (
              <button type="button" className={styles.textBtn} onClick={onDelete}>
                삭제
              </button>
            )}
          </span>
        </div>
        {veiled ? (
          <div className={styles.veil}>
            <EyeOff size={14} aria-hidden="true" /> 신고가 누적되어 가려진 댓글이에요
          </div>
        ) : (
          <div className={styles.cmText}>
            {c.replyTo && <span className={styles.at}>@{c.replyTo}</span>}
            {c.body}
          </div>
        )}
        {!veiled && (
          <div className={styles.cmAct}>
            {!(c.mine && !c.likeCount) && <LikeButton type="comment" id={c.id} liked={c.liked} count={c.likeCount} own={c.mine} />}
            <button type="button" className={`${styles.textBtn} ${replyOpen ? styles.on : ""}`} onClick={onReply}>
              답글 쓰기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function PostView({ board, id }: { board: BoardKind; id: number }) {
  const cfg = BOARD_CFG[board];
  const review = board === "review";
  const nav = useNavigate();
  const qc = useQueryClient();
  const { isLoggedIn, isAdmin, token } = useAuth();
  const key = ["board", "post", id, token];
  const q = useQuery({ queryKey: key, queryFn: () => boardCall<FullPost>({ action: "get", id }), retry: false });
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

  const fromList = !!(useLocation().state as { fromList?: boolean } | null)?.fromList;
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
        <Card>
          <EmptyState>{boardErrCode(q.error) === "not_found" ? "삭제됐거나 없는 글이에요." : "글을 불러오지 못했어요."}</EmptyState>
        </Card>
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
    const warn = review ? "이 후기를 삭제할까요?\n보상으로 받은 100P가 있다면 함께 회수돼요." : "이 글을 삭제할까요?\n활동 보상으로 받은 포인트가 있다면 함께 회수돼요.";
    if (!(await confirmDialog(warn))) return;
    setDeleting(true);
    try {
      const r = await boardCall<{ revoked?: number }>({ action: "delete", id: p.id });
      if (r.revoked) {
        toast(`삭제했어요. 보상 ${r.revoked}P가 회수됐어요.`, "info");
        qc.invalidateQueries({ queryKey: ["me"] });
      }
      qc.invalidateQueries({ queryKey: ["board", "list", board] });
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
