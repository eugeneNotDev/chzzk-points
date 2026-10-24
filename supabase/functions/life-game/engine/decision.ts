// 유진 키우기 엔진 — 갈림길·한 해 진행·선택·초점/투자 바꾸기·상점·방송 이력, 판 시작.
import {
  type Entry, type Fund, type HouseId, type Pending, type PendingOpt, type Roll, type State, type Stats,
} from "../types.ts";
import { FOCUSES, FORKS, ITEMS, JOBS, FUNDS, SHOWS } from "../content.ts";
import { Ctx, netWorth } from "./ctx.ts";
import { finish, newLife, pushHist } from "./life.ts";
import { type Fork, type Out, buyBlock, gearOf, jobTitle } from "./shapes.ts";
import { stageOf, statMod } from "./tools.ts";
import { armyYear, dailyEvents, deathCheck, drift, economy, eligible, focusYear, parents, pickWeighted, schoolLabel, sickness, syncRank } from "./year.ts";

// ── 결정(갈림길) ──
function optsOf(c: Ctx, f: Fork) {
  return f.make ? f.make(c) : f.opts;
}

export function makePending(c: Ctx, f: Fork): Pending {
  const opts: PendingOpt[] = [];
  optsOf(c, f).forEach((o, i) => {
    if (o.if && !o.if(c)) return;
    const cost = typeof o.cost === "function" ? o.cost(c) : o.cost ?? 0;
    const key = String.fromCharCode(65 + opts.length);
    const roll = o.out || o.judge ? o.roll ?? null : undefined;
    const p: PendingOpt = { key, i, text: c.fmt(o.t) };
    if (o.arg) p.arg = o.arg;
    if (o.pts) p.pts = o.pts;
    if (o.hint) p.hint = c.fmt(o.hint);
    if (cost > 0) p.cost = cost;
    if (roll !== undefined) {
      p.roll = roll;
      p.mod = (roll ? statMod(c.st(roll)) : 0) + (o.bonus ? o.bonus(c) : 0);
    }
    if (cost > 0 && c.s.cash + c.s.invest < cost) p.off = "돈이 모자라요";
    opts.push(p);
  });
  return { id: f.id, kind: f.kind ?? (f.mile ? "mile" : "fork"), tag: f.tag, text: c.fmt(f.t), opts };
}

function nextDecision(c: Ctx): Pending | null {
  const s = c.s;
  for (const f of FORKS) {
    if (!f.mile) continue;
    if (eligible(c, f)) {
      s.seen[f.id] = s.age;
      return makePending(c, f);
    }
  }
  const p = s.age < 3 ? 0 : s.age < 8 ? 0.4 : 0.6;
  if (!c.chance(p)) return null;
  const f = pickWeighted(c, FORKS.filter((x) => !x.mile && eligible(c, x)));
  if (!f) return null;
  s.seen[f.id] = s.age;
  const pend = makePending(c, f);
  return pend.opts.length ? pend : null;
}

// 한 해 굴리기. 결정이 생기거나 죽으면 멈춤
export function stepYear(c: Ctx) {
  const s = c.s;
  s.age++;
  s.luck = c.int(1, 6);
  schoolLabel(c);
  const inArmy = armyYear(c);
  if (!inArmy) focusYear(c);
  drift(c);
  economy(c);
  parents(c);
  if (!inArmy) dailyEvents(c);
  const d = sickness(c);
  c.del("checkup");
  if (deathCheck(c)) {
    pushHist(s);
    finish(c);
    return;
  }
  syncRank(c);
  if (d) {
    // 병이 생긴 해에는 치료 갈림길이 바로 뜸
    const f = FORKS.find((x) => x.id === "sick_treat")!;
    s.pending = makePending(c, f);
  } else if (!inArmy || s.army === 0) {
    s.pending = nextDecision(c);
  }
  pushHist(s);
}

export function advance(s: State, log: Entry[], maxYears: number, rng: () => number = Math.random) {
  const c = new Ctx(s, rng);
  let n = 0;
  while (!s.pending && !s.dead && n < maxYears) {
    stepYear(c);
    n++;
  }
  log.push(...c.out);
  return c.out;
}

