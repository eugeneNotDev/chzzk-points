// Lucian UX/UI Prompt #379 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#379
// 이어질수록 커지는 연속 기록 불꽃 — 방송 연속 출석.
//  · 큰 숫자: 방송한 날을 빠짐없이 출석한 횟수(오늘 방송이 아직 출석 전이면 끊긴 걸로 안 셈). 위로 굴러 바뀜.
//  · 아래 일곱 칸: 이번 주(월~일). 출석한 날은 불 칸에 체크, 방송했는데 못 온 날은 점선, 방송 없는 날은 흐리게.
//  · 이번 주에 출석한 만큼 불꽃·불빛이 커지고 불티가 늘어남. 이번 주 방송을 전부 출석하면 "이번 주 개근!" 배지.
//  · 불꽃은 겉불·속불·심지 세 겹 윤곽을 매 프레임 조금씩 흔들어 다시 그림(화면 밖이면 쉼). 동작 줄이기면 멈춘 불꽃.
import { useEffect, useMemo, useRef } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { apiFetch, useAuth } from "../../lib/auth";
import { API } from "../../lib/config";
import { supabase } from "../../lib/supabase";
import styles from "./StreakFlame.module.css";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const DAYS = ["월", "화", "수", "목", "금", "토", "일"];

// [밑에서부터의 높이 비율, 폭 비율] — 아래는 둥글고 위로 갈수록 좁아져 뾰족해짐
const PRO = [
  [0.05, 0.6],
  [0.19, 0.96],
  [0.37, 1],
  [0.55, 0.8],
  [0.71, 0.52],
  [0.85, 0.26],
];
const CX = 60;
const BASE = 138;
type Layer = { el: SVGPathElement; w: number; h: number; ph: number; sw: number };

