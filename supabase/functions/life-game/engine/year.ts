// 유진 키우기 엔진 — 한 해 굴리기(초점·능력치 변화·수입·생활비·경제·부모님·학교·군대·일상·병·죽음).
import { badDebt, type StatKey } from "../types.ts";
import { DAILY, DISEASES, FOCUSES, JOBS, FUNDS, SHOWS } from "../content.ts";
import { josa } from "../josa.ts";
import { Ctx, houseOf, netWorth } from "./ctx.ts";
import type { Job } from "./shapes.ts";
import { clamp, fmtMoney, stageOf, statMod } from "./tools.ts";

// ── 한 해 ──
export function focusYear(c: Ctx) {
  const s = c.s;
  const f = FOCUSES.find((x) => x.id === s.focus && x.stage === stageOf(s.age)) ?? FOCUSES.find((x) => x.stage === stageOf(s.age))!;
  if (f.id !== s.focus) s.focus = f.id;
  for (const [k, v] of Object.entries(f.s) as [StatKey, number][]) {
    const cur = s.stats[k];
    const p = cur < 50 ? 0.85 : cur < 70 ? 0.55 : cur < 85 ? 0.3 : 0.1; // 높을수록 덜 오름
    if (c.chance(p)) c.stat({ [k]: v });
  }
  if (f.side) for (const [k, v] of Object.entries(f.side) as [StatKey, number][]) if (c.chance(0.4)) c.stat({ [k]: v });
  if (f.money && !s.job && s.army === 0 && s.age >= 15) s.cash += f.money;
}

export function drift(c: Ctx) {
  const s = c.s;
  const a = s.age;
  // 나이 들면 건강이 조금씩
  if (a >= 30 && a < 50 && c.chance(0.15)) c.stat({ health: -1 });
  else if (a >= 50 && a < 65 && c.chance(0.35)) c.stat({ health: -1 });
  else if (a >= 65 && a < 80 && c.chance(0.75)) c.stat({ health: -1 });
  else if (a >= 80) c.stat({ health: -c.int(1, 2) });
  // 아직 젊으면 몸이 조금씩 회복
  if (a < 65 && s.stats.health < 50 && c.chance(0.35)) c.stat({ health: 1 });
  // 행복은 55 쪽으로 천천히
  const h = s.stats.happy;
  if (h > 85) c.stat({ happy: -3 });
  else if (h > 70 && c.chance(0.8)) c.stat({ happy: -2 });
  else if (h > 58 && c.chance(0.5)) c.stat({ happy: -1 });
  else if (h < 45 && c.chance(0.4)) c.stat({ happy: 1 });
  for (const k of ["intel", "charm", "talent"] as StatKey[]) if (s.stats[k] > 75 && c.chance(0.25)) c.stat({ [k]: -1 });
  if (a >= 70 && c.chance(0.3)) c.stat({ intel: -1 });
  if (c.has("smoker") && c.chance(0.4)) c.stat({ health: -1 });
  // 병
  if (s.sick && c.chance(s.sick.sev >= 3 ? 0.8 : 0.5)) c.stat({ health: -s.sick.sev });
  // 사람 사이
  const sp = c.person("spouse");
  if (sp) {
    c.bond(sp, s.focus === "people" || s.focus === "family" ? c.int(0, 3) : c.int(-2, 2));
    if (sp.bond >= 70 && c.chance(0.5)) c.stat({ happy: 1 });
  }
  const pt = c.person("partner");
  if (pt) c.bond(pt, s.focus === "people" ? c.int(0, 4) : c.int(-2, 2));
  for (const p of c.folks("mom").concat(c.folks("dad"))) if (c.chance(0.3)) c.bond(p, s.focus === "family" ? 2 : -1);
  if (a >= 35 && !sp && !pt && c.folks("friend").length === 0 && c.chance(0.4)) c.stat({ happy: -1 });
}

