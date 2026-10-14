import { useEffect, useState } from "react";
import { Modal } from "../../components/ui";
import { REPORT_REASONS, boardCall, boardErrCode, boardErrText } from "../../lib/board";
import styles from "./Board.module.css";

export type ReportTarget = { type: "post" | "comment"; id: number };

export function ReportModal({ target, preview, onClose, onDone }: { target: ReportTarget | null; preview: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [memo, setMemo] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (target) {
      setReason("");
      setMemo("");
      setErr("");
      setBusy(false);
    }
  }, [target]);
  const what = target?.type === "post" ? "글" : "댓글";
  const submit = async () => {
    if (!target) return;
    if (!reason) return setErr("신고 사유를 골라주세요.");
    setBusy(true);
    try {
      const r = await boardCall<{ hidden?: boolean }>({ action: "report", targetType: target.type, targetId: target.id, reason, memo });
      onClose();
      alert(r.hidden ? `신고했어요. 신고가 누적되어 이 ${what}은 가려졌어요.` : "신고했어요. 운영자가 확인할게요.");
      onDone();
    } catch (e) {
      setBusy(false);
      setErr(boardErrText(e));
      if (boardErrCode(e) === "already_reported") onDone();
    }
  };
  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={`${what} 신고하기`}
      subtitle="신고한 사람은 다른 사람에게 보이지 않아요."
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={submit}>
            신고하기
          </button>
        </>
      }
    >
      {preview && <div className={styles.rpTarget}>{preview}</div>}
      <div className={styles.rpReasons} role="radiogroup" aria-label="신고 사유">
        {REPORT_REASONS.map(([v, label]) => (
          <label key={v} className={reason === v ? styles.on : ""}>
            <input
              type="radio"
              name="bd-rp-reason"
              value={v}
              checked={reason === v}
              onChange={() => {
                setReason(v);
                setErr("");
              }}
            />
            {label}
          </label>
        ))}
      </div>
      <textarea className="input" rows={2} maxLength={200} placeholder="자세한 내용 (선택, 최대 200자)" value={memo} onChange={(e) => setMemo(e.target.value)} />
      <p className={styles.note}>서로 다른 5명이 신고한 {what}은 운영자가 확인하기 전까지 자동으로 가려져요. 장난 신고는 이용 제한될 수 있어요.</p>
      {err && <p className={styles.err}>{err}</p>}
    </Modal>
  );
}
