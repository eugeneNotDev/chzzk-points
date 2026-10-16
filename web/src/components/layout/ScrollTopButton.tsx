// Lucian UX/UI Prompt #343 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#343
// 맨 위로 버튼 — #343 "로켓으로 돌아가는 맨 위 버튼".
// 화면을 어느 정도(600px) 내리면 오른쪽 아래에 떠오르고, 테두리 링이 읽은 만큼 차오름.
// 누르면 화살표가 로켓으로 바뀌어 날아오르며 화면이 맨 위로 부드럽게 올라감.
import { useEffect, useRef } from "react";
import "./ScrollTopButton.css";

export function ScrollTopButton() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current!;
    const up = root.querySelector<HTMLButtonElement>(".u343-up")!;
    const ring = root.querySelector<SVGCircleElement>(".u343-ring")!;
    const rk = root.querySelector<SVGGElement>(".u343-rk")!;
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const C = 2 * Math.PI * 24;
    let raf = 0;
    let flying = false;
    let alive = true;
    ring.style.strokeDasharray = String(C);
    const draw = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      ring.style.strokeDashoffset = (C * (1 - p)).toFixed(1);
      if (!flying) root.classList.toggle("show", window.scrollY > 600);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const onClick = () => {
      if (flying) return;
      flying = true;
      root.classList.add("fly");
      const from = window.scrollY;
      const t0 = performance.now();
      const D = rm ? 1 : 900;
      if (!rm && rk.animate)
        rk.animate([{ transform: "none" }, { transform: "translateY(4px)", offset: 0.15 }, { transform: "translateY(-260px)" }], { duration: 900, easing: "cubic-bezier(.6,0,.8,.4)" });
      const f = (now: number) => {
        if (!alive) return;
        const k = Math.min(1, Math.max(0, (now - t0) / D));
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        window.scrollTo(0, from * (1 - e));
        if (k < 1) {
          requestAnimationFrame(f);
          return;
        }
        setTimeout(() => {
          flying = false;
          root.classList.remove("fly");
          draw();
        }, 200);
      };
      requestAnimationFrame(f);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    up.addEventListener("click", onClick);
    draw();
    return () => {
      alive = false;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div ref={ref} className="ux u343">
      <button className="u343-up" type="button" aria-label="맨 위로">
        <svg viewBox="0 0 52 52" aria-hidden="true">
          <circle className="u343-ring" cx="26" cy="26" r="24" />
          <path className="u343-ar" d="M26 34V18M19 25l7-7 7 7" />
          <g className="u343-rk">
            <path className="f" d="M23 33h6l-3 7z" />
            <path className="b" d="M26 13c4 3 5 9 4 16h-8c-1-7 0-13 4-16z" />
            <circle className="w" cx="26" cy="22" r="2.2" />
            <path className="b" d="M22 26l-3 6h4zM30 26l3 6h-4z" />
          </g>
        </svg>
      </button>
    </div>
  );
}