function jobIncome(c: Ctx): number {
  const s = c.s;
  const j = JOBS.find((x) => x.id === s.job);
  if (!j) return 0;
  if (j.fy) for (const [k, v] of Object.entries(j.fy) as [StatKey, number][]) if (c.chance(0.2)) c.stat({ [k]: v });
  if (j.creator) {
    // 인지도 주사위 — 창작 집중이면 +1. 버튜버는 주력 컨텐츠에 따라 굴리는 능력치·결과가 다름
    const show = j.id === "vtuber" ? SHOWS.find((x) => x.id === s.show) : undefined;
    const r = c.roll(show ? show.stat : "talent", (s.focus === "create" ? 1 : 0) + (show?.bonus ?? 0));
    const dF = (show?.dF ?? { great: 12, good: 5, normal: 1, bad: -3, terrible: -9 })[r.tier];
    const before = s.fame;
    s.fame = clamp(Math.round(s.fame + (dF > 0 ? dF * (1 - s.fame / 115) : dF)), 0, 100);
    if (r.tier === "great") c.apply(show?.greatFx, "job", show?.great ?? (s.fame >= 60 ? "클립 하나가 터져서 팔로워가 확 늘었다." : "방송이 입소문을 타기 시작했다."), { roll: r, hl: true });
    else if (r.tier === "terrible") c.apply(show?.badFx ?? { s: { happy: -5 } }, "job", show?.bad ?? "말실수가 퍼져서 한동안 시끄러웠다.", { roll: r });
    // 버튜버는 나이가 들수록 인지도가 빠짐(40세 1, 45세 2, 50세 3, 60세 5 …)
    if (j.id === "vtuber" && s.age >= 40) s.fame = clamp(s.fame - Math.ceil((s.age - 38) / 5), 0, 100);
    if (s.fame >= 55) c.add("fame55"); // 엔딩은 죽을 때가 아니라 가장 유명했던 때 기준
    if (before < 30 && s.fame >= 30 && !c.has("yangs")) c.log("job", "고정 시청자가 생겼다. 팬 이름을 '네루'로 정했다.", { hl: true, d: c.stat({ happy: 5 }) }), c.add("yangs");
    if (before < 70 && s.fame >= 70 && !c.has("gold_button")) c.log("job", "팔로워 100만을 넘었다. 축하 방송에 네루들이 몰려왔다.", { hl: true, d: c.stat({ happy: 6, charm: 3 }) }), c.add("gold_button");
    rankByValue(c, j, s.fame, "fame");
    // 아직 작은 방송인은 알바를 병행해서 최소한은 범
    return Math.max(s.fame < 30 ? 1300 : 0, Math.round((150 + s.fame * s.fame * 2.6) * j.creator * (0.6 + c.rnd() * 0.8)));
  }
  if (j.biz) {
    const r = c.roll("intel", s.focus === "work" ? 1 : 0);
    s.biz = clamp(Math.round(s.biz + { great: 14, good: 6, normal: 0, bad: -6, terrible: -15 }[r.tier] + (40 - s.biz) * 0.1), 0, 100);
    if (r.tier === "great") c.log("job", "가게 앞에 줄이 생겼다.", { roll: r, hl: true });
    if (r.tier === "terrible") c.log("job", "근처에 같은 가게가 세 곳이나 생겼다.", { roll: r });
    rankByValue(c, j, s.biz, "biz");
    return Math.round((s.biz - 28) * 75);
  }
  // 월급쟁이: 해마다 오르고, 일 집중이면 더. 한 등급에 4년 넘게 있으면 가끔 승진
  if (j.ranks && s.age - (s.rankSince ?? s.jobSince) >= 4 && c.chance(0.14 + (s.focus === "work" ? 0.12 : 0) + statMod(s.stats.intel) * 0.02)) c.promote(1);
  const g = (j.growth ?? 0.03) + (s.focus === "work" ? 0.02 : 0);
  const cap = (j.cap ?? 99999) * (1 + 0.15 * (s.rank ?? 0));
  s.salary = Math.min(Math.round(cap), Math.round(s.salary * (1 + g)));
  return s.salary;
}

// 인지도·경기 값으로 오르는 직업의 등급(내려가진 않음)
function rankByValue(c: Ctx, j: Job, v: number, why: "fame" | "biz") {
  if (!j.ranks || !j.rankAt) return;
  let target = 0;
  j.rankAt.forEach((need, i) => {
    if (v >= need) target = i;
  });
  const cur = c.s.rank ?? 0;
  if (target > cur) c.promote(target - cur, why);
}

