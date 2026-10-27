// 양 로켓 — 발사하면 배수가 e^(0.13·초)로 오르다가 언젠가 터짐. 터지기 전에 내리면 베팅 × 그 배수.
// 터지는 배수는 서버(DB)만 알고, 화면엔 판이 끝난 뒤에야 내려옴. 내리기는 요청이 서버에 도착한 순간 기준.
// 진행 중엔 "watch" 요청을 걸어두면 서버가 판이 끝나는 순간에 응답해 줌(그 전엔 응답 안 함).
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Card } from "../../components/Card";
import { LoginNeeded, PageHead } from "../../components/ui";
import { apiFetch, ApiError } from "../../lib/auth";
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
  const uid = useId().replace(/:/g, "");
  const game = useMinigame<RocketState>(API.rocket, "양 로켓", { maxBet: 10_000_000 });
  const growth = game.state?.growth ?? 0.13;
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: W, h: H });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageSize({ w: el.clientWidth || W, h: el.clientHeight || H }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [game.isLoggedIn]);
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

  // 서버 시각 → 화면 시각(clientAt: serverNow를 받았을 무렵의 화면 시각)
  const toClient = (startedAt: string, serverNow: string, clientAt: number) => Date.parse(startedAt) - (Date.parse(serverNow) - clientAt);

  function finish(r: Round) {
    if (finished.current.has(r.roundId)) return;
    finished.current.add(r.roundId);
    tracking.current = null;
    setCashing(false);
    if (r.status === "cashed") game.setPlaying(false); // 내렸으면 로켓이 아직 날아도 다음 판 가능
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
        if (++fails >= 5) {
          // 연결이 계속 안 되면 화면을 멈추고 서버 상태를 다시 받아옴(아직 나는 중이면 아래 이어보기가 다시 붙음)
          tracking.current = null;
          setFlight(null);
          setPhase("idle");
          game.setPlaying(false);
          game.handleError(e);
          void game.query.refetch();
          return;
        }
        await new Promise((res) => setTimeout(res, 1000));
      }
    }
  }

  function begin(r: Round, clientAt: number) {
    const f: Flight = { roundId: r.roundId, bet: r.bet, autoAt: r.autoAt, start: toClient(r.startedAt, r.serverNow, clientAt), crashAt: null, cashedAt: null, payout: 0 };
    tracking.current = r.roundId;
    setFlight(f);
    setNow(Date.now());
    setPhase("flying");
    game.setPlaying(true);
    void watch(r.roundId);
  }

  // 새로고침·재접속 — 진행 중이던 판 이어서 보기
  // 캐시에 남은 옛 상태 말고 방금 받아온 상태로만(시각 보정도 그 응답을 받은 시각 기준)
  const active = game.state?.active;
  const fetching = game.query.isFetching;
  useEffect(() => {
    if (fetching || !active || active.status !== "flying" || tracking.current === active.roundId || finished.current.has(active.roundId)) return;
    setResult(null);
    begin(active, game.query.dataUpdatedAt);
  }, [active?.roundId, fetching]); // eslint-disable-line react-hooks/exhaustive-deps

  const auto = autoText.trim() === "" ? null : Number(autoText.replace(/[^0-9.]/g, ""));
  const autoBad = auto != null && (!Number.isFinite(auto) || auto < 1.01 || auto > (game.state?.maxMultiplier ?? 200));
  // 내린 뒤(after)엔 로켓이 아직 날고 있어도 바로 다음 판 발사 가능
  const canLaunch = game.canPlay && !autoBad && phase !== "flying";

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
      begin(r, (sentAt + Date.now()) / 2);
    } catch (e) {
      game.setPlaying(false);
      game.handleError(e);
      // 다른 창에서 이미 날고 있는 판이 있으면 그 판을 불러와서 이어보기
      if (e instanceof ApiError && e.body.error === "round_active") void game.query.refetch();
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
  // 로켓 기울기 — 곡선의 지금 방향(화면 비율 대충 맞춰서)
  const dt = Math.max(0.05, elapsed * 0.12);
  const slope = (toY(Math.exp(growth * elapsed)) - toY(Math.exp(growth * Math.max(0, elapsed - dt)))) / ((dt / tMax) * W);
  // 무대가 viewBox(640×320)와 비율이 달라서 실제 픽셀 비율로 보정
  const angle = Math.max(-75, Math.min(-6, (Math.atan(slope * (stageSize.h / H) / (stageSize.w / W)) * 180 * 0.85) / Math.PI));
  const lastX = ((elapsed / tMax) * W).toFixed(1);
  const crashedNow = phase === "done" && flight?.cashedAt == null && flight?.crashAt != null;
  const lineColor = crashedNow ? RED : GREEN;
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
          <div className={styles.rocketStage} ref={stageRef}>
            <svg className={styles.rocketCurve} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
              {[0.25, 0.5, 0.75].map((r) => (
                <line key={r} x1="0" x2={W} y1={H * r} y2={H * r} className={styles.rocketGrid} />
              ))}
              <defs>
                <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={lineColor} stopOpacity="0.32" />
                  <stop offset="1" stopColor={lineColor} stopOpacity="0" />
                </linearGradient>
              </defs>
              {flight && (
                <>
                  <path d={`M0,${H} L${pts.replace(/ /g, " L")} L${lastX},${H} Z`} fill={`url(#${uid}-area)`} />
                  <polyline points={pts} fill="none" stroke={lineColor} strokeOpacity="0.25" strokeWidth="12" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  <polyline points={pts} fill="none" stroke={lineColor} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </>
              )}
            </svg>
            {flight && (
              <div className={styles.rocketShip} style={{ left: `${shipX}%`, top: `${shipY}%` }} aria-hidden="true">
                {exploded ? <Boom key={flight.roundId} /> : <Ship angle={angle} uid={uid} burning={phase === "flying" || phase === "after"} />}
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
            {autoBad && <p className={`${styles.hint} ${styles.hintBad}`}>자동 내리기는 x1.01 ~ x200 사이로 정해 주세요</p>}
            {phase === "flying" ? (
              <button type="button" className={`btn btn-lg btn-block ${styles.cashBtn}`} disabled={cashing || flight?.crashAt != null} onClick={cashOut}>
                {cashing ? "내리는 중…" : `x${x2(mult)} 내리기 (+${fmt(Math.floor((flight?.bet ?? 0) * mult) - (flight?.bet ?? 0))}P)`}
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-lg btn-block" disabled={!canLaunch} onClick={launch}>
                {game.playing ? "발사 준비 중…" : game.waiting ? "잠시만요…" : phase === "done" || phase === "after" ? "다시 발사" : "발사"}
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

// 양이 탄 로켓 — 오른쪽을 보고 그린 뒤 곡선 방향으로 기울임. 불꽃은 깜빡이고 뒤로 연기가 흩어짐.
function Ship({ angle, uid, burning }: { angle: number; uid: string; burning: boolean }) {
  return (
    <div className={styles.shipWrap} style={{ transform: `translate(-48%, -50%) rotate(${angle}deg)` }}>
      <svg width="104" height="52" viewBox="-36 0 104 52" overflow="visible">
        <defs>
          <linearGradient id={`${uid}-hull`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.55" stopColor="#e6eaee" />
            <stop offset="1" stopColor="#a9b2bc" />
          </linearGradient>
          <linearGradient id={`${uid}-fin`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3df2bd" />
            <stop offset="1" stopColor="#00a874" />
          </linearGradient>
          <radialGradient id={`${uid}-glass`} cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#9fd8ff" />
            <stop offset="1" stopColor="#1f5f9e" />
          </radialGradient>
          <linearGradient id={`${uid}-flameOut`} x1="1" y1="0" x2="0" y2="0">
            <stop offset="0" stopColor="#fff3b0" />
            <stop offset="0.35" stopColor="#ffb347" />
            <stop offset="1" stopColor="#ff4d3d" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-flameIn`} x1="1" y1="0" x2="0" y2="0">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#ffe066" stopOpacity="0" />
          </linearGradient>
        </defs>
        {burning && (
          <g className={styles.puffs}>
            <circle className={styles.puff} cx="2" cy="26" r="5" />
            <circle className={styles.puff} cx="2" cy="26" r="5" style={{ animationDelay: "-0.3s" }} />
            <circle className={styles.puff} cx="2" cy="26" r="5" style={{ animationDelay: "-0.6s" }} />
          </g>
        )}
        {burning && (
          <g className={styles.flame}>
            <path d="M14 17 C2 18 -14 22 -30 26 C-14 30 2 34 14 35 Z" fill={`url(#${uid}-flameOut)`} />
            <path d="M14 21 C6 22 -2 24 -12 26 C-2 28 6 30 14 31 Z" fill={`url(#${uid}-flameIn)`} />
          </g>
        )}
        <path d="M24 15 L13 3 Q11 1 14 1 L22 1 Q26 1 29 4 L37 14 Z" fill={`url(#${uid}-fin)`} stroke="#0b1a14" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M24 37 L13 49 Q11 51 14 51 L22 51 Q26 51 29 48 L37 38 Z" fill={`url(#${uid}-fin)`} stroke="#0b1a14" strokeWidth="1.6" strokeLinejoin="round" />
        <rect x="11" y="18" width="7" height="16" rx="2" fill="#5b6470" stroke="#0b1a14" strokeWidth="1.6" />
        <path d="M17 15 C30 12 50 12 60 19 Q66 23 66 26 Q66 29 60 33 C50 40 30 40 17 37 Z" fill={`url(#${uid}-hull)`} stroke="#0b1a14" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M54 15.6 Q62 20 65.6 25 L65.6 27 Q62 32 54 36.4 Q57 26 54 15.6 Z" fill="#00d391" stroke="#0b1a14" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M24 14.2 Q26.5 26 24 37.8" fill="none" stroke="#00d391" strokeWidth="3.2" />
        <path d="M22 19 C34 16.5 48 16.5 56 20" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
        <circle cx="41" cy="26" r="8.6" fill="#c9d1d9" stroke="#0b1a14" strokeWidth="1.6" />
        <circle cx="41" cy="26" r="6.6" fill={`url(#${uid}-glass)`} />
        <g>
          <circle cx="38.6" cy="23.6" r="2.4" fill="#ffffff" />
          <circle cx="41.4" cy="22.6" r="2.6" fill="#ffffff" />
          <circle cx="44" cy="23.8" r="2.2" fill="#ffffff" />
          <ellipse cx="41.4" cy="27.4" rx="3.4" ry="3" fill="#f4e4d4" />
          <circle cx="40.2" cy="27" r="0.75" fill="#14181d" />
          <circle cx="42.6" cy="27" r="0.75" fill="#14181d" />
          <ellipse cx="39.4" cy="28.6" rx="0.8" ry="0.5" fill="#f49aa8" />
          <ellipse cx="43.4" cy="28.6" rx="0.8" ry="0.5" fill="#f49aa8" />
        </g>
        <path d="M37 21.5 Q39 19.6 41.5 19.6" fill="none" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
      </svg>
    </div>
  );
}

// 터짐 — 섬광 → 불덩이 → 충격파 고리 → 파편·연기
const BITS = [
  [46, -30], [52, 6], [30, 40], [-8, 50], [-42, 30], [-50, -4], [-30, -40], [6, -52], [36, -46], [-48, 44],
];
function Boom() {
  return (
    <div className={styles.boomWrap}>
      <svg width="160" height="160" viewBox="-80 -80 160 160" overflow="visible">
        <defs>
          <radialGradient id="rk-fire" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.25" stopColor="#fff1a8" />
            <stop offset="0.55" stopColor="#ffb347" />
            <stop offset="0.8" stopColor="#ff5a3d" />
            <stop offset="1" stopColor="#c41e3a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="rk-flash" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.4" stopColor="#fff6d6" stopOpacity="0.8" />
            <stop offset="1" stopColor="#ffd27a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="rk-smoke" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#4a525c" stopOpacity="0.85" />
            <stop offset="0.6" stopColor="#3a4048" stopOpacity="0.45" />
            <stop offset="1" stopColor="#2a2f36" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle className={styles.boomSmoke} cx="-16" cy="-8" r="24" fill="url(#rk-smoke)" style={{ animationDelay: "0.18s" }} />
        <circle className={styles.boomSmoke} cx="18" cy="-14" r="20" fill="url(#rk-smoke)" style={{ animationDelay: "0.26s" }} />
        <circle className={styles.boomSmoke} cx="2" cy="16" r="22" fill="url(#rk-smoke)" style={{ animationDelay: "0.32s" }} />
        <circle className={styles.boomFlash} r="48" fill="url(#rk-flash)" />
        <circle className={styles.boomRing} r="30" fill="none" stroke="#ffd27a" strokeWidth="2.5" strokeOpacity="0.9" />
        <path className={styles.boomStar} d="M0 -46 L10 -14 L42 -24 L18 2 L44 22 L12 18 L4 48 L-8 18 L-40 30 L-18 2 L-42 -22 L-10 -14 Z" fill="#ffb347" />
        <circle className={styles.boomBall} r="34" fill="url(#rk-fire)" />
        {BITS.map(([dx, dy], i) => (
          <rect
            key={i}
            className={styles.boomBit}
            x="-3"
            y="-2"
            width={i % 3 === 0 ? 8 : 6}
            height={i % 3 === 0 ? 5 : 3.5}
            rx="1.5"
            fill={i % 2 ? "#ffcf5c" : "#f1f4f6"}
            style={{ "--dx": `${dx}px`, "--dy": `${dy}px`, animationDelay: `${(i % 4) * 0.02}s` } as React.CSSProperties}
          />
        ))}
      </svg>
    </div>
  );
}
