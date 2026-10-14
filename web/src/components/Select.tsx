// 사이트 디자인 드롭다운 — 브라우저 기본 <select>는 펼친 목록이 OS 모양(다크 모드에서 흰 칸)이라 따로 만듦.
// 키보드: ↑↓로 이동, Enter/Space 선택, Esc 닫기. 바깥 누르면 닫힘.
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import styles from "./Select.module.css";

export type SelectOption<T extends string> = { value: T; label: string };

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  up = false,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  /** 목록을 위로 펼침(화면 아래쪽에 있을 때) */
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, options, value]);

  const pick = (i: number) => {
    onChange(options[i].value);
    setOpen(false);
    btn.current?.focus();
  };

  return (
    <div ref={wrap} className={`${styles.wrap} ${className ?? ""}`}>
      <button
        ref={btn}
        type="button"
        className={`${styles.btn} ${open ? styles.open : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
            return;
          }
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(options.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            pick(active);
          } else if (e.key === "Escape" || e.key === "Tab") {
            setOpen(false);
          }
        }}
      >
        <span>{current.label}</span>
        <ChevronDown size={16} aria-hidden="true" className={styles.chev} />
      </button>
      {open && (
        <ul id={id} role="listbox" aria-label={label} className={`${styles.menu} ${up ? styles.up : ""}`}>
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`${styles.opt} ${i === active ? styles.active : ""} ${o.value === value ? styles.selected : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
            >
              <span>{o.label}</span>
              {o.value === value && <Check size={15} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
