// Lucian UX/UI Prompt #039 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#039
// 미끄러지는 알약 탭 — 탭을 누르면 알약이 늘어나며 미끄러져 옮겨 감(0.5s 스프링). 좌우 방향키로도 옮김.
// 아래 목록을 감싸는 <PillPanel>은 이동한 방향에서 줄마다 45ms씩 늦게 밀려 들어옴.
import { Children, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type PillOption<T extends string> = { value: T; label: ReactNode };

export function PillTabs<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
  className = "",
}: {
  value: T;
  options: PillOption<T>[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));

  // 알약을 고른 탭 자리·폭으로 — 처음 그릴 땐 애니메이션 없이 바로
  useLayoutEffect(() => {
    const move = () => {
      const t = wrap.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[idx];
      const p = pill.current;
      if (!t || !p) return;
      if (first.current) p.style.transition = "none";
      p.style.setProperty("--x", `${t.offsetLeft}px`);
      p.style.setProperty("--w", `${t.offsetWidth}px`);
      if (first.current) {
        void p.offsetWidth;
        p.style.transition = "";
        first.current = false;
      }
    };
    move();
    const ro = new ResizeObserver(() => {
      first.current = true;
      move();
    });
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [idx, options.length]);

  return (
    <div ref={wrap} className={`pill-tabs pill-${size} ${className}`} role="tablist" aria-label={label}>
      <span ref={pill} className="pill-tabs-pill" aria-hidden="true" />
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          className="pill-tabs-tab"
          aria-selected={i === idx}
          tabIndex={i === idx ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const n = (i + d + options.length) % options.length;
            onChange(options[n].value);
            wrap.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[n]?.focus();
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// 탭이 바뀌면 새 목록이 이동한 방향(오른쪽 탭이면 오른쪽)에서 줄마다 차례로 들어옴
export function PillPanel({ index, children, className = "" }: { index: number; children: ReactNode; className?: string }) {
  const prev = useRef(index);
  const [dir, setDir] = useState(0);
  useLayoutEffect(() => {
    if (prev.current !== index) setDir(index > prev.current ? 1 : -1);
    prev.current = index;
  }, [index]);
  return (
    <div key={index} className={`pill-panel ${dir ? "pill-panel-in" : ""} ${className}`} style={{ "--dir": dir } as React.CSSProperties}>
      {Children.map(children, (c, k) => (
        <div className="pill-panel-row" style={{ animationDelay: `${k * 45}ms` }}>
          {c}
        </div>
      ))}
    </div>
  );
}