// 결정 고르기 → 결과 기록(주사위 포함). 다음 해는 advance가 굴림
export function choose(s: State, log: Entry[], key: string, rng: () => number = Math.random): { error?: string; roll?: Roll; pts?: number } {
  if (!s.pending) return { error: "no_pending" };
  const c = new Ctx(s, rng);
  const p = s.pending;
  const po = p.opts.find((o) => o.key === key);
  if (!po) return { error: "bad_choice" };
  if (po.off) return { error: "cant_afford" };
  const f = FORKS.find((x) => x.id === p.id);
  if (!f) return { error: "bad_choice" };
  const list = optsOf(c, f);
  const o = po.arg ? list.find((x) => x.arg === po.arg) : list[po.i];
  if (!o) return { error: "bad_choice" };
  s.pending = null;
  c.log("pick", `${p.text} → ${po.text}`);
  if (po.pts) s.donated = (s.donated ?? 0) + po.pts;
  if (po.cost) {
    s.cash -= po.cost;
    if (s.cash < 0) {
      s.invest += s.cash;
      s.cash = 0;
      if (s.invest < 0) {
        s.debt += -s.invest;
        s.invest = 0;
      }
    }
  }
  let roll: Roll | undefined;
  let out: Out | undefined = o.res;
  if (o.judge) {
    roll = c.roll(o.roll ?? null, o.bonus ? o.bonus(c) : 0);
    out = o.judge(c, roll);
  } else if (o.out) {
    roll = c.roll(o.roll ?? null, o.bonus ? o.bonus(c) : 0);
    const t = roll.tier;
    out = o.out[t] ?? (t === "great" ? o.out.good : t === "terrible" ? o.out.bad : undefined) ?? (t === "normal" ? (roll.total >= 7 ? o.out.good : o.out.bad) : undefined) ?? o.out.normal ?? o.out.good;
  }
  if (out) {
    const e = c.apply(out.fx, out.k ?? "fork", out.t, { roll, hl: out.hl || roll?.tier === "great" || roll?.tier === "terrible" });
    if (e && po.cost) e.m = (e.m ?? 0) - po.cost;
  }
  if (p.kind === "think") s.thoughts.push({ age: s.age, q: p.text, a: po.text });
  syncRank(c);
  // 결정 직후 바로 이어지는 마디(예: 청혼 → 결혼식)
  if (!s.pending && !s.dead) {
    const next = FORKS.find((x) => x.now && x.id !== p.id && eligible(c, x));
    if (next) {
      s.seen[next.id] = s.age;
      s.pending = makePending(c, next);
    }
  }
  if (s.dead) finish(c);
  // 오늘 해의 능력치 줄 갱신
  const last = s.hist[s.hist.length - 1];
  if (last && last[0] === s.age) s.hist[s.hist.length - 1] = [s.age, s.stats.health, s.stats.intel, s.stats.charm, s.stats.happy, s.stats.talent, netWorth(s), s.luck];
  log.push(...c.out);
  return { roll, pts: po.pts };
}

export function setFocus(s: State, id: string) {
  const f = FOCUSES.find((x) => x.id === id && x.stage === stageOf(s.age + 1));
  const g = f ?? FOCUSES.find((x) => x.id === id && x.stage === stageOf(s.age));
  if (!g || (g.min && s.age + 1 < g.min)) return { error: "bad_focus" };
  s.focus = g.id;
  return {};
}

export function setFund(s: State, id: string) {
  if (!FUNDS.some((f) => f.id === id)) return { error: "bad_fund" };
  if (s.age < 15) return { error: "too_young" };
  s.fund = id as Fund;
  return {};
}

// 상점 — pay: "cash"면 게임 속 돈, "points"면 포인트(1만원 = 1P)
export function shopList(s: State) {
  const c = new Ctx(s);
  return ITEMS.filter((it) => s.age >= it.a[0] && s.age <= it.a[1] && (!it.if || it.if(c))).map((it) => {
    const tr = gearOf(s, it);
    const show = tr.next ?? tr.cur;
    const price = show ? show.price : typeof it.price === "function" ? it.price(c) : it.price;
    return {
      id: it.id, name: show ? show.name : it.name, cat: it.cat, price, hint: show ? show.hint : it.hint, child: !!it.child,
      lv: it.tiers ? tr.lv : null, maxLv: it.tiers ? it.tiers.length : null, cur: tr.cur?.name ?? null,
      off: buyBlock(s, it),
      cashOk: !it.child && s.age >= 15 && s.cash + s.invest >= price,
    };
  });
}

