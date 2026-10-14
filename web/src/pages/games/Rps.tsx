// 가위바위보 — 손을 고르면 바로 한 판. 상대 손과 결과는 서버(rps_play)가 정함.
// 이기면 1.9배, 비기면 그대로, 지면 0.
import { useEffect, useRef, useState } from "react";
import { Card } from "../../components/Card";
import { LoginNeeded, PageHead } from "../../components/ui";
import { apiFetch } from "../../lib/auth";
import { API } from "../../lib/config";
import { fmt } from "../../lib/format";
import { BetPanel, GameLock, GameResult, netTone, RecentList, signed, type ResultView } from "./GameParts";
import { HAND_ICONS } from "./handIcons";
import { AFTER_RESULT_WAIT_MS, REDUCED_MOTION, sleep, useMinigame, type GameStateBase } from "./useMinigame";
import styles from "./Games.module.css";

type Hand = "scissors" | "rock" | "paper";
type Res = "win" | "draw" | "lose";
type RpsState = GameStateBase & { winMultiplier: number; recent: { bet: number; playerHand: Hand; cpuHand: Hand; result: Res; payout: number; createdAt: string }[] };

const HANDS: Hand[] = ["scissors", "rock", "paper"];
const HAND_KO: Record<Hand, string> = { scissors: "가위", rock: "바위", paper: "보" };
const RESULT_KO: Record<Res, string> = { win: "이김", draw: "비김", lose: "짐" };
const RESULT_COLOR: Record<Res, string> = { win: "#2fb574", draw: "#6b7480", lose: "#e03141" };
const SHAKE_MIN_MS = REDUCED_MOTION ? 300 : 1200;
const SERVER_COOLDOWN_MS = 3000;

function HandIcon({ hand, size = 56 }: { hand: Hand; size?: number }) {
  const i = HAND_ICONS[hand];
  return <svg width={size} height={size} viewBox={i.viewBox} aria-hidden="true" dangerouslySetInnerHTML={{ __html: i.inner }} />;
}

export default function Rps() {
  const game = useMinigame<RpsState>(API.rps, "가위바위보");
  const [me, setMe] = useState<Hand>("rock");
  const [cpu, setCpu] = useState<Hand>("rock");
  const [shaking, setShaking] = useState(false);
  const [outcome, setOutcome] = useState<Res | null>(null);
  const [result, setResult] = useState<ResultView | null>(null);
  const cycler = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => void (cycler.current && clearInterval(cycler.current)), []);
  useEffect(() => {
    if (game.error) setResult({ tone: "error", title: game.error });
  }, [game.error]);

  async function play(hand: Hand) {
    if (!game.canPlay) return;
    const bet = game.bet;
    game.setPlaying(true);
    game.setError(null);
    setResult(null);
    setOutcome(null);
    setMe(hand);
    setShaking(true);
    let k = 0;
    cycler.current = setInterval(() => setCpu(HANDS[k++ % 3]), 110); // 응답 기다리는 동안 상대 손을 계속 바꿈
    const started = Date.now();
    try {
      const d = await apiFetch<{ cpuHand: Hand; result: Res; payout: number; net: number; balance: number }>(API.rps, { body: { bet, hand } });
      const remain = SHAKE_MIN_MS - (Date.now() - started);
      if (remain > 0) await sleep(remain);
      if (!game.alive.current) return;
      clearInterval(cycler.current!);
      setShaking(false);
      setCpu(d.cpuHand);
      setOutcome(d.result);
      game.applyResult(d.balance, { bet, playerHand: hand, cpuHand: d.cpuHand, result: d.result, payout: d.payout, createdAt: new Date().toISOString() });
      setResult({
        tone: netTone(d.net),
        color: RESULT_COLOR[d.result],
        title: `${RESULT_KO[d.result]} · ${signed(d.net)}`,
        desc: `나 ${HAND_KO[hand]} vs 상대 ${HAND_KO[d.cpuHand]} · ${fmt(bet)}P 걸어서 ${fmt(d.payout)}P 받았어요`,
      });
      game.startWait(Math.max(AFTER_RESULT_WAIT_MS, SERVER_COOLDOWN_MS + 300 - (Date.now() - started)));
    } catch (e) {
      const remain = SHAKE_MIN_MS - (Date.now() - started);
      if (remain > 0) await sleep(remain);
      clearInterval(cycler.current!);
      setShaking(false);
      setCpu("rock");
      game.handleError(e);
    } finally {
      if (game.alive.current) game.setPlaying(false);
    }
  }

  if (!game.isLoggedIn) {
    return (
      <div className="page">
        <PageHead title="가위바위보" desc="이기면 1.9배, 비기면 그대로, 지면 0이에요." />
        <Card>
          <LoginNeeded>로그인하면 가위바위보를 할 수 있어요.</LoginNeeded>
        </Card>
      </div>
    );
  }

  const mult = game.state?.winMultiplier ?? 1.9;
  return (
    <div className="page">
      <PageHead title="가위바위보" desc={`손을 고르면 바로 한 판. 이기면 ${mult}배 · 비기면 그대로 · 지면 0`} />
      <GameLock state={game.state} />
      <div className={styles.gameLayout}>
        <section className={styles.stageCard}>
          <div className={styles.rpsStage}>
            <div className={styles.rpsSide}>
              <span className="muted">나</span>
              <div className={`${styles.hand} ${styles.handMe} ${outcome === "win" ? styles.handWin : outcome === "lose" ? styles.handLose : ""}`}>
                <HandIcon hand={me} />
              </div>
            </div>
            <span className={`${styles.vs} num`}>VS</span>
            <div className={styles.rpsSide}>
              <span className="muted">상대</span>
              <div className={`${styles.hand} ${shaking ? styles.shake : ""} ${outcome === "lose" ? styles.handWin : outcome === "win" ? styles.handLose : ""}`}>
                <HandIcon hand={cpu} />
              </div>
            </div>
          </div>
          <BetPanel game={game}>
            <div className={styles.picks} role="group" aria-label="낼 손">
              {HANDS.map((h) => (
                <button key={h} type="button" className={styles.pick} disabled={!game.canPlay} onClick={() => play(h)}>
                  <HandIcon hand={h} size={34} />
                  <span>{HAND_KO[h]}</span>
                </button>
              ))}
            </div>
            <GameResult result={result} />
          </BetPanel>
        </section>
        <div className={styles.side}>
          <RecentList
            items={game.state?.recent}
            empty="아직 한 판도 안 했어요."
            render={(r) => ({
              tag: RESULT_KO[r.result] || "-",
              color: RESULT_COLOR[r.result] || "#6b7480",
              detail: `${fmt(r.bet)}P · ${HAND_KO[r.playerHand] || "-"} vs ${HAND_KO[r.cpuHand] || "-"}`,
              net: r.payout - r.bet,
              createdAt: r.createdAt,
            })}
          />
        </div>
      </div>
    </div>
  );
}
