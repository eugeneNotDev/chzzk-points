// Lucian UX/UI Prompt #090 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#090
// 불러오기 실패 칸 — #090 "플러그가 다시 꽂히는 오류 위젯".
// 빠진 플러그가 기다리고, 버튼 테두리 링이 줄어들며 자동 재시도까지 남은 시간을 보여줌(5초 → 실패하면 8초 → 15초).
// 재시도하면 플러그가 다가가 흔들리고, 실패하면 불꽃과 함께 튕겨 남. 성공하면 바로 원래 내용이 뜸.
// 세 번 다 실패하면 자동 재시도는 멈추고 버튼으로만 다시 시도.
import { useEffect, useRef, useState } from "react";
import { josa } from "../lib/format";
import "./LoadError.css";

const WAITS = [5, 8, 15];

export function LoadError({ what, onRetry }: { what: string; onRetry: () => Promise<{ isError: boolean }> }) {
  const root = useRef<HTMLDivElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const [st, setSt] = useState<"wait" | "try" | "stop">("wait");
  const [tries, setTries] = useState(0); // 실패한 재시도 수
  const [left, setLeft] = useState(WAITS[0]);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // 대기 중: 링이 남은 시간만큼 줄어들고 0초가 되면 스스로 다시 시도
  useEffect(() => {
    if (st !== "wait") return;
    const sec = WAITS[tries] ?? WAITS[WAITS.length - 1];
    const r = ring.current;
    if (r) {
      r.style.transition = "none";
      r.style.strokeDashoffset = "0";
      r.getBoundingClientRect();
      r.style.transition = `stroke-dashoffset ${sec}s linear`;
      r.style.strokeDashoffset = "100";
    }
    setLeft(sec);
    let n = sec;
    const t = setInterval(() => {
      n -= 1;
      setLeft(n);
      if (n <= 0) {
        clearInterval(t);
        void attempt();
      }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, tries]);

  async function attempt() {
    if (st === "try") return;
    setSt("try");
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const [res] = await Promise.all([onRetry().catch(() => ({ isError: true })), new Promise((r) => setTimeout(r, rm ? 400 : 1500))]);
    if (!alive.current || !res.isError) return; // 성공하면 부모가 이 칸을 내용으로 바꿈
    const el = root.current;
    if (el) {
      el.classList.remove("zap");
      void el.offsetWidth;
      el.classList.add("zap");
      if (!rm)
        el.querySelector(".u090-err")?.animate(
          [{ transform: "translateX(0)" }, { transform: "translateX(-7px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-3px)" }, { transform: "none" }],
          { duration: 420, easing: "ease-out" },
        );
    }
    const next = tries + 1;
    setTries(next);
    setSt(next >= WAITS.length ? "stop" : "wait");
  }

  return (
    <div ref={root} className="ux u090" data-s={st === "stop" ? "wait" : st}>
      <div className="u090-err">
        <svg className="u090-plug" viewBox="0 0 220 70" aria-hidden="true">
          <g className="u090-L">
            <path className="u090-cord" d="M-14 54C24 54 40 35 72 35" />
            <path className="u090-pr" d="M100 28h14M100 42h14" />
            <rect className="u090-bd" x="68" y="19" width="34" height="32" rx="8" />
          </g>
          <g className="u090-spark">
            <path d="M121 20l-2-7M129 24l5-5M113 24l-5-5M121 50l-2 7M129 46l5 5M113 46l-5 5" />
          </g>
          <g className="u090-R">
            <rect className="u090-bd" x="124" y="17" width="38" height="36" rx="9" />
            <path className="u090-hole" d="M124 28h6M124 42h6" />
            <circle className="u090-led" cx="153" cy="25" r="3" />
            <path className="u090-cord" d="M162 35C188 35 194 16 236 16" />
          </g>
        </svg>
        <p className="u090-t">
          {what}
          {josa(what, "을", "를")} 불러오지 못했어요
        </p>
        <p className="u090-s">서버가 잠시 응답하지 않아요</p>
        <div className="u090-at">
          <span className="u090-dots" aria-hidden="true">
            {WAITS.map((_, i) => (
              <i key={i} className={i === 0 ? "f" : st === "try" && i === tries + 1 ? "cur" : i <= tries ? "f" : ""} />
            ))}
          </span>
          <span aria-live="polite">{st === "try" ? `${tries + 2}번째 시도 중…` : st === "stop" ? "잠시 뒤에 다시 시도해 주세요" : `${left}초 뒤 자동으로 다시 시도`}</span>
        </div>
      </div>
      <button className="u090-go" type="button" aria-disabled={st === "try"} onClick={() => st !== "try" && void attempt()}>
        <svg className="u090-ring" viewBox="0 0 20 20" aria-hidden="true" style={st === "stop" ? { width: 0, marginRight: -9 } : undefined}>
          <circle cx="10" cy="10" r="8" />
          <circle ref={ring} cx="10" cy="10" r="8" pathLength={100} />
        </svg>
        <span>{st === "try" ? "연결하는 중" : "지금 다시 시도"}</span>
      </button>
    </div>
  );
}