export function buy(s: State, log: Entry[], id: string, pay: "cash" | "points"): { error?: string; points?: number } {
  const c = new Ctx(s);
  const it = ITEMS.find((x) => x.id === id);
  if (!it || s.age < it.a[0] || s.age > it.a[1] || (it.if && !it.if(c))) return { error: "bad_item" };
  if (buyBlock(s, it)) return { error: "bought" };
  if (s.pending && s.pending.kind !== "fork" && s.pending.kind !== "mile") return { error: "bad_item" };
  const tr = gearOf(s, it);
  const price = tr.next ? tr.next.price : typeof it.price === "function" ? it.price(c) : it.price;
  if (pay === "cash") {
    if (it.child || s.age < 15) return { error: "points_only" };
    if (s.cash + s.invest < price) return { error: "cant_afford" };
    s.cash -= price;
    if (s.cash < 0) {
      s.invest += s.cash;
      s.cash = 0;
    }
  }
  if (it.once) c.add("own_" + it.id);
  s.seen["buy:" + it.id] = s.age;
  if (tr.next) s.seen["lv:" + it.id] = tr.lv + 1;
  const e = tr.next ? c.apply(tr.next.fx, "buy", tr.next.t) : c.apply(it.fx, "buy", it.t);
  if (e) {
    e.m = pay === "cash" ? -price : undefined;
    if (!e.m) delete e.m;
    if (pay === "points") e.t += ` (보호자가 ${price.toLocaleString("ko-KR")}P로 사줬다)`;
  }
  syncRank(c);
  // 상점에서 산 것 때문에 지금 결정의 선택지 상태(돈 부족 등)가 바뀔 수 있음
  if (s.pending) {
    const f = FORKS.find((x) => x.id === s.pending!.id);
    if (f) s.pending = { ...makePending(c, f), kind: s.pending.kind };
  }
  const last = s.hist[s.hist.length - 1];
  if (last && last[0] === s.age) s.hist[s.hist.length - 1] = [s.age, s.stats.health, s.stats.intel, s.stats.charm, s.stats.happy, s.stats.talent, netWorth(s), s.luck];
  log.push(...c.out);
  return { points: pay === "points" ? price : 0 };
}

function ladderOf(s: State) {
  const cur = JOBS.find((j) => j.id === s.job && j.creator && j.ranks && j.rankAt);
  const j = cur ?? JOBS.find((x) => x.id === "vtuber")!;
  const rank = cur ? s.rank ?? 0 : Math.max(0, ...s.jobs.filter((x) => x.id === "vtuber").map((x) => j.ranks!.indexOf(x.name)));
  return { ladder: j.ranks!.map((name, i) => ({ name, at: j.rankAt![i] })), rank };
}

// 버튜버를 한 번이라도 했으면 화면의 "방송" 카드에 보여줄 요약(아니면 null)
export function broadcastOf(s: State) {
  if (!s.jobs.some((j) => j.id === "vtuber")) return null;
  const f = s.flags;
  return {
    active: s.job === "vtuber",
    title: s.job === "vtuber" ? jobTitle(s) : [...s.jobs].reverse().find((j) => j.id === "vtuber")?.name ?? "버튜버",
    concept: f.includes("vt_wolf") ? "늑대 컨셉" : f.includes("vt_team") ? "팀 데뷔" : f.includes("vt_plain") ? "나답게" : null,
    show: SHOWS.find((x) => x.id === s.show)?.name ?? null,
    nick: [f.includes("baji") ? "바지 알파" : null, f.includes("yuneung_real") ? "유능 알파" : f.includes("yuneung_mock") ? "무능 알파" : null].filter((x): x is string => !!x),
    fame: s.fame,
    fandom: f.includes("yangs") ? "네루" : null,
    million: f.includes("gold_button"),
    donated: s.donated ?? 0,
    graduated: f.includes("vt_graduated"),
    now: f.includes("vt_convert") ? jobTitle(s) : null, // 전향했으면 지금 하는 방송
    // 등급 사다리(지금 방송 직업 기준: 버튜버, 전향했으면 그 직업) — 인지도가 rankAt을 넘으면 오름
    ...ladderOf(s),
  };
}

// 처음 출발할 때 2세 기질 마디까지 바로 진행
export function startRun(house: HouseId, bonus: Partial<Stats>, rng: () => number = Math.random) {
  const { s, log } = newLife(house, bonus, rng);
  advance(s, log, 5, rng);
  return { s, log };
}
