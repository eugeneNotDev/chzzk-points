// 포인트 기록 한 줄 — 포인트 로그 탭과 유저 상세 팝업이 같이 씀.
// 관리자가 직접 지급/차감한 줄(adminAction)만 "실행취소" 가능(반대 방향으로 다시 조정). 이미 취소한 줄은 "취소됨".
import { useState } from "react";
import { adminCall, fmtDateTime, num, type LogEntry } from "../../lib/admin";
import styles from "./Admin.module.css";

export function LogRow({ e, onUndone, showName = true }: { e: LogEntry; onUndone?: () => void; showName?: boolean }) {
  const [busy, setBusy] = useState(false);
  const positive = e.amount > 0;
  const undo = async () => {
    if (!confirm("이 지급/차감 내역을 취소할까요? 반대 방향으로 포인트가 다시 조정돼요.")) return;
    setBusy(true);
    try {
      await adminCall({ action: "undo-adjustment", id: e.id });
      onUndone?.();
    } catch {
      alert("실행취소에 실패했어요.");
      setBusy(false);
    }
  };
  return (
    <div className={styles.logRow}>
      <div className={styles.logWho}>
        {showName && <strong>{e.channelName || "(알 수 없음)"}</strong>}
        <span>{e.reason || ""}</span>
      </div>
      <span className={`${styles.amt} ${positive ? styles.plus : styles.minus} num`}>
        {positive ? "+" : ""}
        {num(e.amount)}P
      </span>
      <span className={styles.time}>{fmtDateTime(e.createdAt)}</span>
      <span className={styles.logSide}>
        {e.adminAction &&
          (e.undone ? (
            <span className={styles.muted}>취소됨</span>
          ) : (
            <button type="button" className={styles.linkBtn} disabled={busy} onClick={undo}>
              실행취소
            </button>
          ))}
      </span>
    </div>
  );
}
