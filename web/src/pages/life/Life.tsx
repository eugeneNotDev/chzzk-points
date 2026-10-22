// 유진 키우기 — 평행세계의 유진을 키우는 텍스트 인생 게임(테스트 버전, 베타 빌드 전용).
// 화면 흐름: 로비 → 태어날 집 고르기(포인트) → 진행(갈림길 선택·보호자 아이템) → 인생 리포트, 그리고 도감.
// 인생 진행·결과는 전부 서버(life-game → DB life_*)가 정하고, 화면은 받은 기록을 속도에 맞춰 한 줄씩 보여주기만 함.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, BookOpen, Check, FastForward, GitFork, Lock, LogIn, Pause, Play, RotateCcw, Trophy } from "lucide-react";
import { startLogin, useAuth } from "../../lib/auth";
import { confirmDialog } from "../../lib/dialog";
import { fmt } from "../../lib/format";
import { LoadError } from "../../components/LoadError";
import {
  STAGES, STATS, applyLifeItem, chooseLife, fetchRun, lifeErrorText, lifeStage, resetLifeTest, startLife, statChips,
  useLifeDex, useLifeLobby, type DexEntry, type Lobby, type LogEntry, type Run, type Stats,
} from "../../lib/life";
import styles from "./Life.module.css";

type Screen = { name: "lobby" } | { name: "birth" } | { name: "play"; run: Run } | { name: "report"; run: Run } | { name: "dex" };

export default function Life() {
  const { isLoggedIn } = useAuth();
  const q = useLifeLobby();
  const qc = useQueryClient();
  const [screen, setScreen] = useState<Screen>({ name: "lobby" });

  const go = (s: Screen) => {
    setScreen(s);
    window.scrollTo({ top: 0 });
  };
  const backToLobby = () => {
    qc.invalidateQueries({ queryKey: ["life-lobby"] });
    qc.invalidateQueries({ queryKey: ["life-dex"] });
    qc.invalidateQueries({ queryKey: ["me"] });
    go({ name: "lobby" });
  };

  if (!isLoggedIn) {
    return (
      <div className={styles.page}>
        <div className={styles.center}>
          <p className={styles.muted}>로그인하면 유진을 키울 수 있어요.</p>
          <button type="button" className="btn btn-primary btn-lg" onClick={startLogin}>
            <LogIn size={18} aria-hidden="true" />
            치지직으로 로그인
          </button>
        </div>
      </div>
    );
  }
  if (q.isError && !q.data) {
    const notOpen = (q.error as { body?: { error?: string } })?.body?.error === "not_open";
    return (
      <div className={styles.page}>
        {notOpen ? <p className={styles.center}>아직 준비 중이에요.</p> : <LoadError what="유진 키우기" onRetry={() => q.refetch()} />}
      </div>
    );
  }
  const lobby = q.data;

  return (
    <div className={styles.page}>
      <div className={styles.col}>
        {lobby?.isTest && <div className={styles.testBar}>테스트 모드 · 본인만 보여요 · 포인트가 차감되지 않아요</div>}
        {screen.name === "lobby" && <LobbyView lobby={lobby} onStart={() => go({ name: "birth" })} onResume={(run) => go({ name: "play", run })} onReport={(run) => go({ name: "report", run })} onDex={() => go({ name: "dex" })} />}
        {screen.name === "birth" && lobby && <BirthView lobby={lobby} onBack={() => go({ name: "lobby" })} onStarted={(run) => go({ name: "play", run })} />}
        {screen.name === "play" && lobby && <PlayView key={screen.run.id} lobby={lobby} initial={screen.run} onReport={(run) => go({ name: "report", run })} />}
        {screen.name === "report" && <ReportView run={screen.run} onAgain={backToLobby} onDex={() => go({ name: "dex" })} />}
        {screen.name === "dex" && <DexView onBack={backToLobby} />}
      </div>
    </div>
  );
}

/* ── 공통 ── */
function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
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

