// 양 로켓 — 발사하면 배수가 e^(0.13·초)로 오르다가 언젠가 터짐. 터지기 전에 내리면 베팅 × 그 배수.
// 터지는 배수는 서버(DB)만 알고, 화면엔 판이 끝난 뒤에야 내려옴. 내리기는 요청이 서버에 도착한 순간 기준.
// 진행 중엔 "watch" 요청을 걸어두면 서버가 판이 끝나는 순간에 응답해 줌(그 전엔 응답 안 함).
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Card } from "../../components/Card";
import { LoginNeeded, PageHead } from "../../components/ui";
import { apiFetch } from "../../lib/auth";
import { API } from "../../lib/config";
import { fmt } from "../../lib/format";
import { BetPanel, GameLock, GameResult, RecentList, type ResultView } from "./GameParts";
import { useMinigame, type GameStateBase } from "./useMinigame";
import styles from "./Games.module.css";

type Round = {
  roundId: number;
  status: "flying" | "cashed" | "crashed";
  bet: number;
  autoAt: number | null;
  startedAt: string;
  crashAt: number | null;
  cashedAt: number | null;
  payout: number;
  net: number | null;
  balance: number;
  serverNow: string;
};
type RecentRound = { bet: number; status: "cashed" | "crashed"; crashAt: number; cashedAt: number | null; payout: number; createdAt: string };
type RocketState = GameStateBase & { maxBet: number; growth: number; maxMultiplier: number; active: Round | null; serverNow: string; recent: RecentRound[] };

// phase: idle(발사 전) · flying(비행 중, 내리기 가능) · after(내렸고 로켓은 아직 나는 중) · done(끝)
type Phase = "idle" | "flying" | "after" | "done";
type Flight = { roundId: number; bet: number; autoAt: number | null; start: number; crashAt: number | null; cashedAt: number | null; payout: number };

const W = 640;
const H = 320;
const GREEN = "#2fb574";
const RED = "#e03141";
const x2 = (m: number) => m.toFixed(2);

