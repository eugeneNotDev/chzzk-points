// 유진 키우기 엔진 — 한 해 동안 쓰는 작업대(상태 읽고 바꾸기·기록 남기기), 순자산.
import {
  STAT_KEYS, type Entry, type Kind, type Person, type Role, type Roll, type State, type StatKey, type Stats,
} from "../types.ts";
import { HOUSES, JOBS, NAMES } from "../content.ts";
import { josa } from "../josa.ts";
import { type Fx, type Text, jobTitle } from "./shapes.ts";
import { clamp, statMod, tierOf } from "./tools.ts";

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
    // 인지도로 오르는 직업(방송·창작)은 이미 쌓인 인지도에 맞는 등급에서 시작(다른 방송을 하다 옮긴 경우)
    if (j.creator && j.ranks && j.rankAt) j.rankAt.forEach((need, i) => { if (this.s.fame >= need) this.s.rank = i; });
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

export function houseOf(s: State) {
  return HOUSES.find((h) => h.id === s.house) ?? HOUSES[0];
}
