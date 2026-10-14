// 사진 크게 보기 — 화면 가득 어둡게 깔고 사진을 크게. 여러 장이면 좌우 버튼·방향키·밀어서 넘기기.
// 바깥(어두운 곳)을 누르거나 Esc로 닫힘. 원본은 "원본 열기"로 새 탭.
import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import styles from "./Lightbox.module.css";

export function Lightbox({ images, index, onIndex, onClose }: { images: string[]; index: number | null; onIndex: (i: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const touchX = useRef<number | null>(null);
  const open = index !== null;
  const n = images.length;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && index! > 0) onIndex(index! - 1);
      if (e.key === "ArrowRight" && index! < n - 1) onIndex(index! + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, n, onIndex]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener("cancel", onCancel);
    return () => d.removeEventListener("cancel", onCancel);
  }, [onClose]);

  const src = open ? images[index!] : "";
  return (
    <dialog
      ref={ref}
      className={styles.lb}
      aria-label="사진 크게 보기"
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.backdrop) onClose();
      }}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null || index === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (dx > 50 && index > 0) onIndex(index - 1);
        if (dx < -50 && index < n - 1) onIndex(index + 1);
      }}
    >
      {open && (
        <div className={styles.stage} data-backdrop="1">
          <img key={src} src={src} alt="" className={styles.img} />
          <div className={styles.top}>
            {n > 1 && (
              <span className={`${styles.count} num`}>
                {index! + 1} / {n}
              </span>
            )}
            <a className={styles.btn} href={src} target="_blank" rel="noopener noreferrer" aria-label="원본 열기">
              <ExternalLink size={20} aria-hidden="true" />
            </a>
            <button type="button" className={styles.btn} onClick={onClose} aria-label="닫기">
              <X size={22} aria-hidden="true" />
            </button>
          </div>
          {index! > 0 && (
            <button type="button" className={`${styles.nav} ${styles.prev}`} onClick={() => onIndex(index! - 1)} aria-label="이전 사진">
              <ChevronLeft size={28} aria-hidden="true" />
            </button>
          )}
          {index! < n - 1 && (
            <button type="button" className={`${styles.nav} ${styles.next}`} onClick={() => onIndex(index! + 1)} aria-label="다음 사진">
              <ChevronRight size={28} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </dialog>
  );
}