export function StreakFlame({ today, lastAttended }: { today: string; lastAttended?: string[] }) {
  const { token } = useAuth();
  const [ty, tm] = today.split("-").map(Number);
  // 최근 석 달 출석 기록(이번 달은 출석 화면과 같은 키라 같이 씀)
  const months = [0, 1, 2].map((k) => {
    const d = new Date(Date.UTC(ty, tm - 1 - k, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
  });
  const att = useQueries({
    queries: months.map(({ y, m }) => ({
      queryKey: ["attendance", token, y, m],
      queryFn: () => apiFetch<{ attendedDates: string[] }>(`${API.attendance}?year=${y}&month=${m}`),
      staleTime: 60_000,
    })),
  });
  const from = `${months[2].y}-${pad(months[2].m)}-01`;
  const live = useQuery({
    queryKey: ["schedule", "live-range", from, today],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("broadcast_schedule").select("day, kind").gte("day", from).lte("day", today);
      return ((data ?? []) as { day: string; kind: string }[]).filter((r) => r.kind === "live").map((r) => r.day);
    },
  });

  const attendedKey = att.map((q) => (q.data?.attendedDates ?? []).join(",")).join("|") + "|" + (lastAttended ?? []).join(",");
  const { streak, week, weekDone, weekAll } = useMemo(() => {
    const attended = new Set<string>([...(lastAttended ?? []), ...att.flatMap((q) => q.data?.attendedDates ?? [])]);
    // 방송한 날 = 일정표의 방송일 + 실제로 출석이 있었던 날(일정표를 안 채운 날도 셈)
    const liveDays = new Set<string>([...(live.data ?? []), ...attended]);
    const t = new Date(`${today}T00:00:00Z`);
    let s = 0;
    for (let i = 0; i < 100; i++) {
      const d = new Date(t.getTime() - i * 86_400_000);
      const k = ymd(d);
      if (k < from) break;
      if (!liveDays.has(k)) continue;
      if (attended.has(k)) s++;
      else if (k === today) continue;
      else break;
    }
    const dow = (t.getUTCDay() + 6) % 7; // 월=0
    const wk = DAYS.map((label, i) => {
      const d = new Date(t.getTime() + (i - dow) * 86_400_000);
      const k = ymd(d);
      return { label, date: k, on: attended.has(k), live: liveDays.has(k), today: k === today, future: k > today };
    });
    const done = wk.filter((d) => d.on).length;
    const pastLive = wk.filter((d) => !d.future && d.live);
    return { streak: s, week: wk, weekDone: done, weekAll: pastLive.length > 0 && pastLive.every((d) => d.on) && done >= 2 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendedKey, live.data, today, from]);

  const root = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const sparks = useRef<SVGGElement>(null);
  const flare = useRef(0);
  const doneRef = useRef(weekDone);
  doneRef.current = weekDone;

  // 오늘 출석이 새로 생기면 불꽃이 확 치솟음
  const prevStreak = useRef(streak);
  useEffect(() => {
    if (streak > prevStreak.current) flare.current = 1;
    prevStreak.current = streak;
  }, [streak]);

  useEffect(() => {
    const el = svg.current;
    const sp = sparks.current;
    const r = root.current;
    if (!el || !sp || !r) return;
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // 겉불·속불·심지 순서(마크업 순서 그대로)
    const [po, pm, pc] = Array.from(el.querySelectorAll<SVGPathElement>("path"));
    if (!po || !pm || !pc) return;
    const LY: Layer[] = [
      { el: po, w: 40, h: 126, ph: 0, sw: 1 },
      { el: pm, w: 28, h: 88, ph: 1.7, sw: 0.8 },
      { el: pc, w: 15, h: 48, ph: 3.1, sw: 0.55 },
    ];
    const outline = (L: Layer, t: number) => {
      const f0 = flare.current;
      const w = L.w * (1 + f0 * 0.08);
      const h = L.h * (1 + f0 * 0.2);
      const sw = (f: number) => (Math.sin(t * 1.7 + L.ph) * 0.6 + Math.sin(t * 2.9 + L.ph * 2) * 0.4) * h * 0.13 * L.sw * Math.pow(f, 1.5);
      const R: number[][] = [];
      const Lf: number[][] = [];
      PRO.forEach(([f, q]) => {
        const y = BASE - f * h;
        const x = q * w;
        const s0 = sw(f);
        R.push([CX + x + s0 + Math.sin(t * 6.1 + f * 7 + L.ph) * w * 0.07 * f, y]);
        Lf.unshift([CX - x + s0 - Math.sin(t * 5.3 + f * 6 + L.ph + 2) * w * 0.07 * f, y]);
      });
      const tip = [CX + sw(1) + Math.sin(t * 4.3 + L.ph) * w * 0.12, BASE - h * (1 + Math.sin(t * 5.2 + L.ph) * 0.035)];
      const P = [[CX, BASE], ...R, tip, tip, ...Lf];
      const n = P.length;
      let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
      for (let i = 0; i < n; i++) {
        const a = P[(i - 1 + n) % n];
        const b = P[i];
        const c = P[(i + 1) % n];
        const e = P[(i + 2) % n];
        d += ` C${(b[0] + (c[0] - a[0]) / 6).toFixed(1)} ${(b[1] + (c[1] - a[1]) / 6).toFixed(1)} ${(c[0] - (e[0] - b[0]) / 6).toFixed(1)} ${(c[1] - (e[1] - b[1]) / 6).toFixed(1)} ${c[0].toFixed(1)} ${c[1].toFixed(1)}`;
      }
      L.el.setAttribute("d", d + "Z");
    };
    // 불티: 불꽃 위쪽에서 태어나 흔들리며 올라가다 사라짐
    sp.replaceChildren();
    const SP = Array.from({ length: 7 }, () => {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      sp.appendChild(c);
      return { el: c, t0: -1, life: 0, x: 0, dx: 0, r: 0 };
    });
    const drawSparks = (now: number) => {
      SP.forEach((p, k) => {
        const on = k < 2 + Math.round(doneRef.current * 0.7 + flare.current * 3);
        if (p.t0 < 0 || now - p.t0 > p.life) {
          if (!on) {
            p.el.setAttribute("r", "0");
            p.t0 = -1;
            return;
          }
          p.t0 = now + Math.random() * 600;
          p.life = 900 + Math.random() * 700;
          p.x = CX + (Math.random() - 0.5) * 30;
          p.dx = (Math.random() - 0.5) * 30;
          p.r = 1 + Math.random() * 1.6;
        }
        const q = (now - p.t0) / p.life;
        if (q < 0) {
          p.el.setAttribute("r", "0");
          return;
        }
        p.el.setAttribute("cx", (p.x + p.dx * q + Math.sin(q * 9 + k) * 3).toFixed(1));
        p.el.setAttribute("cy", (BASE - 70 - q * 80).toFixed(1));
        p.el.setAttribute("r", (p.r * (1 - q)).toFixed(2));
        p.el.setAttribute("opacity", (1 - q).toFixed(2));
      });
    };
    if (rm) {
      LY.forEach((L) => outline(L, 0));
      return;
    }
    let vis = true;
    let raf = 0;
    const frame = (now: number) => {
      if (vis) {
        const t = now / 1000;
        flare.current = Math.max(0, flare.current - 0.02);
        LY.forEach((L) => outline(L, t));
        drawSparks(now);
      }
      raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver((es) => {
      vis = es[0].isIntersecting;
    });
    io.observe(r);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  const s = 0.8 + Math.min(7, weekDone) * 0.05;
  const loading = att.some((q) => q.isLoading);
  const maxN = Math.max(60, streak + 1);
  return (
    <section ref={root} className={`${styles.u379} ${weekAll ? styles.isWeek : ""}`} aria-label={`방송 연속 출석 ${streak}회`}>
      <div className={styles.glow} style={{ opacity: 0.4 + Math.min(7, weekDone) * 0.09, transform: `scale(${(0.8 + Math.min(7, weekDone) * 0.06).toFixed(2)})` }} aria-hidden="true" />
      <div className={styles.fl} style={{ transform: `scale(${s.toFixed(2)})` }} aria-hidden="true">
        <svg ref={svg} viewBox="0 0 120 144">
          <defs>
            <linearGradient id="u379o" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#FF7A1A" />
              <stop offset=".55" stopColor="#F5462A" />
              <stop offset="1" stopColor="#D9262B" />
            </linearGradient>
            <linearGradient id="u379m" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#FFC24A" />
              <stop offset="1" stopColor="#FF8A1F" />
            </linearGradient>
            <linearGradient id="u379c" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#FFFBEA" />
              <stop offset="1" stopColor="#FFE27A" />
            </linearGradient>
          </defs>
          <g ref={sparks} className={styles.sp} />
          <path className={styles.fo} fill="url(#u379o)" />
          <path fill="url(#u379m)" />
          <path fill="url(#u379c)" />
        </svg>
      </div>
      <div className={styles.ct} aria-live="polite">
        <span className={styles.nw}>
          <span className={`${styles.ns} num`} style={{ transform: `translateY(${-(loading ? 0 : streak) * 44}px)` }}>
            {Array.from({ length: maxN }, (_, i) => (
              <i key={i}>{i}</i>
            ))}
          </span>
        </span>
        <b>회 연속 출석</b>
      </div>
      <div className={styles.wk}>
        {week.map((d) => (
          <div key={d.date} title={d.date}>
            <div className={styles.dy}>{d.label}</div>
            <div className={`${styles.dt} ${d.on ? styles.on : ""} ${d.today ? styles.today : ""} ${!d.on && !d.live ? styles.off : ""}`} />
          </div>
        ))}
      </div>
      <div className={styles.bd}>이번 주 개근!</div>
    </section>
  );
}
