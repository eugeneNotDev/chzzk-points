// 미니게임 공통 화면 조각 — 참여 제한 안내, 걸 포인트 입력, 결과, 최근 기록.
import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { fmt } from "../../lib/format";
import { MIN_BET, type GameStateBase, type Minigame } from "./useMinigame";
import styles from "./Games.module.css";
import { AnimatedNumber } from "../../components/AnimatedNumber";

export function GameLock({ state }: { state: GameStateBase | undefined }) {
  if (!state || state.eligible) return null;
  if (state.blocked) {
    const until = state.blockedUntil
      ? `${new Date(state.blockedUntil).toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}까지`
      : "별도 해제 전까지";
    return (
      <div className={styles.lock}>
        <Lock size={22} aria-hidden="true" />
        <strong>미니게임 참여가 제한됐어요</strong>
        <p className="muted">{until} 룰렛·가위바위보·홀짝에 참여할 수 없어요. 무료 뽑기와 투표는 그대로 할 수 있어요.</p>
      </div>
    );
  }
  const need = state.requiredPoints;
  const have = state.maxBalanceReached;
  return (
    <div className={styles.lock}>
      <Lock size={22} aria-hidden="true" />
      <strong>{state.requiredTierName || "브론즈"} 등급부터 참여할 수 있어요</strong>
      <p className="muted">
        최고 보유 포인트 기준이에요. 지금 {fmt(have)}P · {fmt(Math.max(0, need - have))}P 더 모으면 열려요.
      </p>
      <div className={styles.lockBar}>
        <span style={{ width: `${Math.min(100, need > 0 ? (have / need) * 100 : 100)}%` }} />
      </div>
    </div>
  );
}

export function BetPanel({ game, children }: { game: Minigame; children: ReactNode }) {
  const locked = !!game.state?.blocked || !game.state?.eligible;
  const add = (v: number) => game.setBet(game.bet + v);
  return (
    <div className={styles.panel}>
      <div className={styles.balanceRow}>
        <span className="muted">보유 포인트</span>
        <b className="num">
          <AnimatedNumber value={game.balance} />
          <small>P</small>
        </b>
      </div>
      <label className={styles.betField}>
        <span className="muted">걸 포인트</span>
        <input
          className={`num ${game.hintBad && game.bet > 0 ? styles.bad : ""}`}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          disabled={locked}
          value={game.bet > 0 ? fmt(game.bet) : ""}
          onChange={(e) => game.setBet(parseInt(e.target.value.replace(/[^0-9]/g, ""), 10) || 0)}
          aria-label="걸 포인트"
        />
        <span className={styles.unit}>P</span>
      </label>
      <div className={styles.chips}>
        <button type="button" className="btn btn-sm" disabled={locked} onClick={() => add(100)}>
          +100
        </button>
        <button type="button" className="btn btn-sm" disabled={locked} onClick={() => add(1000)}>
          +1,000
        </button>
        <button type="button" className="btn btn-sm" disabled={locked} onClick={() => add(10000)}>
          +10,000
        </button>
        <button type="button" className="btn btn-sm" disabled={locked} onClick={() => game.setBet(Math.max(MIN_BET, Math.floor(game.balance / 2)))}>
          절반
        </button>
        <button type="button" className="btn btn-sm" disabled={locked} onClick={() => game.setBet(Math.max(MIN_BET, game.balance))}>
          최대
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={locked} onClick={() => game.setBet(MIN_BET)}>
          초기화
        </button>
      </div>
      <p className={`${styles.hint} ${game.hintBad ? styles.hintBad : ""}`}>{game.hint}</p>
      {children}
    </div>
  );
}

// 결과 한 줄: [배율·결과 칩] 크게 "얼마 벌었/잃었어요" + 설명 ……… 오른쪽에 큰 +/- 포인트
export type ResultView = { tone: "plus" | "minus" | "even" | "error"; color?: string; badge?: string; net?: number; title?: string; desc?: ReactNode; jackpot?: boolean };

const headline = (net: number) => (net > 0 ? `${fmt(net)}P 벌었어요` : net < 0 ? `${fmt(-net)}P 잃었어요` : "본전이에요");

export function GameResult({ result }: { result: ResultView | null }) {
  if (!result) return null;
  if (result.tone === "error") {
    return (
      <div className={`${styles.result} ${styles.resError}`} role="status" aria-live="polite">
        <span className={styles.resText}>
          <strong>{result.title}</strong>
        </span>
      </div>
    );
  }
  const tone = result.tone === "plus" ? styles.resPlus : result.tone === "minus" ? styles.resMinus : styles.resEven;
  return (
    <div className={`${styles.result} ${tone} ${result.jackpot ? styles.jackpot : ""}`} role="status" aria-live="polite">
      {result.badge && (
        <span className={`${styles.resBadge} num`} style={result.color ? ({ "--c": result.color } as React.CSSProperties) : undefined}>
          {result.badge}
        </span>
      )}
      <span className={styles.resText}>
        <strong>{result.title ?? headline(result.net ?? 0)}</strong>
        {result.desc && <span>{result.desc}</span>}
      </span>
      {result.net != null && <b className={`${styles.resNet} num`}>{signed(result.net)}</b>}
    </div>
  );
}

export function RecentList<T>({ items, empty, render }: { items: T[] | undefined; empty: string; render: (item: T) => { tag: string; color: string; detail: string; net: number; createdAt: string } }) {
  return (
    <Card title="최근 기록" flush>
      {items && items.length === 0 && <EmptyState>{empty}</EmptyState>}
      <ul className={styles.recent}>
        {items?.map((it, i) => {
          const r = render(it);
          const tone = r.net > 0 ? styles.plusText : r.net < 0 ? styles.minusText : "";
          return (
            <li key={i}>
              <span className={styles.recentTag} style={{ "--c": r.color } as React.CSSProperties}>
                {r.tag}
              </span>
              <span className={styles.recentMain}>
                <span>{r.detail}</span>
                <span className="muted">
                  {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(r.createdAt))}
                </span>
              </span>
              <b className={`num ${tone}`}>
                {r.net > 0 ? "+" : r.net === 0 ? "±" : ""}
                {fmt(r.net)}P
              </b>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export const netTone = (net: number): ResultView["tone"] => (net > 0 ? "plus" : net < 0 ? "minus" : "even");
export const signed = (net: number) => `${net > 0 ? "+" : net === 0 ? "±" : ""}${fmt(net)}P`;
