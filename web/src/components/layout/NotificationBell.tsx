// 상단바 알림 종 — 누르면 알림 목록(PC: 종 아래 작은 창 / 모바일: 화면 위쪽 넓은 창).
// 새 알림 개수는 빨간 숫자. 창을 열면 "읽음" 처리(그 시각 이후 것만 새 알림).
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChartColumn, CornerDownRight, Megaphone, MessageCircle } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { relTime } from "../../lib/format";
import { markNotificationsSeen, useNotifications, type Notif } from "../../lib/notifications";
import styles from "./NotificationBell.module.css";

const ICON: Record<Notif["kind"], typeof Bell> = { notice: Megaphone, comment: MessageCircle, reply: CornerDownRight, predict: ChartColumn };

export function NotificationBell() {
  const { isLoggedIn } = useAuth();
  const { items, unread, seen, loading } = useNotifications();
  const [open, setOpen] = useState(false);
  // 열었을 때의 "읽음 기준"을 고정해 둠 — 열자마자 읽음 처리돼도 이번에 새로 온 건 표시가 남게
  const [seenWhenOpened, setSeenWhenOpened] = useState(seen);
  const wrap = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

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
      markNotificationsSeen();
    }
    setOpen(!open);
  };

  return (
    <div className={styles.wrap} ref={wrap}>
      <button type="button" className={styles.bell} onClick={toggle} aria-label={unread ? `알림 ${unread}개 새로 옴` : "알림"} aria-expanded={open} aria-haspopup="dialog">
        <Bell size={20} aria-hidden="true" />
        {unread > 0 && <span className={`${styles.badge} num`}>{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className={styles.panel} role="dialog" aria-label="알림">
          <div className={styles.head}>알림</div>
          <div className={styles.list}>
            {loading && items.length === 0 && <p className={styles.empty}>불러오는 중...</p>}
            {!loading && items.length === 0 && (
              <p className={styles.empty}>{isLoggedIn ? "최근 알림이 없어요." : "로그인하면 내 글 댓글·투표 결과 알림도 받을 수 있어요."}</p>
            )}
            {items.map((n) => {
              const Icon = ICON[n.kind];
              const isNew = new Date(n.at).getTime() > seenWhenOpened;
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`${styles.item} ${isNew ? styles.new : ""}`}
                  onClick={() => {
                    setOpen(false);
                    nav(n.to);
                  }}
                >
                  <span className={`${styles.icon} ${styles[n.kind]}`}>
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className={styles.text}>
                    <span className={styles.title}>{n.title}</span>
                    <span className={styles.body}>{n.body}</span>
                    <span className={styles.time}>{relTime(n.at)}</span>
                  </span>
                  {isNew && <span className={styles.dot} aria-label="새 알림" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
