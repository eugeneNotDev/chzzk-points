// lib/dialog.ts의 알림창·확인창·토스트를 실제로 그림. 앱 맨 바깥(main.tsx)에 한 번만 둠.
// <dialog>.showModal()을 써서 다른 팝업(공지 보기 등) 위에도 항상 맨 위로 뜸.
import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { closeDialog, useDialogState, type DialogReq } from "../lib/dialog";
import styles from "./DialogHost.module.css";

function DialogBox({ d }: { d: DialogReq }) {
  const ref = useRef<HTMLDialogElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
    // 확인창은 실수로 Enter 눌러 삭제되지 않게 "취소"에, 알림창은 "확인"에 포커스
    requestAnimationFrame(() => (d.kind === "confirm" && d.danger ? el.querySelector<HTMLButtonElement>("[data-cancel]") : okRef.current)?.focus());
    const onCancel = (e: Event) => {
      e.preventDefault();
      closeDialog(d.id, false);
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, [d]);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={d.title ? `dlg-t-${d.id}` : undefined}
      aria-describedby={`dlg-m-${d.id}`}
      onClick={(e) => {
        if (e.target === ref.current) closeDialog(d.id, false);
      }}
    >
      <div className={styles.body}>
        {d.title && (
          <h3 id={`dlg-t-${d.id}`} className={styles.title}>
            {d.title}
          </h3>
        )}
        <p id={`dlg-m-${d.id}`} className={styles.message}>
          {d.message}
        </p>
        {d.kind === "copy" && (
          <input className={`input ${styles.copy}`} readOnly value={d.copyText} onFocus={(e) => e.currentTarget.select()} />
        )}
      </div>
      <div className={styles.actions}>
        {d.kind === "confirm" && (
          <button type="button" data-cancel className="btn btn-ghost" onClick={() => closeDialog(d.id, false)}>
            {d.cancelText || "취소"}
          </button>
        )}
        <button ref={okRef} type="button" className={`btn ${d.danger ? "btn-danger" : "btn-primary"}`} onClick={() => closeDialog(d.id, true)}>
          {d.okText || "확인"}
        </button>
      </div>
    </dialog>
  );
}

export function DialogHost() {
  const { dialogs, toasts } = useDialogState();
  return (
    <>
      {dialogs.map((d) => (
        <DialogBox key={d.id} d={d} />
      ))}
      <div className={styles.toasts} aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className={`${styles.toast} ${styles[t.tone]}`}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
            >
              {t.tone === "ok" ? <CircleCheck size={18} aria-hidden="true" /> : t.tone === "error" ? <CircleAlert size={18} aria-hidden="true" /> : <Info size={18} aria-hidden="true" />}
              <span>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}
