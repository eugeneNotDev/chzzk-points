// Lucian UX/UI Prompt #089 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#089
// 없는 주소 — #089 "오타를 고쳐 주는 404".
// 가운데 0은 나침반이라 바늘이 커서를 따라 탄력 있게 돌고, 양옆 4도 커서 쪽으로 기움.
// 아래에 지금 주소와 가장 비슷한 메뉴 3개(일치도 막대). 고르면 주소 오타가 한 자씩 지워지고 다시 입력된 뒤
// 숫자가 굴러 200이 되고 바늘이 한 바퀴 돌아 북쪽에 멈춘 다음, 그 페이지로 이동.
import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ALL_NAV_ITEMS } from "../nav";
import { useAuth } from "../lib/auth";
import "./NotFound.css";

// 두 글자열이 얼마나 비슷한지(0~1) — 편집 거리 기준
function similarity(a: string, b: string) {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}

const ARROW = '<path d="M3 8h10M9 4l4 4-4 4"/>';
const CHECK = '<path d="M3.2 8.4l3 3L12.8 4.8"/>';

export default function NotFound() {
  const loc = useLocation();
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const root = useRef<HTMLDivElement>(null);
  const bad = loc.pathname || "/";
  const sug = useMemo(() => {
    const q = bad.replace(/^\//, "").replace(/\.html$/, "").toLowerCase();
    return ALL_NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin)
      .map((i) => {
        const p = i.path.replace(/\.html$/, "") || "home";
        return { to: `/${i.path}`, shown: `/${i.path}`, label: i.label, m: Math.max(0.08, similarity(q, p)) };
      })
      .sort((a, b) => b.m - a.m)
      .slice(0, 3);
  }, [bad, isAdmin]);

  useEffect(() => {
    const el = root.current!;
    const num = el.querySelector<HTMLElement>(".u089-num")!;
    const cols = el.querySelectorAll<HTMLElement>(".u089-col");
    const cp = el.querySelector<HTMLElement>(".u089-cp")!;
    const nd = el.querySelector<SVGGElement>(".u089-nd")!;
    const path = el.querySelector<HTMLElement>(".u089-url b")!;
    const title = el.querySelector<HTMLElement>(".u089-t")!;
    const sub = el.querySelector<HTMLElement>(".u089-s")!;
    const rows = Array.from(el.querySelectorAll<HTMLButtonElement>(".u089-row"));
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // 바늘은 스프링으로 움직여서 방향이 크게 바뀌면 살짝 지나쳤다가 돌아옴
    let a = 0;
    let v = 0;
    let tgt = 0;
    let raf = 0;
    let last = 0;
    let busy = false;
    let ts: number[] = [];
    const step = (now: number) => {
      raf = 0;
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      if (rm) {
        a = tgt;
        v = 0;
      } else {
        v += (220 * (tgt - a) - 17 * v) * dt;
        a += v * dt;
      }
      nd.style.transform = `rotate(${a.toFixed(2)}deg)`;
      if (Math.abs(v) > 0.05 || Math.abs(tgt - a) > 0.05) raf = requestAnimationFrame(step);
    };
    const kick = () => {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(step);
      }
    };
    const aim = (deg: number) => {
      tgt = a + ((((deg - a) % 360) + 540) % 360) - 180;
      kick();
    };
    const toward = (x: number, y: number) => {
      const r = cp.getBoundingClientRect();
      const dx = x - (r.left + r.width / 2);
      const dy = y - (r.top + r.height / 2);
      aim((Math.atan2(dx, -dy) * 180) / Math.PI);
      num.style.setProperty("--r", Math.max(-1, Math.min(1, dx / (el.getBoundingClientRect().width / 2))).toFixed(3));
    };
    const aimAt = (b: Element) => {
      if (busy || el.classList.contains("found")) return;
      el.classList.add("trk");
      const r = b.getBoundingClientRect();
      toward(r.left + r.width / 2, r.top + r.height / 2);
    };
    const later = (fn: () => void, ms: number) => ts.push(window.setTimeout(fn, ms));
    const swapText = (t: string, s: string) => {
      el.classList.add("swap");
      later(() => {
        title.textContent = t;
        sub.textContent = s;
        el.classList.remove("swap");
      }, rm ? 0 : 250);
    };
    const digits = (x: number, y: number, label: string) => {
      cols[0].style.setProperty("--v", String(x));
      cols[1].style.setProperty("--v", String(y));
      num.setAttribute("aria-label", label);
    };
    // 오타 글자를 한 자씩 지운 뒤 맞는 주소를 다시 입력하고, 숫자가 굴러 200이 된 다음 이동
    const go = (i: number) => {
      if (busy || el.classList.contains("found")) return;
      busy = true;
      rows.forEach((b, k) => (b.disabled = k !== i));
      rows[i].classList.add("on");
      el.classList.add("fixing");
      const from = path.textContent || "";
      const to = rows[i].dataset.shown || "/";
      let k = from.length;
      const del = () => {
        if (k > 1) {
          path.textContent = from.slice(0, --k);
          return later(del, rm ? 0 : 34);
        }
        let j = 1;
        const type = () => {
          path.textContent = to.slice(0, ++j);
          if (j < to.length) return later(type, rm ? 0 : 55);
          el.classList.remove("fixing", "trk");
          el.classList.add("found");
          num.style.setProperty("--r", "0");
          digits(2, 0, "200 정상");
          tgt = a - (((a % 360) + 360) % 360) + 720;
          kick();
          rows[i].querySelector("svg")!.innerHTML = CHECK;
          swapText("찾았어요", `‘${rows[i].dataset.label}’ 페이지로 갈게요`);
          later(() => nav(rows[i].dataset.to || "/", { replace: true }), rm ? 300 : 1300);
        };
        type();
      };
      del();
    };
    const onMove = (e: PointerEvent) => {
      if (busy || el.classList.contains("found")) return;
      el.classList.add("trk");
      toward(e.clientX, e.clientY);
    };
    const onLeave = () => {
      if (el.contains(document.activeElement)) return;
      el.classList.remove("trk");
      num.style.setProperty("--r", "0");
      aim(0);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    rows.forEach((b, i) => {
      b.addEventListener("click", () => go(i));
      b.addEventListener("focus", () => aimAt(b));
    });
    return () => {
      ts.forEach(clearTimeout);
      ts = [];
      if (raf) cancelAnimationFrame(raf);
    };
  }, [nav, sug]);

  const host = typeof location !== "undefined" ? location.host : "";
  return (
    <div className="nf-wrap">
      <div ref={root} className="ux u089" key={bad}>
        <div className="u089-url">
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <circle cx="7" cy="7" r="5.6" />
            <path d="M1.6 7h10.8M7 1.4c1.8 1.6 1.8 9.6 0 11.2M7 1.4c-1.8 1.6-1.8 9.6 0 11.2" />
          </svg>
          <span>
            {host}
            <b>{bad}</b>
          </span>
        </div>
        <div className="u089-num" role="img" aria-label="404 오류">
          <span className="u089-d" aria-hidden="true">
            <span className="u089-col" style={{ "--v": 4 } as React.CSSProperties}>
              {[0, 1, 2, 3, 4].map((n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
          <span className="u089-cp" aria-hidden="true">
            <svg viewBox="0 0 72 72">
              <circle className="u089-ring" cx="36" cy="36" r="30.5" />
              <path className="u089-tk" d="M36 14v3M36 55v3M14 36h3M55 36h3" />
              <g className="u089-wob">
                <g className="u089-nd">
                  <path d="M36 15.5l5.5 20.5h-11z" fill="#E5484D" />
                  <path d="M36 56.5l-5.5-20.5h11z" fill="var(--c-text-3)" />
                </g>
              </g>
              <circle className="u089-hub" cx="36" cy="36" r="3.4" />
            </svg>
          </span>
          <span className="u089-d" aria-hidden="true">
            <span className="u089-col" style={{ "--v": 4 } as React.CSSProperties}>
              {[0, 1, 2, 3, 4].map((n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        </div>
        <p className="u089-t" aria-live="polite">
          길을 잃은 것 같아요
        </p>
        <p className="u089-s">주소에 오타가 있거나 페이지가 옮겨졌어요</p>
        <div className="u089-lab">
          <span>가장 비슷한 주소</span>
        </div>
        <ul className="u089-sug">
          {sug.map((s) => (
            <li key={s.to}>
              <button className="u089-row" type="button" data-to={s.to} data-shown={s.shown} data-label={s.label} aria-label={`${s.label} 페이지로 가기, 일치도 ${Math.round(s.m * 100)}%`}>
                <code>{s.shown}</code>
                <small>{s.label}</small>
                <span className="u089-m" aria-hidden="true">
                  <i style={{ "--m": s.m } as React.CSSProperties} />
                </span>
                <svg viewBox="0 0 16 16" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ARROW }} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
