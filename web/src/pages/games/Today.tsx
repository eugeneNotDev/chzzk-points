// 오늘의 미니게임 — 하루에 한 게임만(한국 시간 자정마다 바뀜). 위에 오늘·다음 게임 일정, 아래에 오늘 게임 화면.
// 자정이 지나면 화면도 저절로 다음 게임으로 넘어감. 주인 계정은 테스트용으로 아무 게임이나 골라볼 수 있음.
import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { gameLabel, msToNextChange, ROTATION, todayGame, upcoming, type GameId } from "../../lib/rotation";
import styles from "./Games.module.css";

type GamePage = ComponentType<{ top?: ReactNode }>;
const GAMES: Record<GameId, GamePage> = {
  roulette: lazy(() => import("./Roulette")),
  rps: lazy(() => import("./Rps")),
  "odd-even": lazy(() => import("./OddEven")),
  rocket: lazy(() => import("./Rocket")),
};

const pad = (n: number) => String(n).padStart(2, "0");
function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export default function Today() {
  const { isAdmin } = useAuth();
  const [now, setNow] = useState(Date.now());
  const [pick, setPick] = useState<GameId | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const today = todayGame(now).id;
  const id = (isAdmin && pick) || today;
  const Game = GAMES[id];
  const top = <RotationBar now={now} today={today} selected={id} onPick={isAdmin ? setPick : undefined} />;

  return (
    <Suspense
      fallback={
        <div className="page">
          {top}
          <span className="skeleton" style={{ height: 360, borderRadius: 20 }} />
        </div>
      }
    >
      <Game key={id} top={top} />
    </Suspense>
  );
}

function RotationBar({ now, today, selected, onPick }: { now: number; today: GameId; selected: GameId; onPick?: (id: GameId) => void }) {
  const days = upcoming(4, now);
  return (
    <div className={styles.rotation}>
      <div className={styles.rotToday}>
        <span className={styles.rotBadge}>오늘의 미니게임</span>
        <b>{gameLabel(today)}</b>
        <span className="muted">
          다음 게임까지 <b className="num">{countdown(msToNextChange(now))}</b>
        </span>
      </div>
      <ol className={styles.rotNext} aria-label="다가오는 게임">
        {days.slice(1).map((d, i) => (
          <li key={d.day}>
            <span className="muted">{i === 0 ? "내일" : d.date}</span>
            <b>{d.game.label}</b>
          </li>
        ))}
      </ol>
      {onPick && (
        <div className={styles.rotAdmin}>
          <span className="muted">주인 계정 테스트</span>
          {ROTATION.map((g) => (
            <button key={g.id} type="button" className={`btn btn-sm ${selected === g.id ? "btn-primary" : "btn-ghost"}`} onClick={() => onPick(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