// 이벤트·갈림길·물건으로 인지도가 오른 그 자리에서 등급도 맞춤(연말까지 안 기다리게)
export function syncRank(c: Ctx) {
  const j = JOBS.find((x) => x.id === c.s.job);
  if (j?.creator) rankByValue(c, j, c.s.fame, "fame");
}

function livingCost(c: Ctx) {
  const s = c.s;
  const indep = s.age >= 20 && (s.job !== null || s.age >= 25 || !!c.person("spouse")) && s.army === 0;
  let e = 0;
  if (indep) {
    e += 1700 + Math.min(5000, Math.max(0, netWorth(s)) * 0.025);
    if (!s.assets.some((x) => x.kind === "home")) e += 900; // 월세
    if (c.person("spouse")) e += 1000;
    if (s.age >= 65) e *= 0.7;
  } else if (s.age >= 20 && s.army === 0) {
    e += houseOf(s).tuition <= 0 ? 500 : 0; // 형편이 어려우면 자취·생활비를 스스로
  }
  for (const k of c.folks("child")) {
    const ka = s.age - k.born;
    e += ka <= 6 ? 600 : ka <= 18 ? 1000 : ka <= 23 ? 700 : 0;
  }
  if (s.assets.some((x) => x.kind === "car")) e += 250;
  if (c.has("insurance")) e += 150;
  return Math.round(e);
}

export function economy(c: Ctx) {
  const s = c.s;
  const h = houseOf(s);
  let inc = 0;
  if (s.age >= 8 && s.age < 20 && (c.person("mom") || c.person("dad"))) inc += h.allowance;
  if (s.job && s.army === 0) {
    const pay = jobIncome(c);
    inc += pay > 0 ? Math.round(pay * 0.85) : pay;
  } else if (s.age >= 60 && !s.job && !c.has("retired")) {
    c.add("retired");
    s.school = "은퇴";
  }
  if (!s.job && c.has("retired")) {
    inc += Math.round((c.has("pension_civil") ? 1.5 : 1) * (600 + Math.min(1800, s.earned * 0.008)));
  }
  let exp = livingCost(c);
  // 돈이 바닥이면 허리띠를 졸라맴
  if (s.cash + s.invest <= 0 && exp > inc) exp = Math.max(Math.min(exp, 900), Math.round(inc * 0.95));
  s.cash += inc - exp;
  if (inc > 0) s.earned += inc;
  s.income = inc;
  s.expense = exp;

  // 투자 수익
  const f = FUNDS.find((x) => x.id === s.fund) ?? FUNDS[0];
  let ret = 0;
  if (s.invest > 0) {
    const g = (c.rnd() + c.rnd() + c.rnd() - 1.5) * 2; // 대략 -3~3
    let r = f.mean + f.vol * g;
    if (f.id === "coin" && c.chance(0.08)) r = -0.75;
    r = Math.max(-0.9, r);
    ret = Math.round(s.invest * r);
    s.invest += ret;
  }
  s.ret = ret;
  // 집값·차값
  for (const a of s.assets) {
    if (a.kind === "home") a.value = Math.round(a.value * (1 + 0.03 + (c.rnd() - 0.5) * 0.12));
    if (a.kind === "car") a.value = Math.round(a.value * 0.85);
  }
  s.assets = s.assets.filter((a) => a.kind !== "car" || a.value > 100);
  // 빚 이자
  if (s.debt > 0) s.cash -= Math.round(s.debt * 0.05);
  // 돈 정리: 모자라면 투자금 → 빚, 남으면 빚 갚고 → 여유자금 투자
  const buffer = s.age < 20 ? 50 : Math.max(500, s.expense);
  if (s.cash < 0) {
    const take = Math.min(s.invest, -s.cash);
    s.invest -= take;
    s.cash += take;
    if (s.cash < 0) {
      s.debt += -s.cash;
      s.cash = 0;
    }
  } else if (s.cash > buffer) {
    let extra = s.cash - buffer;
    const pay = Math.min(extra, s.debt);
    s.debt -= pay;
    extra -= pay;
    s.cash -= pay;
    if (s.age >= 15 && extra > 0) {
      s.invest += extra;
      s.cash -= extra;
    }
  }
  // 빚이 너무 많으면
  const bd = badDebt(s);
  if (bd > 3000 && bd > (s.income + 1) * 4 && c.chance(0.5)) c.stat({ happy: -2, health: -1 });
  s.peak = Math.max(s.peak, netWorth(s));
}