function StatGrid({ stats, prev }: { stats: Stats; prev?: Stats | null }) {
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
                {v}
                {d !== 0 && <small className={d > 0 ? styles.up : styles.down}>{d > 0 ? `+${d}` : d}</small>}
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

function worldLabel(run: { worldNo: number | null; id: number }) {
  return run.worldNo ? `No.${run.worldNo}` : `테스트 #${run.id}`;
}

/* ── 로비 ── */
function LobbyView({ lobby, onStart, onResume, onReport, onDex }: {
  lobby: Lobby | undefined; onStart: () => void; onResume: (r: Run) => void; onReport: (r: Run) => void; onDex: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!lobby) return <div className={`skeleton ${styles.heroSkel}`} />;
  const left = lobby.isTest ? null : Math.max(0, lobby.dailyLimit - lobby.usedToday);
  const pct = lobby.dex.total ? Math.round((lobby.dex.got / lobby.dex.total) * 100) : 0;

  async function openRun(id: number) {
    setErr(null);
    try {
      onReport(await fetchRun(id));
    } catch (e) {
      setErr(lifeErrorText(e));
    }
  }
  async function reset() {
    if (!(await confirmDialog("테스트로 키운 유진과 테스트 도감을 전부 지울까요? (실제 기록은 그대로예요)"))) return;
    setBusy(true);
    try {
      await resetLifeTest();
      await qc.invalidateQueries({ queryKey: ["life-lobby"] });
      qc.invalidateQueries({ queryKey: ["life-dex"] });
    } catch (e) {
      setErr(lifeErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className={styles.hero}>
        <Orbit className={styles.heroOrbit} />
        <div className={styles.heroNo}>
          <span>다음 평행세계</span>
          <b className="num">{lobby.isTest ? "TEST" : `No.${lobby.nextWorldNo}`}</b>
        </div>
        <p className={styles.heroDesc}>
          {lobby.isTest ? "테스트용" : `${lobby.nextWorldNo}번째`} 유진이 태어날 준비를 하고 있어요.
          <br />
          어떤 어른이 될지는 보호자님의 선택에 달렸어요.
        </p>
        <div className={styles.heroStats}>
          <div>
            <span>내가 키운 유진</span>
            <b className="num">
              {fmt(lobby.myRuns)}
              <small>명</small>
            </b>
          </div>
          <div>
            <span>오늘 남은 횟수</span>
            <b className="num">{left === null ? "∞" : <>{left}<small> / {lobby.dailyLimit}</small></>}</b>
          </div>
        </div>
        {lobby.playing ? (
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => onResume(lobby.playing!)}>
            {worldLabel(lobby.playing)} 유진 이어서 키우기
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onStart} disabled={left === 0}>
            {left === 0 ? "오늘은 여기까지" : "새 유진 키우기"}
            {left !== 0 && <ArrowRight size={16} aria-hidden="true" />}
          </button>
        )}
      </section>

      <div className={styles.twoUp}>
        <button type="button" className={styles.tile} onClick={onDex}>
          <Ring pct={pct} />
          <div className={styles.tileText}>
            <b>유진 도감</b>
            <span className="num">{pct}% 수집</span>
          </div>
        </button>
        <button type="button" className={styles.tile} onClick={() => lobby.last && openRun(lobby.last.id)} disabled={!lobby.last}>
          <div className={styles.tileText}>
            <span>지난 유진</span>
            <b className={styles.tileTitle}>{lobby.last?.title ?? "아직 없어요"}</b>
          </div>
        </button>
      </div>
      {err && <p className={styles.error}>{err}</p>}

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h3>오늘의 유진들</h3>
          <span className={styles.muted}>
            오늘 <b className="num">{fmt(lobby.todayCount)}</b>명 탄생
          </span>
        </div>
        {lobby.today.length === 0 && <p className={styles.empty}>오늘 태어난 유진이 아직 없어요.</p>}
        <ul className={styles.todayList}>
          {lobby.today.map((t) => (
            <li key={t.id}>
              <span className={`num ${styles.todayNo}`}>{t.worldNo ?? "T"}</span>
              <div>
                <b>{t.title}</b>
                <span>
                  {t.channelName ?? "익명의 보호자"} · {t.age}세
                </span>
              </div>
              {t.special && <span className={styles.chipGold}>특수 엔딩</span>}
            </li>
          ))}
        </ul>
      </section>

      {lobby.isTest && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={busy}>
          <RotateCcw size={14} aria-hidden="true" />
          테스트 기록 초기화
        </button>
      )}
    </>
  );
}

