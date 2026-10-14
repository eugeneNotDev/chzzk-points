// 미니게임 공통 화면 조각 — 참여 제한 안내, 걸 포인트 입력, 결과, 최근 기록.
import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { fmt } from "../../lib/format";
import { MIN_BET, type GameStateBase, type Minigame } from "./useMinigame";
import styles from "./Games.module.css";

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
          {fmt(game.balance)}
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

export type ResultView = { tone: "plus" | "minus" | "even" | "error"; color?: string; title?: string; desc?: ReactNode; note?: string | null; jackpot?: boolean };

export function GameResult({ result }: { result: ResultView | null }) {
  if (!result) return null;
  // 서버가 덧붙여 보내는 한 줄 메시지 — "머리말 › 본문" 꼴이면 머리말만 강조
  let noteEl: ReactNode = null;
  if (result.note) {
    const cut = result.note.indexOf("›");
    noteEl = (
      <div className={styles.note}>
        {cut > 0 ? (
          <>
            <b>{result.note.slice(0, cut + 1)}</b> {result.note.slice(cut + 1).trim()}
          </>
        ) : (
          result.note
        )}
      </div>
    );
  }
  return (
    <div className={`${styles.result} ${styles[result.tone]} ${result.jackpot ? styles.jackpot : ""}`} style={result.color ? ({ "--c": result.color } as React.CSSProperties) : undefined} role="status" aria-live="polite">
      {result.title && <strong className="num">{result.title}</strong>}
      {result.desc && <span className="muted">{result.desc}</span>}
      {noteEl}
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
