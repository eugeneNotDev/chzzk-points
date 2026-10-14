// 룰렛 — 가로로 굴러가는 배율 카드(x0~x5) 중 하나. 결과는 서버(roulette_spin)가 정하고,
// 화면은 그 카드가 가운데 선에 멈추도록 굴리는 연출만 함. 확률은 서버에만 있음.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Card } from "../../components/Card";
import { LoginNeeded, PageHead } from "../../components/ui";
import { apiFetch } from "../../lib/auth";
import { API } from "../../lib/config";
import { fmt } from "../../lib/format";
import { BetPanel, GameLock, GameResult, netTone, RecentList, signed, type ResultView } from "./GameParts";
import { AFTER_RESULT_WAIT_MS, REDUCED_MOTION, useMinigame, type GameStateBase } from "./useMinigame";
import styles from "./Games.module.css";

type RouletteState = GameStateBase & { multipliers: number[]; recent: { bet: number; multiplier: number; payout: number; createdAt: string }[] };

const TILE_W = 88;
const STEP = TILE_W + 8;
const SPIN_MS = REDUCED_MOTION ? 1200 : 5200;
const SERVER_COOLDOWN_MS = 5000;
const COLORS: Record<string, string> = { "0": "#e03141", "0.5": "#ff922b", "1": "#6b7480", "1.2": "#2fb574", "1.5": "#00a8e8", "2": "#8b5cf6", "3": "#ff6bb5", "5": "#f2c230" };
// 결과 말고 지나가는 카드들은 보기 좋게 섞기만 하는 용도(실제 확률 아님)
const FILLER: Record<string, number> = { "0": 10, "0.5": 14, "1": 26, "1.2": 14, "1.5": 12, "2": 9, "3": 7, "5": 5 };
const colorOf = (m: number) => COLORS[String(m)] || (m >= 5 ? "#f2c230" : "#6b7480");

export default function Roulette() {
  const game = useMinigame<RouletteState>(API.roulette, "룰렛");
  const mults = game.state?.multipliers?.length ? game.state.multipliers : [0, 0.5, 1, 1.2, 1.5, 2, 3, 5];
  const filler = () => {
    const pool = mults.map((m) => [m, FILLER[String(m)] ?? 8] as const);
    let r = Math.random() * pool.reduce((s, [, w]) => s + w, 0);
    for (const [m, w] of pool) if ((r -= w) < 0) return m;
    return pool[pool.length - 1][0];
  };
  const [tiles, setTiles] = useState<number[]>(() => Array.from({ length: 15 }, filler));
  const [center, setCenter] = useState({ idx: 7, jitter: 0, animate: false });
  const [hit, setHit] = useState<number | null>(null);
  const [result, setResult] = useState<ResultView | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(600);

  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [game.state]);

  const x = viewW / 2 - (center.idx * STEP + TILE_W / 2) + center.jitter;

  async function spin() {
    if (!game.canPlay) return;
    const bet = game.bet;
    const requestedAt = Date.now();
    game.setPlaying(true);
    game.setError(null);
    setResult(null);
    setHit(null);
    try {
      const d = await apiFetch<{ multiplier: number; payout: number; net: number; balance: number }>(API.roulette, { body: { bet } });
      // 지금 보이는 카드 몇 장은 그대로 두고 뒤에 새 카드를 이어 붙인 뒤, 결과 카드까지 굴림
      const keepFrom = Math.max(0, center.idx - 5);
      const kept = tiles.slice(keepFrom, center.idx + 6);
      const startIdx = center.idx - keepFrom;
      const target = startIdx + 40 + Math.floor(Math.random() * 6);
      const next = kept.slice();
      while (next.length < target + 6) next.push(filler());
      next[target] = d.multiplier;
      setTiles(next);
      setCenter({ idx: startIdx, jitter: center.jitter, animate: false });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const jitter = Math.round((Math.random() - 0.5) * (TILE_W - 20));
      setCenter({ idx: target, jitter, animate: true });
      await new Promise((r) => setTimeout(r, SPIN_MS + 80));
      if (!game.alive.current) return;
      setHit(target);
      game.applyResult(d.balance, { bet, multiplier: d.multiplier, payout: d.payout, createdAt: new Date().toISOString() });
      setResult({
        tone: netTone(d.net),
        color: colorOf(d.multiplier),
        jackpot: d.multiplier >= 5,
        title: `x${d.multiplier} · ${signed(d.net)}`,
        desc: `${fmt(bet)}P 걸어서 ${fmt(d.payout)}P 받았어요`,
      });
      game.startWait(Math.max(AFTER_RESULT_WAIT_MS, SERVER_COOLDOWN_MS + 300 - (Date.now() - requestedAt)));
    } catch (e) {
      game.handleError(e);
    } finally {
      if (game.alive.current) game.setPlaying(false);
    }
  }

  useEffect(() => {
    if (game.error) setResult({ tone: "error", title: game.error });
  }, [game.error]);

  if (!game.isLoggedIn) {
    return (
      <div className="page">
        <PageHead title="룰렛" desc="배율 카드가 굴러가다 멈춘 곳의 배율만큼 받아요." />
        <Card>
          <LoginNeeded>로그인하면 룰렛을 돌릴 수 있어요.</LoginNeeded>
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead title="룰렛" desc="배율 카드가 굴러가다 멈춘 곳의 배율만큼 받아요. 브론즈 등급부터, 최소 100P." />
      <GameLock state={game.state} />
      <div className={styles.gameLayout}>
        <section className={styles.stageCard}>
          <div className={styles.reelView} ref={viewRef}>
            <div
              className={styles.reel}
              style={{ transform: `translateX(${x}px)`, transition: center.animate ? `transform ${SPIN_MS}ms cubic-bezier(.08,.6,.1,1)` : "none" }}
            >
              {tiles.map((m, i) => (
                <div key={i} className={`${styles.tile} ${m >= 5 ? styles.tileGold : ""} ${hit === i ? styles.tileHit : ""}`} style={{ "--c": colorOf(m) } as React.CSSProperties}>
                  <b className="num">x{m}</b>
                </div>
              ))}
            </div>
            <div className={styles.marker} aria-hidden="true" />
          </div>
          <BetPanel game={game}>
            <button type="button" className="btn btn-primary btn-lg btn-block" disabled={!game.canPlay} onClick={spin}>
              {game.playing ? "돌아가는 중…" : game.waiting ? "잠시만요…" : "돌리기"}
            </button>
            <GameResult result={result} />
          </BetPanel>
        </section>
        <div className={styles.side}>
          <RecentList
            items={game.state?.recent}
            empty="아직 돌린 기록이 없어요."
            render={(r) => ({ tag: `x${r.multiplier}`, color: colorOf(r.multiplier), detail: `${fmt(r.bet)}P`, net: r.payout - r.bet, createdAt: r.createdAt })}
          />
        </div>
      </div>
    </div>
  );
}