export function parents(c: Ctx) {
  const s = c.s;
  for (const p of c.folks("mom").concat(c.folks("dad"))) {
    const pa = s.age - p.born;
    const pr = pa < 60 ? 0.002 : pa < 70 ? 0.01 : pa < 80 ? 0.03 : pa < 90 ? 0.09 : 0.22;
    if (c.chance(pr)) {
      p.alive = false;
      const who = p.role === "mom" ? "엄마" : "아빠";
      c.log("people", `${who}가 ${pa}세로 세상을 떠났다.`, { d: c.stat({ happy: -(6 + Math.round(p.bond / 10)) }), hl: true });
      if (!c.person("mom") && !c.person("dad")) {
        const h = houseOf(s);
        if (h.inherit > 0) {
          const amt = Math.round(h.inherit * (0.6 + c.rnd() * 0.8) * (c.has("disinherit") ? 0.2 : 1));
          s.cash += amt;
          c.log("money", `부모님이 남기신 재산 ${fmtMoney(amt)}을 물려받았다.`, { m: amt });
        }
      }
    }
  }
  // 아이 나이 마디
  for (const k of c.folks("child")) {
    const ka = s.age - k.born;
    if (ka === 1) c.log("people", `${josa(k.name, "가")} 첫걸음마를 뗐다.`, { d: c.stat({ happy: 2 }) });
    if (ka === 8) c.log("people", `${josa(k.name, "가")} 초등학교에 입학했다.`, { d: c.stat({ happy: 2 }) });
    if (ka === 20) c.log("people", `${josa(k.name, "가")} 성인이 됐다.`, { d: c.stat({ happy: 2 }) });
  }
  const pet = c.person("pet");
  if (pet && s.age - pet.born >= 12 && c.chance(0.3)) {
    pet.alive = false;
    c.log("people", `${josa(pet.name, "가")} 무지개다리를 건넜다.`, { d: c.stat({ happy: -6 }), hl: true });
  }
  // 연인과 너무 멀어지면 헤어짐
  const pt = c.person("partner");
  if (pt && pt.bond < 15) {
    c.drop(pt);
    c.log("people", `${josa(pt.name, "와")} 헤어졌다.`, { d: c.stat({ happy: -5 }) });
  }
}

// 학교 이름표(직업·군대·특별한 학교가 없을 때만)
export function schoolLabel(c: Ctx) {
  const s = c.s;
  if (s.job || s.army > 0) return;
  if (s.age === 3) s.school = "유치원생";
  if (s.age === 8) s.school = "초등학생";
  if (s.age === 14) s.school = "중학생";
}

export function armyYear(c: Ctx) {
  const s = c.s;
  if (s.army <= 0) return false;
  s.army--;
  c.stat({ health: c.int(1, 3), intel: -1 });
  if (s.army === 0) {
    c.log("school", "전역했다. 하늘이 유난히 파랬다.", { d: c.stat({ happy: 6 }), hl: true });
    c.add("army_done");
    s.school = s.edu === "none" || s.edu === "high" ? "사회 초년생" : "복학생";
  } else {
    const t = c.pick(["새벽 불침번을 서며 별을 셌다.", "PX 냉동식품이 세상에서 제일 맛있었다.", "행군 중에 발에 물집이 잡혔다.", "편지 한 통에 하루 종일 웃었다."]);
    c.log("day", t);
  }
  return true;
}

export function pickWeighted<T extends { w?: number }>(c: Ctx, list: T[], weight: (x: T) => number = (x) => x.w ?? 10): T | null {
  const tot = list.reduce((a, x) => a + Math.max(0, weight(x)), 0);
  if (tot <= 0) return null;
  let r = c.rnd() * tot;
  for (const x of list) {
    r -= Math.max(0, weight(x));
    if (r <= 0) return x;
  }
  return list[list.length - 1];
}

