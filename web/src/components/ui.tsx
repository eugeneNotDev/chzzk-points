// 공통 화면 부품 — 팝업, 페이지 머리말, 로그인 안내.
import { useEffect, useRef, type ReactNode } from "react";
import { LogIn } from "lucide-react";
import { startLogin } from "../lib/auth";

// 팝업 — 브라우저 기본 <dialog>를 씀(Esc 닫기, 포커스 가두기, 뒤 배경 클릭 막기가 자동).
// 바깥 어두운 부분을 누르면 닫힘. 본문만 스크롤되고 제목·버튼은 고정.
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  actions,
  wide = false,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // 첫 버튼에 포커스가 가면서 긴 글이 맨 아래부터 보이는 걸 막음 — 본문 맨 위에서 시작.
      requestAnimationFrame(() => {
        if (bodyRef.current) {
          bodyRef.current.scrollTop = 0;
          bodyRef.current.focus({ preventScroll: true });
        }
      });
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    d.addEventListener("cancel", onCancel);
    return () => d.removeEventListener("cancel", onCancel);
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      aria-labelledby={labelledBy}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          {(title || subtitle) && (
            <div className="modal-head">
              {title && <h3 id={labelledBy}>{title}</h3>}
              {subtitle && <p>{subtitle}</p>}
            </div>
          )}
          <div className="modal-body" ref={bodyRef} tabIndex={-1}>
            {children}
          </div>
          {actions && <div className="modal-actions">{actions}</div>}
        </>
      )}
    </dialog>
  );
}

// 페이지 머리 — 제목·설명 + 오른쪽(폰에선 아래)에 핵심 숫자(stats)와 버튼(actions)
export function PageHead({ title, desc, actions, stats }: { title: string; desc?: ReactNode; actions?: ReactNode; stats?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        <h2 className="page-title">{title}</h2>
        {desc && <p className="page-desc">{desc}</p>}
      </div>
      {stats && <div className="page-stats">{stats}</div>}
      {actions}
    </div>
  );
}

// 핵심 숫자 한 칸 — 작은 이름 위, 큰 숫자 + 작은 단위. 사이트 모든 "보유 포인트" 같은 표시가 이 모양.
export function Stat({ label, value, unit, tone }: { label: ReactNode; value: ReactNode; unit?: string; tone?: "accent" | "gold" }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value num">
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

export function LoginNeeded({ children = "로그인하면 이용할 수 있어요." }: { children?: ReactNode }) {
  return (
    <div className="login-needed">
      <p>{children}</p>
      <button type="button" className="btn btn-primary" onClick={startLogin}>
        <LogIn size={18} aria-hidden="true" />
        치지직으로 로그인
      </button>
    </div>
  );
}
