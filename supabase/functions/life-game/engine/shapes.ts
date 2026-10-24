// 유진 키우기 엔진 — 콘텐츠 모양(타입)과 직업 이름·장비 같은 작은 해석.
import {
  type HouseId, type Kind, type Pending, type Roll, type State, type StatKey, type Stats, type Tier,
} from "../types.ts";
import { JOBS } from "../content.ts";
import type { Ctx } from "./ctx.ts";

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
export function gearOf(s: State, it: Item) {
  const lv = s.seen["lv:" + it.id] ?? 0;
  return { lv, next: it.tiers ? it.tiers[lv] ?? null : null, cur: it.tiers && lv > 0 ? it.tiers[lv - 1] : null };
}

export function buyBlock(s: State, it: Item): string | null {
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