export default function Rocket({ top }: { top?: ReactNode }) {
  const game = useMinigame<RocketState>(API.rocket, "양 로켓");
  const growth = game.state?.growth ?? 0.13;
  const maxBet = game.state?.maxBet ?? 10_000_000;
  const [phase, setPhase] = useState<Phase>("idle");
  const [flight, setFlight] = useState<Flight | null>(null);
  const [now, setNow] = useState(Date.now());
  const [autoText, setAutoText] = useState("");
  const [cashing, setCashing] = useState(false);
  const [result, setResult] = useState<ResultView | null>(null);
  const finished = useRef(new Set<number>());
  const tracking = useRef<number | null>(null);

  const multAt = (f: Flight, t: number) => Math.floor(Math.exp((growth * Math.max(0, t - f.start)) / 1000) * 100) / 100;
  const live = flight ? multAt(flight, now) : 1;
  // 터진 배수를 알면 거기서 멈춤
  const mult = flight && flight.crashAt != null ? Math.min(live, flight.crashAt) : live;
  const exploded = !!flight && flight.crashAt != null && live >= flight.crashAt;

  // 화면 갱신 — 나는 동안만 매 프레임
  useEffect(() => {
    if (phase !== "flying" && phase !== "after") return;
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // 로켓이 터지는 지점까지 날아가면 끝
  useEffect(() => {
    if ((phase === "flying" || phase === "after") && exploded) {
      setPhase("done");
      game.setPlaying(false);
      game.startWait(600);
    }
  }, [phase, exploded]); // eslint-disable-line react-hooks/exhaustive-deps

  // 서버 시각 → 화면 시각
  const toClient = (startedAt: string, serverNow: string, sentAt: number) => {
    const offset = Date.parse(serverNow) - (sentAt + Date.now()) / 2;
    return Date.parse(startedAt) - offset;
  };

  function finish(r: Round) {
    if (finished.current.has(r.roundId)) return;
    finished.current.add(r.roundId);
    tracking.current = null;
    setCashing(false);
    setFlight((f) => (f && f.roundId === r.roundId ? { ...f, crashAt: r.crashAt, cashedAt: r.cashedAt, payout: r.payout } : f));
    setPhase((p) => (p === "flying" ? (r.status === "cashed" ? "after" : "flying") : p));
    game.applyResult(r.balance, { bet: r.bet, status: r.status, crashAt: r.crashAt, cashedAt: r.cashedAt, payout: r.payout, createdAt: new Date().toISOString() });
    const net = r.payout - r.bet;
    if (r.status === "cashed") {
      setResult({
        tone: net > 0 ? "plus" : "even",
        color: GREEN,
        badge: `x${x2(r.cashedAt ?? 1)}`,
        net,
        desc: `${fmt(r.bet)}P 걸어서 ${fmt(r.payout)}P 받았어요 · 로켓은 x${x2(r.crashAt ?? 0)}에서 터졌어요`,
      });
    } else {
      setResult({ tone: "minus", color: RED, badge: "펑", net, desc: `x${x2(r.crashAt ?? 1)}에서 터졌어요` });
    }
  }

  // 판이 끝날 때까지 서버에 지켜보기 요청(끝나는 순간 응답이 옴)
  async function watch(roundId: number) {
    let fails = 0;
    while (game.alive.current && tracking.current === roundId) {
      try {
        const r = await apiFetch<Round>(API.rocket, { body: { action: "watch", roundId } });
        fails = 0;
        if (r.status !== "flying") return finish(r);
      } catch (e) {
        if (++fails >= 5) return game.handleError(e);
        await new Promise((res) => setTimeout(res, 1000));
      }
    }
  }

  function begin(r: Round, sentAt: number) {
    const f: Flight = { roundId: r.roundId, bet: r.bet, autoAt: r.autoAt, start: toClient(r.startedAt, r.serverNow, sentAt), crashAt: null, cashedAt: null, payout: 0 };
    tracking.current = r.roundId;
    setFlight(f);
    setNow(Date.now());
    setPhase("flying");
    game.setPlaying(true);
    void watch(r.roundId);
  }

  // 새로고침·재접속 — 진행 중이던 판 이어서 보기
  const active = game.state?.active;
  useEffect(() => {
    if (!active || active.status !== "flying" || tracking.current === active.roundId || finished.current.has(active.roundId)) return;
    setResult(null);
    begin(active, Date.now());
  }, [active?.roundId]); // eslint-disable-line react-hooks/exhaustive-deps

  const auto = autoText.trim() === "" ? null : Number(autoText.replace(/[^0-9.]/g, ""));
  const autoBad = auto != null && (!Number.isFinite(auto) || auto < 1.01 || auto > (game.state?.maxMultiplier ?? 200));
  const tooMuch = game.bet > maxBet;
  const canLaunch = game.canPlay && !autoBad && !tooMuch && (phase === "idle" || phase === "done");

  async function launch() {
    if (!canLaunch) return;
    game.setError(null);
    setResult(null);
    game.setPlaying(true);
    const sentAt = Date.now();
    try {
      const r = await apiFetch<Round>(API.rocket, { body: { action: "start", bet: game.bet, auto: auto ?? undefined } });
      game.setBalance(r.balance);
      if (!game.alive.current) return;
      begin(r, sentAt);
    } catch (e) {
      game.setPlaying(false);
      game.handleError(e);
    }
  }

  async function cashOut() {
    if (!flight || phase !== "flying" || cashing) return;
    setCashing(true);
    try {
      const r = await apiFetch<Round>(API.rocket, { body: { action: "cashout", roundId: flight.roundId } });
      if (r.status !== "flying") finish(r);
    } catch (e) {
      setCashing(false);
      game.handleError(e);
    }
  }

  useEffect(() => {
    if (game.error) setResult({ tone: "error", title: game.error });
  }, [game.error]);

  if (!game.isLoggedIn) {
    return (
      <div className="page">
        <PageHead title="양 로켓" desc="배수가 오르는 로켓에서 터지기 전에 내리면 그 배수만큼 받아요." />
        {top}
        <Card>
          <LoginNeeded>로그인하면 양 로켓을 할 수 있어요.</LoginNeeded>
        </Card>
      </div>
    );
  }

  // 그래프 — 지금까지 오른 곡선
  const elapsed = flight ? Math.max(0, Math.min(now, flight.crashAt != null ? flight.start + (Math.log(flight.crashAt) / growth) * 1000 : now) - flight.start) / 1000 : 0;
  const tMax = Math.max(8, elapsed * 1.15);
  const yMax = Math.max(2, mult * 1.25);
  const toY = (m: number) => H - ((m - 1) / (yMax - 1)) * (H - 40) - 12;
  const pts = Array.from({ length: 61 }, (_, i) => {
    const t = (elapsed * i) / 60;
    return `${((t / tMax) * W).toFixed(1)},${toY(Math.exp(growth * t)).toFixed(1)}`;
  }).join(" ");
  const shipX = (elapsed / tMax) * 100;
  const shipY = (toY(mult) / H) * 100;
  const crashedNow = phase === "done" && flight?.cashedAt == null && flight?.crashAt != null;
  const tone = crashedNow ? styles.rocketCrashed : flight?.cashedAt != null ? styles.rocketCashed : "";

  let status = "걸 포인트를 정하고 발사해 보세요";
  if (phase === "flying") status = flight?.autoAt ? `x${x2(flight.autoAt)}에서 자동으로 내려요 · 지금 내리면 ${fmt(Math.floor((flight?.bet ?? 0) * mult))}P` : `지금 내리면 ${fmt(Math.floor((flight?.bet ?? 0) * mult))}P`;
  if (phase === "after") status = `x${x2(flight?.cashedAt ?? 1)}에서 내렸어요 · 로켓은 아직 나는 중`;
  if (phase === "done" && flight) status = flight.cashedAt != null ? `x${x2(flight.cashedAt)}에서 내렸어요 · x${x2(flight.crashAt ?? 0)}에서 터짐` : "펑! 못 내렸어요";

  const busts = ((game.state?.recent ?? []) as RecentRound[]).slice(0, 8);

  return (
    <div className="page">
      <PageHead title="양 로켓" desc="배수가 오르는 로켓에서 터지기 전에 내리면 그 배수만큼 받아요. 언제 터질지는 아무도 몰라요. 브론즈 등급부터, 최소 100P." />
      {top}
      <GameLock state={game.state} query={game.query} />
      <div className={styles.gameLayout}>
        <section className={styles.stageCard}>
          {busts.length > 0 && (
            <div className={styles.busts} aria-label="최근 터진 배수">
              {busts.map((b, i) => (
                <span key={i} className={`num ${styles.bust} ${b.crashAt >= 2 ? styles.bustHi : styles.bustLo}`}>
                  x{x2(b.crashAt)}
                </span>
              ))}
            </div>
          )}
          <div className={styles.rocketStage}>
            <svg className={styles.rocketCurve} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
              {[0.25, 0.5, 0.75].map((r) => (
                <line key={r} x1="0" x2={W} y1={H * r} y2={H * r} className={styles.rocketGrid} />
              ))}
              {flight && <polyline points={pts} fill="none" stroke={crashedNow ? RED : GREEN} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
            </svg>
            {flight && (
              <div className={styles.rocketShip} style={{ left: `${shipX}%`, top: `${shipY}%` }} aria-hidden="true">
                {exploded ? <Boom /> : <Ship />}
              </div>
            )}
            <div className={`${styles.rocketMult} ${tone}`} role="status" aria-live="off">
              <b className="num">x{x2(mult)}</b>
              <span>{status}</span>
            </div>
          </div>
          <BetPanel game={game}>
            <label className={styles.autoRow}>
              <span className="muted">자동 내리기 (선택)</span>
              <input
                className={`num ${autoBad ? styles.bad : ""}`}
                inputMode="decimal"
                placeholder="예: 2.00"
                value={autoText}
                disabled={phase === "flying" || phase === "after"}
                onChange={(e) => setAutoText(e.target.value.replace(/[^0-9.]/g, "").slice(0, 6))}
                aria-label="자동 내리기 배수"
              />
            </label>
            {(tooMuch || autoBad) && <p className={`${styles.hint} ${styles.hintBad}`}>{tooMuch ? `한 판에 ${fmt(maxBet)}P까지 걸 수 있어요` : "자동 내리기는 x1.01 ~ x200 사이로 정해 주세요"}</p>}
            {phase === "flying" ? (
              <button type="button" className={`btn btn-lg btn-block ${styles.cashBtn}`} disabled={cashing || flight?.crashAt != null} onClick={cashOut}>
                {cashing ? "내리는 중…" : `x${x2(mult)} 내리기 (+${fmt(Math.floor((flight?.bet ?? 0) * mult) - (flight?.bet ?? 0))}P)`}
              </button>
            ) : phase === "after" ? (
              <button type="button" className="btn btn-lg btn-block" disabled>
                내림 완료 · 지켜보는 중
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-lg btn-block" disabled={!canLaunch} onClick={launch}>
                {game.playing ? "발사 준비 중…" : game.waiting ? "잠시만요…" : phase === "done" ? "다시 발사" : "발사"}
              </button>
            )}
            <p className={styles.hint}>내리기는 서버에 도착한 순간의 배수로 확정돼요. 창을 닫아도 판은 계속 진행돼요(자동 내리기가 없으면 결국 터져요).</p>
            <GameResult result={result} />
          </BetPanel>
        </section>
        <div className={styles.side}>
          <RecentList
            items={game.state?.recent}
            empty="아직 발사한 기록이 없어요."
            render={(r) => ({
              tag: r.status === "cashed" ? `x${x2(r.cashedAt ?? 1)}` : "펑",
              color: r.status === "cashed" ? GREEN : RED,
              detail: r.status === "cashed" ? `${fmt(r.bet)}P · 터진 곳 x${x2(r.crashAt)}` : `${fmt(r.bet)}P · x${x2(r.crashAt)}에서 터짐`,
              net: r.payout - r.bet,
              createdAt: r.createdAt,
            })}
          />
        </div>
      </div>
    </div>
  );
}

function Ship() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56">
      <g transform="rotate(45 28 28)">
        <path d="M22 42 L28 55 L34 42 Z" fill="#ffb347" />
        <path d="M28 4 Q39 14 39 30 L39 41 L17 41 L17 30 Q17 14 28 4 Z" fill="#f1f4f6" stroke="#0d0f12" strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx="28" cy="22" r="5.5" fill="#4da3ff" stroke="#0d0f12" strokeWidth="2.5" />
        <path d="M17 31 L9 44 L17 41 Z M39 31 L47 44 L39 41 Z" fill="#00e5a0" stroke="#0d0f12" strokeWidth="2" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

function Boom() {
  return (
    <svg width="64" height="64" viewBox="0 0 56 56">
      <circle cx="28" cy="28" r="24" fill="#e03141" opacity="0.3" />
      <path d="M28 4 L33 19 L49 13 L38 27 L51 36 L34 35 L30 52 L24 36 L7 41 L18 28 L7 15 L23 20 Z" fill="#ffb347" stroke="#0d0f12" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