function Orbit({ className }: { className?: string }) {
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

function Ring({ pct, size = 44, stroke = 5 }: { pct: number; size?: number; stroke?: number }) {
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

/* ── 태어날 집 고르기 ── */
function BirthView({ lobby, onBack, onStarted }: { lobby: Lobby; onBack: () => void; onStarted: (r: Run) => void }) {
  const qc = useQueryClient();
  const [pick, setPick] = useState(lobby.houses[0]?.id ?? "poor");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const house = lobby.houses.find((h) => h.id === pick);
  const cost = lobby.isTest ? 0 : (house?.price ?? 0);
  const after = lobby.balance - cost;
  const short = cost > 0 && after < 0;

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const res = await startLife(pick);
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["life-lobby"] });
      onStarted(res.run);
    } catch (e) {
      setErr(lifeErrorText(e));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title="태어날 집 고르기" onBack={onBack} />
      <div className={styles.intro}>
        <h3>
          유진이 어떤 집에서
          <br />
          태어날까요?
        </h3>
        <p>포인트는 시작 조건만 바꿔요. 어느 집에서든 모든 결말이 나올 수 있어요.</p>
      </div>
      <div className={styles.houseList} role="radiogroup" aria-label="태어날 집">
        {lobby.houses.map((h, i) => {
          const sel = h.id === pick;
          const chips = statChips(h.bonus);
          return (
            <button key={h.id} type="button" role="radio" aria-checked={sel} className={`${styles.house} ${sel ? styles.houseSel : ""}`} onClick={() => setPick(h.id)}>
              <span className={styles.houseIcon} aria-hidden="true">
                <HouseIcon tier={i} />
              </span>
              <span className={styles.houseBody}>
                <span className={styles.houseTop}>
                  <b>{h.name}</b>
                  <span className={`num ${styles.housePrice} ${i === lobby.houses.length - 1 ? styles.gold : ""}`}>{h.price ? `${fmt(h.price)} P` : "무료"}</span>
                </span>
                <span className={styles.chips}>
                  {chips.length === 0 && <span className={styles.chip}>보정 없음</span>}
                  {chips.map((c) => (
                    <span key={c.label} className={`${styles.chip} ${c.up ? styles.chipUp : styles.chipDown}`}>
                      {c.label}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <section className={styles.receipt}>
        <div className={styles.rRow}>
          <span>보유 포인트</span>
          <span className="num">{fmt(lobby.balance)} P</span>
        </div>
        <div className={styles.rRow}>
          <span>{house?.name}</span>
          <span className={`num ${cost ? styles.minus : ""}`}>{cost ? `− ${fmt(cost)} P` : lobby.isTest ? "테스트 · 0 P" : "0 P"}</span>
        </div>
        <div className={styles.rLine} />
        <div className={`${styles.rRow} ${styles.rTotal}`}>
          <span>사용 후 잔액</span>
          <span className="num">{fmt(after)} P</span>
        </div>
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={start} disabled={busy || short}>
          {short ? "포인트가 부족해요" : busy ? "태어나는 중…" : "유진 태어나게 하기"}
        </button>
        {err && <p className={styles.error}>{err}</p>}
        <p className={styles.fine}>쓴 포인트는 돌려받지 않아요</p>
      </section>
    </>
  );
}

function HouseIcon({ tier }: { tier: number }) {
  const d = [
    "M4 20V8h16v12M4 8l2-4h12l2 4M9 20v-6h6v6",
    "M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5",
    "M3 11l9-8 9 8M5 9v11h14V9M9 20v-6h6v6M15 7V4h2v5",
    "M5 21V5l7-2 7 2v16M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1M3 21h18",
  ][Math.min(tier, 3)];
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/* ── 진행 ── */
const SPEED_MS: Record<number, number> = { 1: 900, 2: 450, 4: 160 };

function PlayView({ lobby, initial, onReport }: { lobby: Lobby; initial: Run; onReport: (r: Run) => void }) {
  const qc = useQueryClient();
  const [run, setRun] = useState<Run>(initial);
  const [log, setLog] = useState<LogEntry[]>(initial.log);
  const [shown, setShown] = useState(initial.logFrom === 0 && initial.status === "playing" && initial.log.length > 0 ? 1 : initial.log.length);
  const [speed, setSpeed] = useState(2);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [viewStats, setViewStats] = useState<Stats>(initial.stats);
  const [prevStats, setPrevStats] = useState<Stats | null>(null);
  const feed = useRef<HTMLOListElement>(null);

  const drained = shown >= log.length;

  // 기록을 속도에 맞춰 한 줄씩
  useEffect(() => {
    if (drained || paused) return;
    const t = setTimeout(() => setShown((n) => n + 1), SPEED_MS[speed]);
    return () => clearTimeout(t);
  }, [shown, drained, paused, speed]);

  // 다 보여주면 능력치를 최신으로(바뀐 만큼 +/− 표시)
  useEffect(() => {
    if (!drained) return;
    setViewStats((cur) => {
      if (JSON.stringify(cur) !== JSON.stringify(run.stats)) setPrevStats(cur);
      return run.stats;
    });
  }, [drained, run.stats]);

  useEffect(() => {
    const el = feed.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [shown]);

  const age = log[Math.max(0, shown - 1)]?.age ?? 0;
  const stage = lifeStage(age);
  const ended = run.status === "ended";
  const itemsLeft = lobby.itemLimit - run.itemsUsed;

  function merge(next: Run) {
    setLog((cur) => cur.slice(0, next.logFrom).concat(next.log));
    setRun(next);
  }

  async function choose(key: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await chooseLife(run.id, key, log.length);
      merge(res.run);
      setPaused(false);
    } catch (e) {
      setErr(lifeErrorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function onItem(itemId: string, price: number, name: string) {
    if (!lobby.isTest && price > 0 && !(await confirmDialog(`${name}에 ${fmt(price)}P를 쓸까요?`))) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await applyLifeItem(run.id, itemId, log.length);
      merge(res.run);
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      setErr(lifeErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  const visible = log.slice(0, shown);

  return (
    <>
      <div className={styles.playHead}>
        <div className={styles.ageBox}>
          <span>
            {worldLabel(run)} 유진{run.jobName ? ` · ${run.jobName}` : ""}
          </span>
          <b>
            <span className="num">{age}</span>
            <small>세</small>
          </b>
        </div>
        <div className={styles.speed} role="group" aria-label="진행 속도">
          {[1, 2, 4].map((s) => (
            <button key={s} type="button" className={`num ${speed === s ? styles.speedOn : ""}`} onClick={() => setSpeed(s)} aria-pressed={speed === s}>
              {s}x
            </button>
          ))}
        </div>
        <button type="button" className={styles.iconBtn} onClick={() => setPaused((p) => !p)} aria-label={paused ? "계속" : "일시정지"} disabled={drained}>
          {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
        </button>
        <button type="button" className={styles.iconBtn} onClick={() => setShown(log.length)} aria-label="건너뛰기" disabled={drained}>
          <FastForward size={15} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.stages}>
        <div className={styles.stageBars}>
          {STAGES.map((_, i) => (
            <span key={i} className={i < stage ? styles.stageDone : i === stage ? styles.stageNow : ""} />
          ))}
        </div>
        <div className={styles.stageLabels}>
          {STAGES.map((s, i) => (
            <span key={s} className={i === stage ? styles.stageLabelNow : ""}>
              {s}
            </span>
          ))}
        </div>
      </div>

      <section className={styles.card}>
        <StatGrid stats={viewStats} prev={drained ? prevStats : null} />
      </section>

      <ol className={styles.feed} ref={feed} aria-live="polite">
        {visible.map((e, i) => {
          const last = i === visible.length - 1;
          return (
            <li key={i} className={`${styles.entry} ${last ? styles.entryNow : ""} ${e.kind === "rare" ? styles.entryRare : ""}`}>
              <span className={styles.dot} aria-hidden="true" />
              <div>
                <div className={styles.entryMeta}>
                  <span className="num">{e.age}세</span>
                  {e.kind === "rare" && <span className={styles.rareTag}>희귀</span>}
                  {e.delta && <span className={styles.delta}>{e.delta}</span>}
                </div>
                <p>{e.text}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {drained && run.pending && !ended && (
        <section className={styles.sheet}>
          <div className={styles.sheetHead}>
            <span className={styles.forkTag}>
              <GitFork size={12} aria-hidden="true" />
              갈림길
            </span>
            <span className={styles.muted}>{age}세 · 보호자의 선택</span>
          </div>
          <p className={styles.sheetText}>{run.pending.text}</p>
          <div className={styles.choices}>
            {run.pending.choices.map((c) => (
              <button key={c.key} type="button" className={styles.choice} onClick={() => choose(c.key)} disabled={busy}>
                <span className={`num ${styles.choiceKey}`}>{c.key}</span>
                <span className={styles.choiceText}>{c.text}</span>
                <span className={styles.choiceHint}>{c.hint}</span>
              </button>
            ))}
          </div>
          <div className={styles.items}>
            <span className={styles.muted}>
              보호자 아이템 <b className="num">{itemsLeft}</b>/{lobby.itemLimit}
            </span>
            {lobby.items.map((it) => (
              <button key={it.id} type="button" className={styles.itemBtn} onClick={() => onItem(it.id, it.price, it.name)} disabled={busy || itemsLeft <= 0}>
                {it.name}
                <span className="num">{lobby.isTest ? "0" : fmt(it.price)}</span>
              </button>
            ))}
          </div>
          {err && <p className={styles.error}>{err}</p>}
        </section>
      )}

      {drained && ended && (
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => onReport(run)}>
          인생 리포트 보기
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      )}
      {drained && !run.pending && !ended && <p className={styles.center}>다음 해로 넘어가는 중…</p>}
    </>
  );
}

/* ── 인생 리포트 ── */
function ReportView({ run, onAgain, onDex }: { run: Run; onAgain: () => void; onDex: () => void }) {
  const e = run.ending;
  const jobs = run.jobHistory;
  if (!e) return <p className={styles.center}>아직 끝나지 않은 인생이에요.</p>;
  const special = !!e.specialId;
  return (
    <>
      <TopBar title="인생 리포트" right={<span className={`num ${styles.muted}`}>{worldLabel(run)}</span>} />
      <section className={`${styles.endCard} ${special ? styles.endSpecial : ""}`}>
        <Orbit className={styles.endOrbit} />
        <span className={styles.endPre}>{e.age}세에 생을 마친 유진은</span>
        {special ? (
          <>
            <span className={styles.chipGold}>특수 엔딩</span>
            <b className={styles.endTitle}>{e.title}</b>
            <span className={styles.endFinale}>{e.specialText}</span>
          </>
        ) : (
          <>
            {e.modifier && <span className={styles.endMod}>{e.modifier}</span>}
            <b className={styles.endTitle}>{e.job} 유진</b>
            <span className={styles.endFinale}>{e.finale}</span>
          </>
        )}
      </section>

      <div className={styles.triple}>
        <div>
          <span>수명</span>
          <b className="num">
            {e.age}
            <small>세</small>
          </b>
        </div>
        <div>
          <span>거친 직업</span>
          <b className="num">
            {jobs.length}
            <small>개</small>
          </b>
        </div>
        <div>
          <span>태어난 집</span>
          <b>{run.houseName}</b>
        </div>
      </div>

      {jobs.length > 0 && (
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>직업 이력</h3>
          <ol className={styles.jobLine}>
            {jobs.map((j, i) => (
              <li key={`${j.id}-${i}`} className={i === jobs.length - 1 ? styles.jobNow : ""}>
                <span className={styles.jobDot} aria-hidden="true" />
                <b>{j.name}</b>
                <span className="num">{j.age}세</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>마지막 능력치</h3>
        <StatGrid stats={run.stats} />
      </section>

      {e.moments.length > 0 && (
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>결정적 순간</h3>
          <ul className={styles.moments}>
            {e.moments.map((m, i) => (
              <li key={i}>
                <span className="num">{m.age}</span>
                <p>{m.text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {run.diary && run.diary.length > 0 && (
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>유진의 일기장</h3>
          <ul className={styles.moments}>
            {run.diary.map((d, i) => (
              <li key={i}>
                <span className="num">{d.age}세</span>
                <p>“{d.text}”</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={styles.letter}>
        <span className={styles.letterAvatar} aria-hidden="true">
          유
        </span>
        <div>
          <span>유진이 보호자님께</span>
          <p>{letterLine(run)}</p>
        </div>
      </div>

      <div className={styles.endBtns}>
        <button type="button" className="btn btn-lg" onClick={onDex}>
          <BookOpen size={16} aria-hidden="true" />
          도감 보기
        </button>
        <button type="button" className="btn btn-primary btn-lg" onClick={onAgain}>
          다시 키우기
        </button>
      </div>
    </>
  );
}

function letterLine(run: Run) {
  const s = run.stats;
  if (run.ending?.cause === "death_accident") return "너무 일찍 떠나서 미안해요. 그래도 보호자님 덕분에 행복했어요.";
  if (s.happy >= 75) return "보호자님 덕분에 정말 행복한 인생이었어요. 다음 평행세계에서도 잘 부탁해요.";
  if (s.happy <= 35) return "쉽지 않은 인생이었지만, 끝까지 곁에 있어줘서 고마워요.";
  return "보호자님 덕분에 꽤 괜찮은 인생이었어요. 다음 평행세계에서도 잘 부탁해요.";
}

/* ── 도감 ── */
type DexTab = "jobs" | "modifiers" | "events" | "specials";
const TABS: { key: DexTab; label: string }[] = [
  { key: "jobs", label: "직업" },
  { key: "modifiers", label: "수식어" },
  { key: "events", label: "희귀 이벤트" },
  { key: "specials", label: "특수 엔딩" },
];

function DexView({ onBack }: { onBack: () => void }) {
  const q = useLifeDex(true);
  const [tab, setTab] = useState<DexTab>("jobs");
  const d = q.data;
  const counts = useMemo(() => {
    const c = (a: DexEntry[] = []) => ({ got: a.filter((x) => x.gotAt).length, total: a.length });
    return { jobs: c(d?.jobs), modifiers: c(d?.modifiers), events: c(d?.events), specials: c(d?.specials) };
  }, [d]);
  const total = Object.values(counts).reduce((s, c) => s + c.total, 0);
  const got = Object.values(counts).reduce((s, c) => s + c.got, 0);
  const pct = total ? Math.round((got / total) * 100) : 0;

  const groups = useMemo(() => {
    const list = d?.[tab] ?? [];
    if (tab !== "jobs") return [{ name: null as string | null, items: list }];
    const m = new Map<string, DexEntry[]>();
    for (const j of list) m.set(j.category ?? "기타", [...(m.get(j.category ?? "기타") ?? []), j]);
    return [...m.entries()].map(([name, items]) => ({ name, items }));
  }, [d, tab]);

  if (q.isError && !d) return <LoadError what="도감" onRetry={() => q.refetch()} />;

  return (
    <>
      <TopBar title="유진 도감" onBack={onBack} />
      <section className={styles.dexHero}>
        <Ring pct={pct} size={76} stroke={7} />
        <div className={styles.dexCounts}>
          {TABS.map((t) => (
            <div key={t.key}>
              <span>{t.label}</span>
              <b className="num">
                {counts[t.key].got}
                <small>/{counts[t.key].total}</small>
              </b>
            </div>
          ))}
        </div>
      </section>
      <div className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? styles.tabOn : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {!d && <div className={`skeleton ${styles.heroSkel}`} />}
      {groups.map((g) => (
        <section key={g.name ?? "all"} className={styles.dexGroup}>
          {g.name && (
            <div className={styles.dexGroupHead}>
              <h3>{g.name}</h3>
              <span className="num">
                {g.items.filter((x) => x.gotAt).length} / {g.items.length}
              </span>
            </div>
          )}
          <div className={tab === "jobs" ? styles.dexGrid3 : styles.dexGrid2}>
            {g.items.map((x) => (
              <div key={x.id} className={`${styles.dexItem} ${x.gotAt ? "" : styles.dexLocked}`}>
                <span className={styles.dexIcon} aria-hidden="true">
                  {x.gotAt ? tab === "specials" ? <Trophy size={16} /> : <Check size={16} /> : <Lock size={15} />}
                </span>
                <b>{x.gotAt ? x.name : "???"}</b>
                {!x.gotAt && x.hint && <span className={styles.dexHint}>{x.hint}</span>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

