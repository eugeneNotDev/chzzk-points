// 오늘의 미니게임 — 하루에 한 게임만(한국 시간 자정마다 바뀜). 위에 오늘·다음 게임 일정, 아래에 오늘 게임 화면.
// 자정이 지나도 하던 게임(나는 중인 로켓 등)이 끊기지 않게 화면은 그대로 두고, 위에 "새 게임으로" 버튼만 띄움.
// 주인 계정은 테스트용으로 아무 게임이나 골라볼 수 있음.
import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, useAuth } from "../../lib/auth";
import { API } from "../../lib/config";
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
  const { isAdmin, isLoggedIn, channelId } = useAuth();
  const [tick, setTick] = useState(Date.now());
  const [pick, setPick] = useState<GameId | null>(null);
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // 양 로켓 상태(양 로켓 화면과 같은 캐시) — 자정을 넘겨 날고 있는 로켓이 있으면 그 화면을 계속 보여주고,
  // 서버 시각도 같이 받아서 기기 시계가 틀려도 오늘 게임을 서버 기준으로 맞춤
  const rocket = useQuery({
    queryKey: ["minigame", API.rocket, channelId],
    enabled: isLoggedIn,
    staleTime: 0,
    queryFn: () => apiFetch<{ active: { status: string } | null; serverNow: string }>(API.rocket),
  });
  const [offset, setOffset] = useState(0);
  const [holdRocket, setHoldRocket] = useState<boolean | null>(null);
  useEffect(() => {
    if (!rocket.data || rocket.isFetching) return;
    if (rocket.data.serverNow) setOffset(Date.parse(rocket.data.serverNow) - rocket.dataUpdatedAt);
    setHoldRocket((h) => (h === null ? rocket.data.active?.status === "flying" : h));
  }, [rocket.data, rocket.isFetching]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = tick + offset;
  const today = todayGame(now).id;
  // 처음 들어왔을 때(또는 "새 게임으로"를 눌렀을 때)의 오늘 게임
  const [shownDay, setShownDay] = useState<GameId>(today);
  // 서버 시각을 받기 전에 정한 게임이 서버 기준과 다르면(기기 시계가 틀린 경우) 한 번 맞춤
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    if (!synced && offset !== 0) {
      setSynced(true);
      setShownDay(todayGame(Date.now() + offset).id);
    }
  }, [offset, synced]);
  const base = holdRocket ? "rocket" : shownDay;
  const id = (isAdmin && pick) || base;
  const Game = GAMES[id];
  const stale = !pick && base !== today;
  const refresh = () => {
    setHoldRocket(false);
    setShownDay(today);
  };
  const top = <RotationBar now={now} today={today} selected={id} onPick={isAdmin ? setPick : undefined} stale={stale} held={!!holdRocket && !pick} onRefresh={refresh} />;

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

function RotationBar({ now, today, selected, onPick, stale, held, onRefresh }: { now: number; today: GameId; selected: GameId; onPick?: (id: GameId) => void; stale: boolean; held: boolean; onRefresh: () => void }) {
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
      {stale && (
        <div className={styles.rotStale} role="status">
          <span>{held ? `날고 있던 양 로켓을 이어서 보여주는 중이에요. 오늘의 게임은 ${gameLabel(today)}예요.` : `오늘의 게임이 ${gameLabel(today)}(으)로 바뀌었어요.`}</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={onRefresh}>
            새 게임으로
          </button>
        </div>
      )}
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
