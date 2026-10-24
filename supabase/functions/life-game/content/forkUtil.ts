// 유진 키우기 갈림길 공용 — 초점 선택지·학비·직업 선택지·만남 등.
import { josa } from "../josa.ts";
import type { Ctx, Fork, Fx, Job, Opt } from "../engine.ts";
import { STAT_LABEL } from "../types.ts";
import { R, fx, passP, pick } from "./util.ts";
import { FOCUSES, HOUSES, JOBS } from "./world.ts";

// ── 갈림길(보호자의 선택) ──
// 순서 = 같은 해에 마디가 겹칠 때의 우선순위
export const think = (id: string, age: number, q: string, a: [string, string, string]): Fork => ({
  id, a: [age, age + 2], mile: true, kind: "think", tag: "생각 남기기", t: q,
  opts: a.map((x) => pick(x, R("유진은 그렇게 생각하기로 했다.", fx({ happy: 1 })))),
});
export const focusOpts = (stage: number): Opt[] => FOCUSES.filter((f) => f.stage === stage && !f.min).map((f) =>
  pick(f.name, R(`'${f.name}' 위주로 지내기로 했다.`, { fn: (c) => (c.s.focus = f.id) }), { hint: f.hint })
);
export const tuitionOf = (c: Ctx) => HOUSES.find((h) => h.id === c.s.house)?.tuition ?? 0;
// 늦깎이 루트 주사위 보정: 자기계발 집중·자격증
export const lateBonus = (c: Ctx) => (c.s.focus === "selfdev" ? 1 : 0) + (c.has("cert") ? 1 : 0);
// "회사원이었단다" / "의사였단다"
export const wasJob = (name: string) => { const ch = name.charCodeAt(name.length - 1); const has = ch >= 0xac00 && ch <= 0xd7a3 && (ch - 0xac00) % 28 !== 0; return name + (has ? "이었단다" : "였단다"); };
export const tuitionFx = (edu: "local" | "inseoul" | "top", years = 4, med = false): Fx => ({
  fn: (c) => {
    const h = HOUSES.find((x) => x.id === c.s.house)!;
    const total = (med ? 1500 : 800) * years;
    const loan = Math.round(total * (1 - h.tuition));
    if (loan > 0) c.s.debt += loan;
    c.s.edu = edu;
    c.add("in_college", "college");
    if (med) c.add("med");
    c.s.until = c.age + years;
    c.s.school = med ? "의대생" : "대학생";
  },
});
export const meetPartner = (bond = 50): Fx => ({ fn: (c) => { if (!c.partner()) c.meet("partner", bond); } });
// 같은 상태면 늘 같은 값이 나오는 난수(결정을 띄울 때와 고를 때 선택지가 똑같아야 해서 Math.random을 못 씀)
const stateSeed = (c: Ctx) => {
  let h = (c.age * 2654435761 + c.s.pid * 40503 + c.s.jobs.length * 9176 + c.s.house.length * 131) >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
export const jobOpts = (c: Ctx): Opt[] => {
  const list = JOBS.filter((j) => j.dc > 0 && j.id !== "alba" && j.req(c));
  const need = (j: Job) => j.dc - Math.max(-3, Math.min(5, Math.round((c.st(j.roll) - 50) / 10)));
  // 붙을 직업 2개: 붙을 확률 × 연봉이 큰 순
  const safe = list.map((j) => ({ j, ev: passP(need(j)) * (j.creator ? 2500 : j.pay) }))
    .sort((a, b) => b.ev - a.ev).slice(0, 2).map((x) => x.j);
  // 도전할 직업 2개: 하나는 남은 것 중 합격선이 제일 높은 것(변호사·교수·아이돌 같은 길이 꼭 보이게),
  // 하나는 나머지 중 해마다 다르게 하나
  const rnd = stateSeed(c);
  const rest = list.filter((j) => !safe.includes(j)).map((j) => ({ j, r: rnd() })).sort((a, b) => b.j.dc - a.j.dc || a.r - b.r);
  const challenge = rest.slice(0, 1).concat(rest.slice(1).sort((a, b) => a.r - b.r).slice(0, 1)).map((x) => x.j);
  const scored = [...safe.map((j) => ({ j, tag: "붙을 만해요" })), ...challenge.map((j) => ({ j, tag: "도전" }))];
  // 버튜버는 이 게임의 상징이라 조건만 되면 늘 선택지에 넣음
  const vt = list.find((j) => j.id === "vtuber");
  if (vt && !scored.some((x) => x.j === vt)) scored.push({ j: vt, tag: "도전" });
  const bonus = (cc: Ctx) => (cc.has("cert") ? 1 : 0) + (cc.s.focus === "selfdev" ? 1 : 0);
  const opts: Opt[] = scored.map(({ j, tag }) => ({
    t: tag === "도전" ? `${j.name}에 도전` : `${j.name}에 지원`,
    arg: j.id,
    roll: j.roll,
    bonus,
    hint: `${tag} · ${STAT_LABEL[j.roll]} 주사위 · ${j.dc} 이상 합격`,
    judge: (cc: Ctx, r) => r.total >= j.dc
      ? R(`${josa(j.name, "로")} 일하게 됐다!`, { s: { happy: 4 }, fn: (x) => { x.hire(j.id, r.tier === "great" ? 1.15 : 1); if (j.creator) x.s.fame = Math.max(x.s.fame, 3); } }, true)
      : R(`${j.name} 도전은 실패했다. 다음 기회를 노리기로 했다.`, { s: { happy: -3 }, fn: (x) => { x.quit("취준생"); x.add("jobless"); } }),
  }));
  opts.push(pick("일단 알바부터 한다", R("편의점 야간 알바를 시작했다.", { fn: (x) => x.hire("alba") }), { arg: "alba", hint: "확실하지만 월급이 적어요" }));
  opts.push(pick("올해는 쉰다", R("올해는 숨 좀 돌리기로 했다.", { s: { happy: 2 }, fn: (x) => x.quit("백수") }), { arg: "rest", hint: "행복 ↑" }));
  return opts;
};
