// Lucian UX/UI Prompt #074 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#074
// 상단바 알림 종 — #074 "알림 벨과 드롭다운"의 움직임을 가져옴.
//  · 새 알림이 오면 종이 흔들리고(0.9s) 빨간 숫자가 튀어 오름. 숫자가 0이 되면 작아지며 사라짐.
//  · 종을 누르면 목록 창이 종 자리에서 펼쳐지고(0.45s 스프링), 닫으면 다시 종 쪽으로 접힘.
//  · 열려 있는 동안 새 알림이 오면 맨 위로 밀고 들어옴. "모두 읽음"은 위에서부터 점을 하나씩 지움.
// 창을 열면 "읽음" 처리(그 시각 이후 것만 새 알림) — 열 때의 기준을 고정해 둬서 이번에 새로 온 건 점이 남음.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChartColumn, CornerDownRight, Crown, Megaphone, MessageCircle } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { relTime } from "../../lib/format";
import { markNotificationsSeen, useNotifications, type Notif } from "../../lib/notifications";
import styles from "./NotificationBell.module.css";

const ICON: Record<Notif["kind"], typeof Bell> = { notice: Megaphone, comment: MessageCircle, reply: CornerDownRight, predict: ChartColumn, title: Crown };
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function NotificationBell() {
  const { isLoggedIn } = useAuth();
  const { items, unread, seen, loading } = useNotifications();
  const [open, setOpen] = useState(false);
  const [seenWhenOpened, setSeenWhenOpened] = useState(seen);
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [ring, setRing] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const badge = useRef<HTMLSpanElement>(null);
  const nav = useNavigate();

  // 안 읽은 수가 늘면(처음 불러올 때 제외) 종 흔들기 + 숫자 튀기
  const prevUnread = useRef<number | null>(null);
  useEffect(() => {
    if (loading) return;
    const p = prevUnread.current;
    prevUnread.current = unread;
    if (p == null || unread <= p || reduced()) return;
    setRing(false);
    requestAnimationFrame(() => setRing(true));
    badge.current?.animate([{ transform: "scale(1)" }, { transform: "scale(1.5)" }, { transform: "scale(1)" }], { duration: 450, easing: "cubic-bezier(.34,1.5,.64,1)" });
  }, [unread, loading]);

  // 열려 있는 동안 새로 들어온 줄은 위에서 밀고 들어오게
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useLayoutEffect(() => {
    const ids = new Set(items.map((n) => n.id));
    if (known.current && open) {
      const add = [...ids].filter((id) => !known.current!.has(id));
      if (add.length) {
        setFresh(new Set(add));
        requestAnimationFrame(() => requestAnimationFrame(() => setFresh(new Set())));
      }
    }
    known.current = ids;
  }, [items, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      setSeenWhenOpened(seen);
      setCleared(new Set());
      markNotificationsSeen();
    }
    setOpen(!open);
  };

  const isNew = (n: Notif) => new Date(n.at).getTime() > seenWhenOpened && !cleared.has(n.id);
  const newOnes = items.filter(isNew);
  // "모두 읽음" — 위에서부터 110ms 간격으로 점을 하나씩 지움
  const clearAll = () => {
    newOnes.forEach((n, i) =>
      setTimeout(() => setCleared((c) => new Set(c).add(n.id)), reduced() ? 0 : i * 110),
    );
  };

  return (
    <div className={styles.wrap} ref={wrap}>
      <button
        type="button"
        className={`${styles.bell} ${ring ? styles.ring : ""}`}
        onClick={toggle}
        onAnimationEnd={() => setRing(false)}
        aria-label={unread ? `알림, 안 읽음 ${unread}개` : "알림"}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell size={20} aria-hidden="true" />
        <span ref={badge} className={`${styles.badge} num ${unread > 0 ? "" : styles.zero}`} aria-hidden="true">
          {unread > 9 ? "9+" : unread || ""}
        </span>
      </button>
      <div className={`${styles.panel} ${open ? "" : styles.closed}`} role="dialog" aria-label="알림" inert={!open}>
        <div className={styles.head}>
          알림
          <button type="button" className={styles.all} disabled={newOnes.length === 0} onClick={clearAll}>
            모두 읽음
          </button>
        </div>
        <ul className={styles.list}>
          {loading && items.length === 0 && <li className={styles.empty}>불러오는 중...</li>}
          {!loading && items.length === 0 && (
            <li className={styles.empty}>{isLoggedIn ? "최근 알림이 없어요." : "로그인하면 내 글 댓글·투표 결과 알림도 받을 수 있어요."}</li>
          )}
          {items.map((n) => {
            const Icon = ICON[n.kind];
            const on = isNew(n);
            return (
              <li key={n.id} className={`${styles.it} ${fresh.has(n.id) ? styles.fresh : ""}`}>
                <div>
                  <button
                    type="button"
                    className={`${styles.item} ${on ? styles.new : styles.read}`}
                    onClick={() => {
                      setOpen(false);
                      nav(n.to);
                    }}
                  >
                    <span className={`${styles.icon} ${styles[n.kind === "title" ? "titleKind" : n.kind]}`}>
                      <Icon size={16} aria-hidden="true" />
                    </span>
                    <span className={styles.text}>
                      <span className={styles.title}>{n.title}</span>
                      <span className={styles.body}>{n.body}</span>
                      <span className={styles.time}>{relTime(n.at)}</span>
                    </span>
                    <span className={styles.dot} aria-label={on ? "새 알림" : undefined} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
