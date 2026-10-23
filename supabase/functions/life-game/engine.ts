// 유진 키우기 v3 엔진 — 한 해씩 인생을 굴림. Deno/Node 어디서나 돌도록 외부 의존 없음(시뮬레이션 스크립트도 이걸 그대로 씀).
// 콘텐츠(이벤트·갈림길·직업·상점·엔딩)는 content.ts. 돈은 전부 만원 단위.
import {
  STAT_KEYS, STAT_LABEL, badDebt,
  type Entry, type Ending, type Fund, type HouseId, type Kind, type Pending, type PendingOpt, type Person, type Role, type Roll,
  type State, type StatKey, type Stats, type Tier,
} from "./types.ts";
import {
  DAILY, DISEASES, FOCUSES, FORKS, HOUSES, ITEMS, JOBS, MODS, NAMES, SPECIALS, FUNDS, SHOWS,
} from "./content.ts";
import { josa } from "./josa.ts";
export { josa };

// ── 콘텐츠 모양 ──
export type Text = string | ((c: Ctx) => string);
export type Fx = { s?: Partial<Stats>; m?: number; add?: string[]; del?: string[]; fn?: (c: Ctx) => void };
export type Out = { t: Text; fx?: Fx; hl?: boolean; k?: Kind };
export type Opt = {
  t: Text;
  hint?: Text;
  if?: (c: Ctx) => boolean;
  cost?: number | ((c: Ctx) => number);
  roll?: StatKey | null; // null이면 능력치 보정 없는 순수 운
  bonus?: (c: Ctx) => number;
  res?: Out; // 주사위 없는 결과
  out?: Partial<Record<Tier, Out>>; // 주사위 결과
  judge?: (c: Ctx, r: Roll) => Out; // 주사위 합으로 직접 판정(취업 등)
  arg?: string; // 동적으로 만든 선택지 구분값
  pts?: number; // 포인트 후원 금액(P) — 실제 차감은 서버(index.ts → life_donate)가 함
};
export type Fork = {
  id: string;
  a: [number, number];
  t: Text;
  opts: Opt[];
  w?: number;
  if?: (c: Ctx) => boolean;
  rep?: number; // 다시 나올 수 있는 최소 간격(년). 없으면 한 번만
  mile?: boolean; // 조건이 맞으면 반드시 멈추는 인생 마디
  tag?: string; // 화면에 보일 꼬리표(예: "인생 마디", "연애")
  kind?: Pending["kind"];
  now?: boolean; // 다른 결정 바로 뒤에 이어서 뜨는 마디(청혼 → 결혼식)
  make?: (c: Ctx) => Opt[]; // 선택지를 상황에 따라 만들 때(취업)
};
export type Daily = {
  id: string;
  a: [number, number];
  t: Text;
  fx?: Fx;
  w?: number;
  if?: (c: Ctx) => boolean;
  rep?: number;
  tone?: 1 | -1 | 0;
  rare?: boolean;
  hint?: string;
};
export type Focus = { id: string; name: string; stage: number; min?: number; s: Partial<Stats>; side?: Partial<Stats>; hint: string; money?: number };
export type Job = {
  id: string;
  name: string;
  cat: string;
  hint: string;
  req: (c: Ctx) => boolean;
  roll: StatKey;
  dc: number; // 주사위 합이 이 이상이면 합격
  pay: number; // 첫 연봉(만원)
  growth?: number;
  cap?: number;
  creator?: number; // 인지도로 버는 직업이면 배율
  biz?: boolean; // 가게(경기)로 버는 직업
  retire?: number; // 이 나이 즈음 자연스럽게 그만둠
  fy?: Partial<Stats>; // 일하는 동안 해마다 조금씩
  ranks?: string[]; // 같은 직업 안의 등급 이름(하꼬 버튜버 → 대형 버튜버 …)
  rankAt?: number[]; // 인지도(방송)·경기(가게)로 오르는 직업이면 등급마다 필요한 값
};

// 지금 직업의 등급 이름(등급이 없으면 직업 이름)
export function jobTitle(s: State): string | null {
  const j = JOBS.find((x) => x.id === s.job);
  if (!j) return null;
  return j.ranks ? j.ranks[Math.min(s.rank ?? 0, j.ranks.length - 1)] : j.name;
}
export type Item = {
  id: string;
  name: string;
  cat: string;
  a: [number, number];
  price: number | ((c: Ctx) => number);
  t: Text;
  fx?: Fx;
  hint: string;
  if?: (c: Ctx) => boolean;
  once?: boolean;
  cool?: number; // 다시 살 수 있을 때까지 걸리는 해(기본 1 = 한 해에 한 번)
  tiers?: { name: string; price: number; t: string; fx?: Fx; hint: string }[]; // 업그레이드식 장비
  child?: boolean; // 15세 전 보호자 지원(포인트로만)
};

