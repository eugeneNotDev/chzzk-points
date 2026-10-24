// 유진 키우기 — 여러 화면이 같이 쓰는 작은 부품(상단바·능력치·주사위·장식).
import { type ReactNode } from "react";
import { ArrowLeft, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, type LucideIcon } from "lucide-react";
import { STATS, type Stats } from "../../lib/life";
import styles from "./Life.module.css";

/* ── 공통 ── */
export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div className={styles.topBar}>
      {onBack && (
        <button type="button" className={styles.backBtn} onClick={onBack} aria-label="뒤로">
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
      )}
      <h2 className={styles.topTitle}>{title}</h2>
      {right}
    </div>
  );
}

export function StatGrid({ stats, prev }: { stats: Stats; prev?: Stats | null }) {
  return (
    <div className={styles.statGrid}>
      {STATS.map((s) => {
        const v = stats[s.key] ?? 0;
        const d = prev ? v - (prev[s.key] ?? 0) : 0;
        return (
          <div key={s.key} className={styles.stat}>
            <div className={styles.statHead}>
              <span>{s.label}</span>
              <b className="num">
                {d !== 0 && (
                  <small key={`${v}-${d}`} className={d > 0 ? styles.up : styles.down}>
                    {d > 0 ? `+${d}` : d}
                  </small>
                )}
                {v}
              </b>
            </div>
            <div className={styles.bar}>
              <span style={{ width: `${v}%`, background: s.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const worldLabel = (run: { worldNo: number | null; id: number }) => (run.worldNo ? `No.${run.worldNo}` : `테스트 #${run.id}`);
const DIE: LucideIcon[] = [Dice1, Dice2, Dice3, Dice4, Dice5, Dice6];
export function Die({ n, size = 22, className }: { n: number; size?: number; className?: string }) {
  const Icon = DIE[Math.max(1, Math.min(6, n)) - 1];
  return <Icon size={size} className={className} aria-hidden="true" />;
}

export function Orbit({ className }: { className?: string }) {
  return (
    <svg className={className} width="210" height="210" viewBox="0 0 210 210" aria-hidden="true">
      <circle cx="105" cy="105" r="100" fill="none" stroke="currentColor" strokeOpacity="0.14" />
      <circle cx="105" cy="105" r="72" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeDasharray="2 5" />
      <circle cx="105" cy="105" r="44" fill="none" stroke="currentColor" strokeOpacity="0.24" />
      <circle cx="35" cy="140" r="4" fill="currentColor" />
      <circle cx="160" cy="160" r="3" fill="currentColor" fillOpacity="0.6" />
    </svg>
  );
}

export function Ring({ pct, size = 44, stroke = 5 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`수집률 ${pct}%`} className={styles.ring}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-surface-3)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-accent)" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(c * pct) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}
