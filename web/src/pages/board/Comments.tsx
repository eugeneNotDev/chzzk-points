// 게시글 보기 — 댓글 쓰기·답글·댓글 한 줄.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { EyeOff } from "lucide-react";
import { Avatar } from "../../components/Avatar";
import { startLogin, useAuth } from "../../lib/auth";
import { boardErrText, boardTime, type BoardComment } from "../../lib/board";
import { AdminChip, Who } from "./BoardList";
import { type ReportTarget } from "./ReportModal";
import styles from "./Board.module.css";
import { LikeButton, ReportButton, authorOf } from "./PostParts";

// Lucian UX/UI Prompt #028 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#028
// 댓글·답글 입력칸 — #028 "늘어나는 댓글 입력창". 글을 쓸수록 높이가 부드럽게 늘어나고(0.25s, 여섯 줄 넘으면 안에서 스크롤),
// 오른쪽 아래 고리가 쓴 만큼 차오름. 20자 남으면 고리가 커지며 주황 + 남은 글자 수.
// Enter = 등록, Shift+Enter = 줄바꿈(한글 조합 중 Enter는 무시).
const COMMENT_MAX = 500;
export function CommentForm({
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

export function CommentItem({
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