// 상점 물건을 지금 살 수 없는 이유(이미 있음 / 쿨타임)
function gearOf(s: State, it: Item) {
  const lv = s.seen["lv:" + it.id] ?? 0;
  return { lv, next: it.tiers ? it.tiers[lv] ?? null : null, cur: it.tiers && lv > 0 ? it.tiers[lv - 1] : null };
}

function buyBlock(s: State, it: Item): string | null {
  if (it.tiers && !gearOf(s, it).next) return "최고 등급이에요";
  if (it.once && s.flags.includes("own_" + it.id)) return "이미 있어요";
  const last = s.seen["buy:" + it.id];
  const cool = it.cool ?? 1;
  if (last !== undefined && s.age - last < cool) {
    const left = cool - (s.age - last);
    return cool === 1 ? "올해는 이미 샀어요" : `${left}년 뒤에 다시 살 수 있어요`;
  }
  return null;
}
export type House = {
  id: HouseId;
  name: string;
  allowance: number; // 8~19세 해마다 용돈
  tuition: number; // 대학 등록금 부모 부담 비율 0~1
  support: number; // 독립할 때 부모 지원금
  inherit: number; // 유산 기준
  momBond: number;
};
export type Mod = { id: string; text: string; hint: string; pr: number; if: (c: Ctx) => boolean };
export type Special = { id: string; title: string; text: string; hint: string; pr: number; if: (c: Ctx) => boolean };
export type Disease = { id: string; name: string; sev: number; cost: number; a: number };
// 버튜버 주력 컨텐츠 — 해마다 인지도 주사위를 어떤 능력치로 굴리고, 대성공·대실패 때 무슨 일이 생기는지
export type Show = {
  id: string; name: string; hint: string; stat: StatKey; bonus?: number; dF?: Record<Tier, number>;
  great?: string; greatFx?: Fx; bad?: string; badFx?: Fx;
};

// ── 작은 도구 ──

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const fmtMoney = (m: number) => {
  const neg = m < 0;
  const v = Math.abs(Math.round(m));
  const eok = Math.floor(v / 10000);
  const man = v % 10000;
  const s = eok > 0 ? `${eok.toLocaleString("ko-KR")}억${man ? ` ${man.toLocaleString("ko-KR")}만` : ""}원` : `${man.toLocaleString("ko-KR")}만원`;
  return (neg ? "-" : "") + s;
};

export function stageOf(age: number) {
  if (age < 8) return 0;
  if (age < 19) return 1;
  if (age < 65) return 2;
  return 3;
}

export function statMod(v: number) {
  return clamp(Math.round((v - 50) / 10), -3, 5);
}

function tierOf(dice: [number, number], total: number): Tier {
  if (dice[0] + dice[1] === 12 || total >= 13) return "great";
  if (dice[0] + dice[1] === 2 || total <= 2) return "terrible";
  if (total >= 9) return "good";
  if (total >= 6) return "normal";
  return "bad";
}

