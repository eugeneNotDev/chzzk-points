// 유진 키우기 밸런스 점검 — 콘텐츠를 바꾼 뒤 한 번씩 돌려서 이상한 곳이 없나 확인.
// 실행: node --experimental-strip-types tools/life-content/balance.ts [판 수=4000]
// 보는 것: 오류 · 집별 결과 · 직업/수식어/특수엔딩/희귀 이벤트 도달률(무작위 플레이) · 노리고 할 때 전문직 도달률 · 이벤트 반복
// ⚠ 표시: 도감 항목이 0.2% 미만(거의 못 얻음) / 한 판에 같은 일상이 8번 이상 반복 / 오류
import { advance, choose, setFocus, startRun, stageOf } from "../../supabase/functions/life-game/engine.ts";
import { DAILY, FOCUSES, JOBS, MODS, SPECIALS } from "../../supabase/functions/life-game/content.ts";
import type { HouseId, State } from "../../supabase/functions/life-game/types.ts";

const N = Number(process.argv[2] ?? 4000);
const HOUSES: HouseId[] = ["poor", "normal", "comfy", "rich"];
const BONUS: Record<HouseId, Record<string, number>> = { poor: {}, normal: { happy: 5, health: 4, charm: 4 }, comfy: { intel: 5, happy: 5 }, rich: { intel: 10, happy: -5 } };
const inc = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);
const pct = (v: number, n = N) => `${((100 * v) / n).toFixed(1)}%`;
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;

// 한 판 굴리기. pick: 결정에서 고를 선택지(없으면 무작위)
type Opt = NonNullable<State["pending"]>["opts"][number];
function play(house: HouseId, pick?: (s: State, ok: Opt[]) => Opt | undefined, focus?: (s: State) => string | undefined, stopAge = 999) {
  const { s, log } = startRun(house, BONUS[house] as never);
  let errors = 0, guard = 0;
  while (!s.dead && guard++ < 400 && s.age < stopAge) {
    const f = focus?.(s);
    if (f) setFocus(s, f);
    else if (Math.random() < 0.1) { const fs = FOCUSES.filter((x) => x.stage === stageOf(s.age + 1)); setFocus(s, fs[Math.floor(Math.random() * fs.length)].id); }
    if (s.pending) {
      const ok = s.pending.opts.filter((o) => !o.off);
      if (!ok.length) { errors++; s.pending = null; continue; }
      const o = pick?.(s, ok) ?? ok[Math.floor(Math.random() * ok.length)];
      if (choose(s, log, o.key).error) { errors++; s.pending = null; }
      continue;
    }
    advance(s, log, 1);
  }
  return { s, log, errors };
}

