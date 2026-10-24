// 유진 키우기 진행 화면 — 속도·결과 표시 시간 같은 상수와 기록 줄에 붙는 작은 표시(변화량·주사위·아이콘).
import {
  Baby, Briefcase, Coins, Dog, Flower2, GitFork, GraduationCap, Heart, MessageCircle, ShoppingBag, Sparkles, Sprout, Star, Stethoscope,
  UserRound, Users, type LucideIcon,
} from "lucide-react";
import { STATS, TIER_LABEL, won, type LogEntry, type PendingOpt, type Person, type Roll, type Stats } from "../../lib/life";
import styles from "./Life.module.css";
import { Die } from "./parts";

/* ── 진행 ── */
// 한 해를 보여주는 시간(1배속). 평균 수명(약 77세)·결정 50번 기준으로 한 인생이 30분쯤 걸리게 맞춤.
// 그해 기록은 앞쪽 70% 동안 고르게 나눠서 하나씩 보여주고, 나머지 시간은 머묾. 배속으로 나눔. "skip"은 다음 결정까지 빨리 감기
export const YEAR_MS = 13000;
export const SPEEDS = [
  { k: 1, label: "1x", hint: "한 인생 약 30분" },
  { k: 2, label: "2x", hint: "약 15분" },
  { k: 4, label: "4x", hint: "약 8분" },
  { k: 8, label: "8x", hint: "약 4분" },
];
export const RESULT_MS = 7000; // 선택 결과를 보여주고 저절로 넘어가기까지

const KIND_ICON: Record<LogEntry["k"], LucideIcon> = {
  life: Sprout, day: Sparkles, rare: Star, fork: GitFork, pick: GitFork, job: Briefcase, money: Coins, people: Users, buy: ShoppingBag,
  think: MessageCircle, sick: Stethoscope, end: Flower2, school: GraduationCap,
};
export const ROLE_LABEL: Record<Person["role"], string> = { mom: "엄마", dad: "아빠", friend: "친구", partner: "연인", spouse: "배우자", child: "자녀", pet: "반려견" };
export const ROLE_ICON: Record<Person["role"], LucideIcon> = { mom: UserRound, dad: UserRound, friend: Users, partner: Heart, spouse: Heart, child: Baby, pet: Dog };

export function DeltaChips({ d, m }: { d?: Partial<Stats>; m?: number }) {
  const list = d ? STATS.filter((s) => typeof d[s.key] === "number" && d[s.key] !== 0) : [];
  if (list.length === 0 && !m) return null;
  return (
    <span className={styles.dchips}>
      {list.map((s) => {
        const v = d![s.key]!;
        return (
          <span key={s.key} className={`${styles.dchip} ${v > 0 ? styles.dUp : styles.dDown}`}>
            {s.label} {v > 0 ? `+${v}` : `−${Math.abs(v)}`}
          </span>
        );
      })}
      {!!m && <span className={`${styles.dchip} ${m > 0 ? styles.dMoney : styles.dDown}`}>{m > 0 ? "+" : ""}{won(m)}</span>}
    </span>
  );
}

export function RollChip({ r }: { r: Roll }) {
  return (
    <span className={`${styles.rollChip} ${styles[`t_${r.tier}`]}`}>
      <Die n={r.dice[0]} size={14} />
      <Die n={r.dice[1]} size={14} />
      <span className="num">
        {r.mod !== 0 && (r.mod > 0 ? `+${r.mod} ` : `${r.mod} `)}= {r.total}
      </span>
      <b>{TIER_LABEL[r.tier]}</b>
    </span>
  );
}

export function EntryIcon({ k }: { k: LogEntry["k"] }) {
  const Icon = KIND_ICON[k] ?? Sparkles;
  return (
    <span className={`${styles.kindIcon} ${styles[`k_${k}`] ?? ""}`} aria-hidden="true">
      <Icon size={16} />
    </span>
  );
}

// 선택 결과 창: 주사위 선택이면 던지기 → 결과, 그냥 선택이면 바로 결과(plain)
export type Rolling = { opt: PendingOpt; text: string; phase: "ready" | "rolling" | "done"; roll?: Roll | null; result?: LogEntry | null; t0?: number; plain?: boolean };