// ── 한 해 동안 쓰는 작업대 ──
export class Ctx {
  s: State;
  out: Entry[] = [];
  rng: () => number;
  constructor(s: State, rng: () => number = Math.random) {
    this.s = s;
    this.rng = rng;
  }
  rnd() {
    return this.rng();
  }
  chance(p: number) {
    return this.rng() < p;
  }
  int(a: number, b: number) {
    return a + Math.floor(this.rng() * (b - a + 1));
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.rng() * arr.length)];
  }
  get age() {
    return this.s.age;
  }
  st(k: StatKey) {
    return this.s.stats[k];
  }
  has(f: string) {
    return this.s.flags.includes(f);
  }
  add(...f: string[]) {
    for (const x of f) if (!this.s.flags.includes(x)) this.s.flags.push(x);
  }
  del(...f: string[]) {
    this.s.flags = this.s.flags.filter((x) => !f.includes(x));
  }
  stat(d: Partial<Stats>): Partial<Stats> {
    const got: Partial<Stats> = {};
    for (const k of STAT_KEYS) {
      let v = d[k];
      if (!v) continue;
      const before = this.s.stats[k];
      // 이미 높으면 덜 오름
      if (v > 0 && before >= 75) v = Math.max(1, Math.round(v * (before >= 88 ? 0.35 : 0.6)));
      this.s.stats[k] = clamp(before + v, 0, 100);
      const real = this.s.stats[k] - before;
      if (real) got[k] = real;
    }
    return got;
  }
  money(n: number) {
    this.s.cash += Math.round(n);
  }
  net() {
    return netWorth(this.s);
  }
  // 사람
  person(role: Role): Person | undefined {
    return this.s.people.find((p) => p.role === role && p.alive);
  }
  folks(role: Role) {
    return this.s.people.filter((p) => p.role === role && p.alive);
  }
  partner() {
    return this.person("spouse") ?? this.person("partner");
  }
  meet(role: Role, bond = 50, name?: string): Person {
    const used = new Set(this.s.people.map((p) => p.name));
    const pool = role === "partner" || role === "spouse" ? NAMES.partner : role === "child" ? NAMES.child : role === "pet" ? NAMES.pet : NAMES.friend;
    const free = pool.filter((n) => !used.has(n));
    const p: Person = {
      id: ++this.s.pid,
      role,
      name: name ?? (free.length ? this.pick(free) : this.pick(pool)),
      born: role === "child" || role === "pet" ? this.s.age : this.int(-3, 3), // 친구·연인은 유진과 비슷한 나이
      bond: clamp(bond, 0, 100),
      alive: true,
      since: this.s.age,
    };
    this.s.people.push(p);
    return p;
  }
  drop(p: Person | undefined) {
    if (!p) return;
    this.s.people = this.s.people.filter((x) => x.id !== p.id);
  }
  bond(p: Person | undefined, n: number) {
    if (p) p.bond = clamp(p.bond + n, 0, 100);
  }
  // 일
  hire(id: string, payMul = 1) {
    const j = JOBS.find((x) => x.id === id);
    if (!j) return;
    this.s.job = j.id;
    this.s.jobSince = this.s.age;
    this.s.salary = Math.round(j.pay * payMul);
    this.s.rank = 0;
    this.s.rankSince = this.s.age;
    const title = jobTitle(this.s) ?? j.name;
    this.s.school = title;
    this.s.jobs.push({ id: j.id, name: title, age: this.s.age });
    this.add("worked");
    this.del("jobless");
  }
  quit(label = "무직") {
    this.s.job = null;
    this.s.salary = 0;
    this.s.school = label;
  }
  // 등급 올리기(월급쟁이는 월급도 오름). 올랐으면 새 등급 이름을 돌려줌
  promote(n = 1, why: "promo" | "fame" | "biz" = "promo"): string | null {
    const j = JOBS.find((x) => x.id === this.s.job);
    if (!j?.ranks) return null;
    const before = this.s.rank ?? 0;
    const after = Math.min(j.ranks.length - 1, before + n);
    if (after <= before) return null;
    this.s.rank = after;
    this.s.rankSince = this.s.age;
    if (why === "promo") this.s.salary = Math.round(this.s.salary * Math.pow(1.12, after - before));
    const title = j.ranks[after];
    this.s.school = title;
    this.s.jobs.push({ id: j.id, name: title, age: this.s.age });
    const msg = why === "fame"
      ? `인기가 오르면서 어엿한 ${josa(title, "가")} 됐다!`
      : why === "biz"
      ? `가게가 커져서 이제 ${josa(title, "라고")} 불린다!`
      : `승진했다! 이제 ${josa(title, "이다")}.`;
    this.log("job", msg, { hl: true, d: this.stat({ happy: 4 }) });
    return title;
  }
  jobName() {
    return jobTitle(this.s);
  }
  // 글 안의 {p} {f} {c} {mom} {dad} {pet} {job} 바꾸기
  fmt(t: Text): string {
    const raw = typeof t === "function" ? t(this) : t;
    const names: Record<string, string> = {
      p: this.partner()?.name ?? "연인",
      f: this.person("friend")?.name ?? "친구",
      c: this.folks("child").slice(-1)[0]?.name ?? "아이",
      c1: this.folks("child")[0]?.name ?? "아이",
      pet: this.person("pet")?.name ?? "강아지",
      job: this.jobName() ?? "일",
      mom: "엄마",
      dad: "아빠",
    };
    // {p}와 → "서연과"/"지우와"처럼 이름 받침에 맞춰 조사를 바꿈
    return raw.replace(/\{(p|f|c1|c|pet|job|mom|dad)\}(이라고|라고|이랑|으로|와|과|이|가|은|는|을|를|랑|로|아|야)?/g, (_, k: string, j?: string) =>
      j ? josa(names[k], j) : names[k]
    );
  }
  log(k: Kind, t: Text, extra: Partial<Entry> = {}) {
    const e: Entry = { age: this.s.age, k, t: this.fmt(t), ...extra };
    if (e.d && Object.keys(e.d).length === 0) delete e.d;
    if (!e.m) delete e.m;
    this.out.push(e);
    return e;
  }
  // 효과 적용 + 기록. 함수 효과를 먼저 돌려야 이름({p})이 맞게 들어감
  apply(fx: Fx | undefined, k: Kind, t: Text | null, extra: Partial<Entry> = {}) {
    const cashBefore = this.s.cash;
    let d: Partial<Stats> = {};
    if (fx?.fn) fx.fn(this);
    if (fx?.s) d = this.stat(fx.s);
    if (fx?.m) this.money(fx.m);
    if (fx?.add) this.add(...fx.add);
    if (fx?.del) this.del(...fx.del);
    const m = this.s.cash - cashBefore;
    if (t === null) return null;
    return this.log(k, t, { d, m, ...extra });
  }
  roll(stat: StatKey | null, bonus = 0): Roll {
    const dice: [number, number] = [this.int(1, 6), this.int(1, 6)];
    const mod = (stat ? statMod(this.st(stat)) : 0) + bonus;
    const total = dice[0] + dice[1] + mod;
    return { dice, mod, total, tier: tierOf(dice, total), stat };
  }
}

