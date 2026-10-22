// 랜덤 보호자로 인생 N번 돌려서 밸런스 확인
import { advance, buy, choose, setFocus, shopList, startRun, stageOf } from "../../supabase/functions/life-game/engine.ts";
import { FOCUSES } from "../../supabase/functions/life-game/content.ts";
import type { HouseId } from "../../supabase/functions/life-game/types.ts";

const N = Number(process.argv[2] ?? 400);
const SMART = process.argv[3] === "smart";
const houses: HouseId[] = ["poor", "normal", "comfy", "rich"];
const agg: Record<string, Record<string, number>> = { job: {}, mod: {}, sp: {}, cause: {}, house: {}, pend: {}, err: {} };
const inc = (k: string, v: string) => (agg[k][v] = (agg[k][v] ?? 0) + 1);
let ages = 0, decs = 0, married = 0, kidsN = 0, nets: number[] = [], dice = 0, offs = 0, maxLog = 0;
const fin: Record<string, number[]> = {};
const ageDec: number[] = new Array(11).fill(0);
for (let i = 0; i < N; i++) {
  const h = houses[i % 4];
  const { s, log } = startRun(h, h === "rich" ? { intel: 10, happy: -5 } : h === "comfy" ? { happy: 5, intel: 5 } : {});
  let guard = 0;
  while (!s.dead && guard++ < 400) {
    if (s.pending) {
      inc("pend", s.pending.id);
      decs++;
      ageDec[Math.min(10, Math.floor(s.age / 10))]++;
      const ok = s.pending.opts.filter((o) => !o.off);
      offs += s.pending.opts.length - ok.length;
      if (!ok.length) { inc("err", "no_opts:" + s.pending.id); s.pending = null; continue; }
      const o = SMART && Math.random() < 0.65 ? ok[0] : ok[Math.floor(Math.random() * ok.length)];
      if (o.roll !== undefined) dice++;
      const r = choose(s, log, o.key);
      if (r.error) { inc("err", r.error + ":" + s.pending?.id); s.pending = null; }
      continue;
    }
    if (Math.random() < 0.15) {
      const fs = FOCUSES.filter((f) => f.stage === stageOf(s.age + 1));
      setFocus(s, fs[Math.floor(Math.random() * fs.length)].id);
    }
    if (s.age >= 15 && Math.random() < 0.1) {
      const sh = shopList(s).filter((x) => x.cashOk && !x.off);
      if (sh.length) buy(s, log, sh[Math.floor(Math.random() * sh.length)].id, "cash");
    }
    advance(s, log, 1);
  }
  ages += s.age;
  maxLog = Math.max(maxLog, log.length);
  inc("job", s.ending?.job ?? "?");
  inc("mod", s.ending?.mod ?? "-");
  inc("sp", s.ending?.specialId ?? "-");
  inc("cause", s.dead?.cause ?? "?");
  if (s.flags.includes("married")) married++;
  kidsN += s.people.filter((p) => p.role === "child").length;
  nets.push(s.ending?.netWorth ?? 0);
  for (const k of Object.keys(s.stats)) (fin[k] ??= []).push((s.stats as any)[k]);
  if (i === 0) {
    for (const e of log.slice(0, 400)) console.log(e.age, e.k, e.t, e.m ? `[${e.m}만]` : "", e.roll ? `🎲${e.roll.dice.join("+")}${e.roll.mod >= 0 ? "+" : ""}${e.roll.mod}=${e.roll.total} ${e.roll.tier}` : "");
    console.log(JSON.stringify(s.ending));
  }
}
nets.sort((a, b) => a - b);
const top = (o: Record<string, number>, n = 200) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join("  ");
console.log("\n평균 수명", (ages / N).toFixed(1), "결정/판", (decs / N).toFixed(1), "주사위/판", (dice / N).toFixed(1), "결혼율", (married / N).toFixed(2), "자녀", (kidsN / N).toFixed(2), "최대로그", maxLog, "돈부족선택지/판", (offs / N).toFixed(1));
console.log("나이대별 결정", ageDec.map((v) => (v / N).toFixed(1)).join(" "));
console.log("순자산(만원) 10/25/50/75/90%", [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => nets[Math.floor(p * N)]).join(" / "));
console.log("마지막 능력치 평균", Object.entries(fin).map(([k, v]) => `${k} ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(0)} (≥80: ${v.filter((x) => x >= 80).length})`).join(" · "));
for (const k of Object.keys(agg)) console.log(`\n[${k}]`, top(agg[k]));
