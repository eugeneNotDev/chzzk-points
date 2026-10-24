// 게시글 보기 — 본문(사진 포함), 좋아요 버튼(하트 효과), 신고 버튼.
import { useEffect, useState } from "react";
import { Flag } from "lucide-react";
import { startLogin, useAuth } from "../../lib/auth";
import { IMG_MARK_RE, boardCall, boardErrCode, boardErrText, type FullPost } from "../../lib/board";
import { Lightbox } from "../../components/Lightbox";
import { type ReportTarget } from "./ReportModal";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import styles from "./Board.module.css";
import { alertDialog } from "../../lib/dialog";

export const authorOf = (x: { adminName: string | null; author: string | null }) => x.adminName || x.author || "";

// 본문 + 사진: [[사진:n]] 자리에 그 사진, 표시가 없는 사진(예전 글 포함)은 맨 아래 묶음.
export function PostBody({ body, images }: { body: string; images: FullPost["images"] }) {
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
export function LikeButton({ type, id, liked, count, own, big }: { type: "post" | "comment"; id: number; liked: boolean; count: number; own: boolean; big?: boolean }) {
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

export function ReportButton({ x, type, onReport }: { x: { mine: boolean; staff: boolean; reported: boolean; id: number }; type: "post" | "comment"; onReport: (t: ReportTarget) => void }) {
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