export function eligible(c: Ctx, e: { id: string; a: [number, number]; if?: (c: Ctx) => boolean; rep?: number }) {
  const s = c.s;
  if (s.age < e.a[0] || s.age > e.a[1]) return false;
  const last = s.seen[e.id];
  if (last !== undefined) {
    if (!e.rep) return false;
    if (s.age - last < e.rep) return false;
  }
  if (e.if && !e.if(c)) return false;
  return true;
}

export function dailyEvents(c: Ctx) {
  const s = c.s;
  const n = c.chance(0.3) ? 2 : c.chance(0.8) ? 1 : 0;
  for (let i = 0; i < n; i++) {
    const pool = DAILY.filter((e) => !e.rare && eligible(c, e));
    const e = pickWeighted(c, pool, (x) => (x.w ?? 10) * (x.tone === 1 ? [0, 0.5, 0.8, 1, 1, 1.3, 2][s.luck] : x.tone === -1 ? [0, 2, 1.3, 1, 1, 0.8, 0.5][s.luck] : 1));
    if (!e) break;
    s.seen[e.id] = s.age;
    c.apply(e.fx, "day", e.t);
  }
  // 희귀 이벤트
  if (c.chance(0.02 + (s.luck === 6 ? 0.015 : 0))) {
    const e = pickWeighted(c, DAILY.filter((x) => x.rare && eligible(c, x)));
    if (e) {
      s.seen[e.id] = s.age;
      c.apply(e.fx, "rare", e.t, { hl: true });
      c.add("dex_event_" + e.id);
    }
  }
}

export function sickness(c: Ctx) {
  const s = c.s;
  if (s.sick || s.age < 30) return null;
  const p = 0.0008 * (s.age - 28) * (s.stats.health < 40 ? 1.8 : s.stats.health > 70 ? 0.6 : 1);
  if (!c.chance(p)) return null;
  const list = DISEASES.filter((d) => s.age >= d.a);
  const d = c.pick(list);
  const early = c.has("checkup");
  s.sick = { id: d.id, name: d.name, sev: Math.max(1, d.sev - (early ? 1 : 0)), since: s.age };
  c.log("sick", early ? `건강검진 덕분에 ${josa(d.name, "을")} 일찍 발견했다.` : `몸이 이상해서 병원에 갔더니 ${josa(d.name, "이라고")} 한다.`, {
    d: c.stat({ happy: -4 }),
    hl: true,
  });
  return d;
}

const SUDDEN_ILL = ["급성 심근경색", "뇌출혈", "급성 대동맥 박리"];
const ACCIDENTS = ["교통사고", "등산 중 실족 사고", "출장길 사고", "빙판길 낙상 사고"];

export function deathCheck(c: Ctx): boolean {
  const s = c.s;
  const a = s.age;
  const h = s.stats.health;
  if (h <= 0) {
    // 건강이 바닥나서 떠남 — 60세 전이면 "노환"이 아니라 건강 악화로
    s.dead = { cause: (s.sick && s.sick.sev >= 2) || a < 60 ? "sick" : "old", age: a };
    return true;
  }
  const base = a < 40 ? 0.0004 : a < 50 ? 0.0012 : a < 60 ? 0.003 : a < 70 ? 0.007 : a < 80 ? 0.02 : a < 90 ? 0.065 : a < 100 ? 0.16 : 0.35;
  const mult = h >= 80 ? 0.4 : h >= 60 ? 0.6 : h >= 40 ? 1 : h >= 25 ? 1.7 : 3;
  const sickAdd = s.sick && s.sick.sev >= 3 ? (s.sick.sev - 2) * 0.03 : 0;
  if (c.chance(base * mult + sickAdd)) {
    if (s.sick && s.sick.sev >= 3) s.dead = { cause: "sick", age: a };
    else if (a >= 75) s.dead = { cause: "old", age: a };
    // 75세 전 갑작스러운 죽음은 "노환"이 아니라 구체적인 사인으로
    else if (c.chance(0.55)) s.dead = { cause: "sick", age: a, why: c.pick(SUDDEN_ILL) };
    else s.dead = { cause: "accident", age: a, why: c.pick(ACCIDENTS) };
    return true;
  }
  if (a >= 12 && a <= 80 && c.chance(0.0005)) {
    s.dead = { cause: "accident", age: a, why: c.pick(ACCIDENTS) };
    return true;
  }
  return false;
}
