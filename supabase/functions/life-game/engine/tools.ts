// 유진 키우기 엔진 — 작은 도구(돈 표시, 나이 단계, 능력치 보정, 주사위 등급).
import { type Tier } from "../types.ts";

// ── 작은 도구 ──

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
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

export function tierOf(dice: [number, number], total: number): Tier {
  if (dice[0] + dice[1] === 12 || total >= 13) return "great";
  if (dice[0] + dice[1] === 2 || total <= 2) return "terrible";
  if (total >= 9) return "good";
  if (total >= 6) return "normal";
  return "bad";
}
