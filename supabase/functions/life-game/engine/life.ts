// 유진 키우기 엔진 — 새 인생 만들기, 해마다 기록 쌓기, 마무리(엔딩).
import { STAT_KEYS, type Entry, type HouseId, type State, type Stats } from "../types.ts";
import { MODS, SPECIALS } from "../content.ts";
import { josa } from "../josa.ts";
import { Ctx, houseOf, netWorth } from "./ctx.ts";
import { jobTitle } from "./shapes.ts";

// ── 새 인생 ──
export function newLife(house: HouseId, bonus: Partial<Stats>, rng: () => number = Math.random): { s: State; log: Entry[] } {
  const s: State = {
    v: 3, age: 0, house, stats: { health: 50, intel: 40, charm: 40, happy: 50, talent: 40 },
    cash: 0, invest: 0, fund: "deposit", debt: 0, assets: [], earned: 0, peak: 0, income: 0, expense: 0, ret: 0,
    job: null, jobSince: 0, salary: 0, jobs: [], edu: "none", school: "아기", score: null, until: 0, fame: 0, biz: 0, army: 0,
    focus: "play", flags: ["house_" + house], seen: {}, people: [], pid: 0, sick: null, luck: 3, pending: null,
    hist: [], thoughts: [], pointsUsed: 0, dead: null, ending: null,
  };
  const c = new Ctx(s, rng);
  for (const k of STAT_KEYS) s.stats[k] = (k === "health" ? 48 : 34) + c.int(0, 20);
  c.stat(bonus);
  const h = houseOf(s);
  c.meet("mom", h.momBond + c.int(-5, 10), "엄마").born = -c.int(27, 34);
  c.meet("dad", h.momBond + c.int(-10, 5), "아빠").born = -c.int(29, 37);
  c.log("life", `${h.name}에서 유진이 태어났다.`);
  pushHist(s);
  return { s, log: c.out };
}

export function pushHist(s: State) {
  const st = s.stats;
  s.hist.push([s.age, st.health, st.intel, st.charm, st.happy, st.talent, netWorth(s), s.luck]);
}

// ── 끝 ──
export function finish(c: Ctx) {
  const s = c.s;
  if (!s.dead) return;
  s.pending = null;
  const a = s.dead.age;
  const causeText = s.dead.why ? s.dead.why : s.dead.cause === "accident"
    ? "갑작스러운 사고"
    : s.dead.cause === "sick"
    ? (s.sick ? s.sick.name : a < 60 ? "건강 악화" : "오랜 병")
    : a >= 95 ? "천수를 누리고" : "노환";
  const mod = MODS.filter((m) => m.if(c)).sort((x, y) => y.pr - x.pr)[0] ?? null;
  const sp = SPECIALS.filter((m) => m.if(c)).sort((x, y) => y.pr - x.pr)[0] ?? null;
  const jobId = s.job ?? s.jobs[s.jobs.length - 1]?.id ?? (s.age < 20 ? "student" : "jobless");
  const jobName = jobTitle(s) ?? s.jobs[s.jobs.length - 1]?.name ?? (s.age < 20 ? "학생" : "백수");
  const family = s.people.filter((p) => p.alive && p.role !== "pet").length;
  const friends = s.people.filter((p) => p.role === "friend").length * 3;
  const fans = Math.round(s.fame * s.fame * 0.5);
  const mourners = family + friends + c.int(2, 8) + Math.round(s.stats.charm / 10) + fans;
  const title = sp ? sp.title : `${mod && mod.id !== "ordinary" ? mod.text + " " : ""}${jobName} 유진`;
  s.ending = {
    title, mod: mod?.text ?? null, modId: mod?.id ?? null, job: jobName, jobId, cause: s.dead.cause, causeText, age: a,
    specialId: sp?.id ?? null, specialText: sp?.text ?? null, mourners, netWorth: netWorth(s), earned: s.earned, peak: s.peak,
  };
  const how = s.dead.cause === "accident"
    ? `${a}세, ${josa(causeText, "로")} 갑작스럽게 생을 마감했다.`
    : s.dead.cause === "sick"
    ? `${a}세, ${josa(causeText, "로")} 생을 마감했다.`
    : `${a}세, 편안히 눈을 감았다.`;
  c.log("end", how, { hl: true });
  // 건강하던 사람이 갑자기 떠났으면 한 줄 더(뜬금없게 느껴지지 않게)
  if (s.dead.why && s.stats.health >= 60) c.log("end", "누구보다 건강했던 사람이라, 다들 한동안 믿기 힘들어했다.");
  c.log("end", `장례식에 ${mourners.toLocaleString("ko-KR")}명이 찾아왔다.${fans > 50 ? " 네루들이 보낸 꽃이 복도를 가득 채웠다." : ""}`);
}
