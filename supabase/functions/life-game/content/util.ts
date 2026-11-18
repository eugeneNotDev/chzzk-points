// 우진 키우기 콘텐츠 공용 도구 — 효과·문구 짧게 쓰기, 조건 확인, 버튜버 루트·확률 계산 등.
import type { Ctx, Fx, Opt, Out, Text } from "../engine.ts";
import { josa } from "../josa.ts";
import { STAT_LABEL, type Person, type Stats, type StatKey, type Tier } from "../types.ts";
import { JOBS } from "./world.ts";

// ── 짧게 쓰기 위한 도구 ──
export const fx = (s: Partial<Stats> = {}, m?: number, more: Partial<Fx> = {}): Fx => ({ s, m, ...more });
export const R = (t: Text, f?: Fx, hl?: boolean): Out => ({ t, fx: f, hl });
export const pick = (t: Text, res: Out, more: Partial<Opt> = {}): Opt => ({ t, res, ...more });
export const dice = (t: Text, stat: StatKey | null, out: Partial<Record<Tier, Out>>, more: Partial<Opt> = {}): Opt => ({
  t, roll: stat, out, hint: more.hint ?? (stat ? `${STAT_LABEL[stat]} 주사위` : "운 주사위"), ...more,
});
export const single = (c: Ctx) => !c.partner();
export const parentOld = (c: Ctx, min: number) => [...c.folks("mom"), ...c.folks("dad")].some((p) => c.age - p.born >= min);
export const anyParent = (c: Ctx) => !!(c.person("mom") || c.person("dad"));
export const salaried = (c: Ctx) => {
  const j = JOBS.find((x) => x.id === c.s.job);
  return !!j && !j.creator && !j.biz;
};
export const creatorJob = (c: Ctx) => !!JOBS.find((x) => x.id === c.s.job)?.creator;

// ── 버튜버 루트(스트리머 유진 알파 팬게임 요소) ──
export const vtJob = (c: Ctx) => c.s.job === "vtuber";
// 팬 이름(네루)을 정하기 전엔 그냥 "시청자"
export const neru = (c: Ctx) => (c.has("yangs") ? "네루" : "시청자");
export const fameUp = (n: number) => (c: Ctx) => { c.s.fame = Math.max(0, Math.min(100, c.s.fame + n)); };
// 실제 유진 생일(11월 22일, 한국 시간)에 플레이하면 열리는 이벤트용
export const isBirthday = () => { const d = new Date(Date.now() + 9 * 3600 * 1000); return d.getUTCMonth() === 10 && d.getUTCDate() === 22; };
// 포인트 후원 선택지(100/300/500P) — 차감은 서버가 함. 돌려받는 건 없음
export const dono = (pts: number, res: Out, hint?: string): Opt => ({ t: `${pts}P 후원하기`, pts, res, hint: hint ?? "포인트 후원" });

export const bizJob = (c: Ctx) => !!JOBS.find((x) => x.id === c.s.job)?.biz;
export const inCollege = (c: Ctx) => c.has("in_college");
export const homePrice = (c: Ctx) => Math.round(45000 * Math.pow(1.025, Math.max(0, c.age - 30)) / 100) * 100;
export const kidsAt = (c: Ctx, a: number, b: number) => c.folks("child").filter((k) => c.age - k.born >= a && c.age - k.born <= b);
// 그 나이대 아이 중 막내의 이름({c}는 그냥 막내라서, 나이 조건이 있는 글에는 이걸 씀)
export const kidName = (c: Ctx, a: number, b: number) => kidsAt(c, a, b).slice(-1)[0]?.name ?? "아이";
// 회사·기관에 다니는 직장인(상사·회식·승진 심사·성과급이 있는 일) — 알바·배달·프리랜서·농부·회장·운동선수는 뺌
const NOT_EMPLOYEE = ["alba", "delivery", "illustrator", "voice", "farmer", "ceo", "athlete"];
export const employee = (c: Ctx) => salaried(c) && !NOT_EMPLOYEE.includes(c.s.job ?? "");
// 지금 직업에서 가장 높은 등급(임원·교장 선생님 등)인지
export const topRank = (c: Ctx) => { const j = JOBS.find((x) => x.id === c.s.job); return !!j?.ranks && (c.s.rank ?? 0) >= j.ranks.length - 1; };
// 라이브 방송으로 활동하는 직업(작가·가수·아이돌은 방송인이 아님)
export const streamJob = (c: Ctx) => ["vtuber", "streamer", "youtuber"].includes(c.s.job ?? "");
// 학교에 다니는 중(자퇴 안 한 18세 이하 또는 대학생)
export const student = (c: Ctx) => (c.age <= 18 && !c.has("dropout")) || inCollege(c);
// 떠나보낸(헤어진·세상을 떠난) 사람 — 효과(fn)가 글보다 먼저 돌아서 떠난 뒤엔 {p}·{f}로 이름을 못 찾으므로 이름을 잠깐 기억해 둠
let goneName = "";
export const farewell = (c: Ctx, p: Person | undefined, die = false) => { if (!p) return; goneName = p.name; if (die) p.alive = false; else c.drop(p); };
export const gone = (j: string) => josa(goneName, j);
// 살아 계신 부모님 부르는 말
export const parentsWord = (c: Ctx) => (c.person("mom") && c.person("dad") ? "엄마 아빠" : c.person("mom") ? "엄마" : "아빠");

// 주사위 두 개 합이 n 이상일 확률
export function passP(n: number) {
  let k = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b >= n) k++;
  return k / 36;
}
export function wed(bond: number) {
  return (c: Ctx) => {
    const p = c.person("partner");
    if (p) {
      p.role = "spouse";
      p.since = c.age;
      c.bond(p, bond);
    }
    c.del("engaged");
    c.add("married");
  };
}
export function retireFn(c: Ctx) {
  if (c.age < 50) {
    // 운동선수·아이돌처럼 일찍 그만두는 직업은 새 일을 찾음
    c.quit("새 출발 준비 중");
    c.add("early_retired");
    return;
  }
  if (c.s.job === "civil" || c.s.job === "teacher") c.add("pension_civil");
  c.quit("은퇴");
  c.add("retired");
}
export function statModOf(c: Ctx, k: StatKey) {
  return Math.max(-3, Math.min(5, Math.round((c.st(k) - 50) / 10)));
}