// ── 1. 무작위 플레이 ──
let errors = 0, decisions = 0, worstRepeat = 0;
const per: Record<string, { age: number[]; net: number[]; bank: number; sp: number }> = {};
const job: Record<string, number> = {}, mod: Record<string, number> = {}, sp: Record<string, number> = {}, rare: Record<string, number> = {}, repeats: Record<string, number> = {};
for (let i = 0; i < N; i++) {
  const h = HOUSES[i % 4];
  const { s, log, errors: e } = play(h, () => { decisions++; return undefined; });
  errors += e;
  const p = (per[h] ??= { age: [], net: [], bank: 0, sp: 0 });
  p.age.push(s.age); p.net.push(s.ending?.netWorth ?? 0);
  if (s.flags.includes("bankrupt")) p.bank++;
  if (s.ending?.specialId) p.sp++;
  for (const id of new Set(s.jobs.map((j) => j.id))) inc(job, id);
  inc(mod, s.ending?.modId ?? "-"); inc(sp, s.ending?.specialId ?? "-");
  for (const f of s.flags) if (f.startsWith("dex_event_")) inc(rare, f.slice(10));
  const dc: Record<string, number> = {};
  for (const x of log) if (x.k === "day") inc(dc, x.t);
  for (const [t, v] of Object.entries(dc)) { worstRepeat = Math.max(worstRepeat, v); if (v >= 8) inc(repeats, t); }
}
const warn = (v: number) => (v < N * 0.002 ? " ⚠" : "");
console.log(`\n■ 무작위 플레이 ${N}판 — 오류 ${errors}${errors ? " ⚠" : ""} · 결정 ${(decisions / N).toFixed(1)}회/판`);
for (const h of HOUSES) { const p = per[h], n = p.age.length; console.log(`  ${h.padEnd(6)} 수명 ${med(p.age)} · 순자산 중앙 ${med(p.net)}만 · 파산 ${pct(p.bank, n)} · 특수엔딩 ${pct(p.sp, n)}`); }
console.log("\n■ 직업(한 번이라도)\n  " + JOBS.map((j) => `${j.name} ${pct(job[j.id] ?? 0)}${warn(job[j.id] ?? 0)}`).join(" · "));
console.log("\n■ 엔딩 수식어\n  " + MODS.map((m) => `${m.text} ${pct(mod[m.id] ?? 0)}${warn(mod[m.id] ?? 0)}`).join(" · "));
console.log("\n■ 특수 엔딩\n  " + SPECIALS.map((m) => `${m.title} ${pct(sp[m.id] ?? 0)}${warn(sp[m.id] ?? 0)}`).join(" · "));
console.log("\n■ 희귀 이벤트(실제 생일 11/22에만 나오는 건 0%가 정상)\n  " + DAILY.filter((d) => d.rare).map((d) => `${d.id} ${pct(rare[d.id] ?? 0)}${warn(rare[d.id] ?? 0)}`).join(" · "));
console.log(`\n■ 같은 일상 이벤트 한 판 최다 반복 ${worstRepeat}회${worstRepeat >= 8 ? " ⚠" : ""}`);
for (const [t, v] of Object.entries(repeats).sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`  ${pct(v)}의 판에서 8번 이상: ${t}`);

// ── 2. 노리고 할 때 전문직 도달률(목표: 20~30% 안팎) ──
const AIM: Record<string, { kw: string[]; f1: string; f2: string; late?: string }> = {
  doctor: { kw: ["의대에 간다", "최선을 다한다", "재수한다", "명문대에 간다", "서울에 있는 대학", "지방 대학", "바로 취업"], f1: "study", f2: "selfdev", late: "med_late" },
  lawyer: { kw: ["명문대에 간다", "최선을 다한다", "재수한다", "서울에 있는 대학", "지방 대학", "바로 취업"], f1: "study", f2: "selfdev", late: "law_school" },
  professor: { kw: ["대학원에 간다", "명문대에 간다", "서울에 있는 대학", "최선을 다한다", "재수한다"], f1: "study", f2: "selfdev", late: "late_grad" },
  teacher: { kw: ["서울에 있는 대학", "지방 대학", "최선을 다한다", "바로 취업"], f1: "study", f2: "selfdev" },
  bigcorp: { kw: ["명문대에 간다", "서울에 있는 대학", "최선을 다한다", "재수한다", "바로 취업"], f1: "study", f2: "selfdev" },
  idol: { kw: ["오디션을 본다", "무대에 오른다"], f1: "friends", f2: "people" },
};
const M = Math.max(500, Math.round(N / 4));
console.log(`\n■ 노리고 할 때(각 ${M}판, 평범한 가정)`);
const line: string[] = [];
for (const [id, t] of Object.entries(AIM)) {
  let got = 0;
  for (let i = 0; i < M; i++) {
    const { s } = play("normal", (st, ok) => {
      let o = ok.find((x) => x.arg === id);
      if (!o && t.late && st.pending!.id === t.late) o = ok.find((x) => x.text === "도전한다" || x.text === "대학원에 간다");
      if (!o && st.pending!.id === "job_hunt" && st.age < 35) o = t.late && st.age >= 23 ? ok.find((x) => x.arg && x.arg !== "rest") : ok.find((x) => x.arg === "rest");
      if (!o) for (const k of t.kw) { o = ok.find((x) => x.text.includes(k)); if (o) break; }
      return o;
    }, (st) => (st.age >= 7 && st.age < 18 ? t.f1 : st.age >= 18 ? t.f2 : undefined), 45);
    if (s.jobs.some((j) => j.id === id)) got++;
  }
  line.push(`${JOBS.find((j) => j.id === id)!.name} ${pct(got, M)}`);
}
console.log("  " + line.join(" · "));