export function netWorth(s: State) {
  return s.cash + s.invest + s.assets.reduce((a, x) => a + x.value, 0) - s.debt;
}

function houseOf(s: State) {
  return HOUSES.find((h) => h.id === s.house) ?? HOUSES[0];
}

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

function pushHist(s: State) {
  const st = s.stats;
  s.hist.push([s.age, st.health, st.intel, st.charm, st.happy, st.talent, netWorth(s), s.luck]);
}

// ── 한 해 ──
function focusYear(c: Ctx) {
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

function drift(c: Ctx) {
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

function economy(c: Ctx) {
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

function parents(c: Ctx) {
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
function schoolLabel(c: Ctx) {
  const s = c.s;
  if (s.job || s.army > 0) return;
  if (s.age === 3) s.school = "유치원생";
  if (s.age === 8) s.school = "초등학생";
  if (s.age === 14) s.school = "중학생";
}

function armyYear(c: Ctx) {
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

function pickWeighted<T extends { w?: number }>(c: Ctx, list: T[], weight: (x: T) => number = (x) => x.w ?? 10): T | null {
  const tot = list.reduce((a, x) => a + Math.max(0, weight(x)), 0);
  if (tot <= 0) return null;
  let r = c.rnd() * tot;
  for (const x of list) {
    r -= Math.max(0, weight(x));
    if (r <= 0) return x;
  }
  return list[list.length - 1];
}

function eligible(c: Ctx, e: { id: string; a: [number, number]; if?: (c: Ctx) => boolean; rep?: number }) {
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

function dailyEvents(c: Ctx) {
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

function sickness(c: Ctx) {
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

function deathCheck(c: Ctx): boolean {
  const s = c.s;
  const a = s.age;
  const h = s.stats.health;
  if (h <= 0) {
    // 건강이 바닥나서 떠남 — 60세 전이면 "노환"이 아니라 건강 악화로
    s.dead = { cause: (s.sick && s.sick.sev >= 2) || a < 60 ? "sick" : "old", age: a };
    return true;
  }
  const base = a < 40 ? 0.0004 : a < 50 ? 0.0012 : a < 60 ? 0.003 : a < 70 ? 0.007 : a < 80 ? 0.02 : a < 90 ? 0.065 : a < 100 ? 0.16 : 0.35;
  const mult = h >= 60 ? 0.6 : h >= 40 ? 1 : h >= 25 ? 1.7 : 3;
  const sickAdd = s.sick && s.sick.sev >= 3 ? (s.sick.sev - 2) * 0.03 : 0;
  if (c.chance(base * mult + sickAdd)) {
    s.dead = { cause: s.sick && s.sick.sev >= 3 ? "sick" : a < 60 ? "accident" : "old", age: a };
    return true;
  }
  if (a >= 12 && a <= 80 && c.chance(0.0005)) {
    s.dead = { cause: "accident", age: a };
    return true;
  }
  return false;
}

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

// ── 끝 ──
function finish(c: Ctx) {
  const s = c.s;
  if (!s.dead) return;
  s.pending = null;
  const a = s.dead.age;
  const causeText = s.dead.cause === "accident"
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
  const how = s.dead.cause === "accident" ? `${a}세, 갑작스러운 사고로 생을 마감했다.` : s.dead.cause === "sick" ? `${a}세, ${josa(causeText, "로")} 생을 마감했다.` : `${a}세, 편안히 눈을 감았다.`;
  c.log("end", how, { hl: true });
  c.log("end", `장례식에 ${mourners.toLocaleString("ko-KR")}명이 찾아왔다.${fans > 50 ? " 네루들이 보낸 꽃이 복도를 가득 채웠다." : ""}`);
}

// 처음 출발할 때 2세 기질 마디까지 바로 진행
export function startRun(house: HouseId, bonus: Partial<Stats>, rng: () => number = Math.random) {
  const { s, log } = newLife(house, bonus, rng);
  advance(s, log, 5, rng);
  return { s, log };
}

export { STAT_LABEL };
