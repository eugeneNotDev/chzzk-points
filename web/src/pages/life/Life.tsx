// 유진 키우기 v3 — 평행세계의 유진을 키우는 인생 게임(테스트 버전, 베타 빌드 전용).
// 화면 흐름: 로비 → 태어날 집 고르기(포인트) → 진행(해마다 이야기·주사위 갈림길·올해의 초점·사람·돈쓰기) → 인생 리포트, 그리고 도감.
// 인생 진행·결과는 전부 서버(life-game)가 정하고, 화면은 받은 기록을 속도에 맞춰 한 해씩 보여주기만 함.
// 넓은 화면에선 3단(상태·돈 / 올해 이야기·선택 / 초점·사람·쇼핑), 좁아지면 2단 → 1단으로 쌓임(컨테이너 폭 기준).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, Baby, BookOpen, Briefcase, Check, Coins, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, Dog,
  Flower2, GitFork, GraduationCap, Heart, HeartPulse, Lock, LogIn, MessageCircle, Pause, Play, RotateCcw, ShoppingBag,
  SkipForward, Sparkles, X, Sprout, Star, Stethoscope, Target, TrendingDown, TrendingUp, Trophy, UserRound, Users, Wallet,
  type LucideIcon,
} from "lucide-react";
import { startLogin, useAuth } from "../../lib/auth";
import { confirmDialog } from "../../lib/dialog";
import { fmt } from "../../lib/format";
import { LoadError } from "../../components/LoadError";
import {
  STAGES, STATS, TIER_LABEL, advanceLife, buyLife, chooseLife, fetchRun, focusLife, fundLife, histStats, lifeErrorText, lifeStage,
  josa, resetLifeTest, startLife, statChips, useLifeDex, useLifeLobby, won,
  type DexEntry, type Lobby, type LogEntry, type Pending, type PendingOpt, type Person, type Roll, type Run, type Stats,
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
      {lobby?.isTest && <div className={styles.testBar}>테스트 모드 · 본인만 보여요 · 포인트가 차감되지 않아요</div>}
      {screen.name === "lobby" && <LobbyView lobby={lobby} onStart={() => go({ name: "birth" })} onResume={(run) => go({ name: "play", run })} onReport={(run) => go({ name: "report", run })} onDex={() => go({ name: "dex" })} />}
      {screen.name === "birth" && lobby && <BirthView lobby={lobby} onBack={() => go({ name: "lobby" })} onStarted={(run) => go({ name: "play", run })} />}
      {screen.name === "play" && lobby && <PlayView key={screen.run.id} lobby={lobby} initial={screen.run} onReport={(run) => go({ name: "report", run })} onExit={backToLobby} />}
      {screen.name === "report" && <ReportView run={screen.run} onAgain={backToLobby} onDex={() => go({ name: "dex" })} />}
      {screen.name === "dex" && <DexView onBack={backToLobby} />}
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

const worldLabel = (run: { worldNo: number | null; id: number }) => (run.worldNo ? `No.${run.worldNo}` : `테스트 #${run.id}`);
const DIE: LucideIcon[] = [Dice1, Dice2, Dice3, Dice4, Dice5, Dice6];
function Die({ n, size = 22, className }: { n: number; size?: number; className?: string }) {
  const Icon = DIE[Math.max(1, Math.min(6, n)) - 1];
  return <Icon size={size} className={className} aria-hidden="true" />;
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
    <div className={styles.lobby}>
      <div className={styles.lobbyMain}>
        <section className={styles.hero}>
          <Orbit className={styles.heroOrbit} />
          <div className={styles.heroNo}>
            <span>다음 평행세계</span>
            <b className="num">{lobby.isTest ? "TEST" : `No.${lobby.nextWorldNo}`}</b>
          </div>
          <p className={styles.heroDesc}>
            {lobby.isTest ? "테스트용" : `${lobby.nextWorldNo}번째`} 유진이 태어날 준비를 하고 있어요.
            <br />
            주사위와 선택으로 유진의 인생을 함께 굴려 주세요.
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
            <div>
              <span>한 판 포인트 구매</span>
              <b className="num">
                {lobby.itemLimit}
                <small>번</small>
              </b>
            </div>
          </div>
          {lobby.playing ? (
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => onResume(lobby.playing!)}>
              {worldLabel(lobby.playing)} 유진 이어서 키우기 · {lobby.playing.age}세
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
              <span className="num">
                {lobby.dex.got} / {lobby.dex.total} · {pct}%
              </span>
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
      </div>

      <div className={styles.lobbySide}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h3>오늘의 유진들</h3>
            <span className={styles.muted}>
              오늘 <b className="num">{fmt(lobby.todayCount)}</b>명 탄생
            </span>
          </div>
          {lobby.today.length === 0 && <p className={styles.empty}>오늘 생을 마친 유진이 아직 없어요.</p>}
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
        <section className={`${styles.card} ${styles.howTo}`}>
          <h3 className={styles.cardTitle}>이렇게 굴러가요</h3>
          <ul>
            <li>
              <Target size={15} aria-hidden="true" />
              <span>
                <b>올해의 초점</b>을 언제든 바꿀 수 있어요. 다음 해부터 반영돼요.
              </span>
            </li>
            <li>
              <Dice5 size={15} aria-hidden="true" />
              <span>
                중요한 선택은 <b>주사위 두 개 + 능력치 보정</b>으로 대성공~대실패가 갈려요.
              </span>
            </li>
            <li>
              <Wallet size={15} aria-hidden="true" />
              <span>
                15세부터 유진의 돈으로 <b>돈쓰기</b>를 할 수 있어요. 포인트로도 사줄 수 있어요(1만원 = 1P).
              </span>
            </li>
            <li>
              <Users size={15} aria-hidden="true" />
              <span>
                가족·친구·연인과의 <b>사이</b>가 인생을 바꿔요.
              </span>
            </li>
          </ul>
        </section>
        {lobby.isTest && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={busy}>
            <RotateCcw size={14} aria-hidden="true" />
            테스트 기록 초기화
          </button>
        )}
      </div>
    </div>
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
    <div className={styles.birth}>
      <div className={styles.birthMain}>
        <TopBar title="태어날 집 고르기" onBack={onBack} />
        <div className={styles.intro}>
          <h3>유진이 어떤 집에서 태어날까요?</h3>
          <p>집에 따라 용돈·등록금 지원·물려받을 재산이 달라져요. 어느 집에서든 모든 결말이 나올 수 있어요.</p>
        </div>
        <div className={styles.houseList} role="radiogroup" aria-label="태어날 집">
          {lobby.houses.map((h, i) => {
            const sel = h.id === pick;
            const chips = statChips(h.bonus);
            return (
              <button key={h.id} type="button" role="radio" aria-checked={sel} className={`${styles.house} ${sel ? styles.houseSel : ""}`} onClick={() => setPick(h.id)}>
                <span className={styles.houseTop}>
                  <span className={styles.houseIcon} aria-hidden="true">
                    <HouseIcon tier={i} />
                  </span>
                  <b>{h.name}</b>
                  <span className={`num ${styles.housePrice} ${i === lobby.houses.length - 1 ? styles.gold : ""}`}>{h.price ? `${fmt(h.price)} P` : "무료"}</span>
                </span>
                <span className={styles.houseFacts}>
                  <span>
                    용돈 <b className="num">연 {won(h.allowance)}</b>
                  </span>
                  <span>
                    등록금 지원 <b className="num">{Math.round(h.tuition * 100)}%</b>
                  </span>
                  <span>
                    물려받을 재산 <b className="num">{h.inherit ? `약 ${won(h.inherit, true)}` : "거의 없음"}</b>
                  </span>
                </span>
                <span className={styles.chips}>
                  {chips.length === 0 && <span className={styles.chip}>능력치 보정 없음</span>}
                  {chips.map((c) => (
                    <span key={c.label} className={`${styles.chip} ${c.up ? styles.chipUp : styles.chipDown}`}>
                      {c.label}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <section className={styles.receipt}>
        <h3 className={styles.cardTitle}>영수증</h3>
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
    </div>
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
// 한 해를 보여주는 시간(1배속). 평균 수명(약 77세)·결정 50번 기준으로 한 인생이 30분쯤 걸리게 맞춤.
// 그해 기록은 앞쪽 70% 동안 고르게 나눠서 하나씩 보여주고, 나머지 시간은 머묾. 배속으로 나눔. "skip"은 다음 결정까지 빨리 감기
const YEAR_MS = 13000;
const SPEEDS = [
  { k: 1, label: "1x", hint: "한 인생 약 30분" },
  { k: 2, label: "2x", hint: "약 15분" },
  { k: 4, label: "4x", hint: "약 8분" },
  { k: 8, label: "8x", hint: "약 4분" },
];
const RESULT_MS = 7000; // 선택 결과를 보여주고 저절로 넘어가기까지

const KIND_ICON: Record<LogEntry["k"], LucideIcon> = {
  life: Sprout, day: Sparkles, rare: Star, fork: GitFork, pick: GitFork, job: Briefcase, money: Coins, people: Users, buy: ShoppingBag,
  think: MessageCircle, sick: Stethoscope, end: Flower2, school: GraduationCap,
};
const ROLE_LABEL: Record<Person["role"], string> = { mom: "엄마", dad: "아빠", friend: "친구", partner: "연인", spouse: "배우자", child: "자녀", pet: "반려견" };
const ROLE_ICON: Record<Person["role"], LucideIcon> = { mom: UserRound, dad: UserRound, friend: Users, partner: Heart, spouse: Heart, child: Baby, pet: Dog };

function DeltaChips({ d, m }: { d?: Partial<Stats>; m?: number }) {
  const list = d ? STATS.filter((s) => typeof d[s.key] === "number" && d[s.key] !== 0) : [];
  if (list.length === 0 && !m) return null;
  return (
    <span className={styles.dchips}>
      {list.map((s) => {
        const v = d![s.key]!;
        return (
          <span key={s.key} className={`${styles.dchip} ${v > 0 ? styles.dUp : styles.dDown}`}>
            {s.label} {v > 0 ? `+${v}` : `−${Math.abs(v)}`}
          </span>
        );
      })}
      {!!m && <span className={`${styles.dchip} ${m > 0 ? styles.dMoney : styles.dDown}`}>{m > 0 ? "+" : ""}{won(m)}</span>}
    </span>
  );
}

function RollChip({ r }: { r: Roll }) {
  return (
    <span className={`${styles.rollChip} ${styles[`t_${r.tier}`]}`}>
      <Die n={r.dice[0]} size={14} />
      <Die n={r.dice[1]} size={14} />
      <span className="num">
        {r.mod !== 0 && (r.mod > 0 ? `+${r.mod} ` : `${r.mod} `)}= {r.total}
      </span>
      <b>{TIER_LABEL[r.tier]}</b>
    </span>
  );
}

function EntryIcon({ k }: { k: LogEntry["k"] }) {
  const Icon = KIND_ICON[k] ?? Sparkles;
  return (
    <span className={`${styles.kindIcon} ${styles[`k_${k}`] ?? ""}`} aria-hidden="true">
      <Icon size={16} />
    </span>
  );
}

// 선택 결과 창: 주사위 선택이면 던지기 → 결과, 그냥 선택이면 바로 결과(plain)
type Rolling = { opt: PendingOpt; text: string; phase: "ready" | "rolling" | "done"; roll?: Roll | null; result?: LogEntry | null; t0?: number; plain?: boolean };

function PlayView({ lobby, initial, onReport, onExit }: { lobby: Lobby; initial: Run; onReport: (r: Run) => void; onExit: () => void }) {
  const qc = useQueryClient();
  const [run, setRun] = useState<Run>(initial);
  const [log, setLog] = useState<LogEntry[]>(initial.log);
  const fresh = initial.hist.length <= 4; // 막 태어난 판은 처음부터 보여줌
  const [cur, setCur] = useState(() => (fresh ? 0 : Math.max(0, initial.hist.length - 1)));
  const [shown, setShown] = useState(() => (fresh ? 0 : 999));
  const yearStart = useRef(Date.now()); // 지금 보여주는 해가 시작된 시각(멈춘 시간만큼 뒤로 밀림)
  const [snap, setSnap] = useState<Run>(initial); // 화면이 따라잡은 시점의 상태(돈·사람·직업 등)
  const [speed, setSpeed] = useState<number>(1);
  const [skip, setSkip] = useState(false);
  const [paused, setPaused] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [rolling, setRolling] = useState<Rolling | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wantFocus, setWantFocus] = useState<string | null>(null);
  const [balance, setBalance] = useState(lobby.balance); // 포인트 잔액(후원·포인트 구매 뒤 서버가 준 값으로 갱신)
  const runRef = useRef(run);
  runRef.current = run;

  const rows = run.hist.length > 0 ? run.hist : [[run.age, 50, 50, 50, 50, 50, 0, 3]];
  const last = rows.length - 1;
  const ci = Math.min(cur, last);
  const row = rows[ci];
  const age = row[0];
  const yearEntries = useMemo(() => log.filter((e) => e.age === age), [log, age]);
  const nShown = Math.min(shown, yearEntries.length);
  const drained = ci >= last && nShown >= yearEntries.length;
  const stats = histStats(row, run.stats);
  const prevStats = ci > 0 ? histStats(rows[ci - 1], stats) : null;
  const k = skip ? 40 : speed;
  const yearMs = YEAR_MS / k;
  const ended = run.status === "ended";
  const pending = drained && !ended && !rolling ? run.pending : null;

  // 따라잡으면 상태 스냅샷 갱신
  useEffect(() => {
    if (drained) setSnap(run);
  }, [drained, run]);

  // 한 줄씩 보여주기 → 한 해 넘기기
  const halt = paused || shopOpen;
  const stopped = halt || !!rolling;
  // 멈춰 있던 시간만큼 이번 해 시작 시각을 뒤로 밀어서, 다시 움직이면 멈춘 자리부터 이어감
  const stoppedAt = useRef<number | null>(null);
  useEffect(() => {
    if (stopped) stoppedAt.current = Date.now();
    else if (stoppedAt.current !== null) {
      yearStart.current += Date.now() - stoppedAt.current;
      stoppedAt.current = null;
    }
  }, [stopped]);
  useEffect(() => {
    if (stopped) return;
    const n = yearEntries.length;
    const gap = Math.min(4500 / k, (yearMs * 0.7) / Math.max(1, n));
    if (nShown < n) {
      const due = yearStart.current + 500 / k + nShown * gap;
      const t = setTimeout(() => setShown(nShown + 1), Math.max(0, due - Date.now()));
      return () => clearTimeout(t);
    }
    if (ci < last) {
      const t = setTimeout(() => {
        setCur(ci + 1);
        setShown(0);
        yearStart.current = Date.now();
      }, Math.max(0, yearStart.current + yearMs - Date.now()));
      return () => clearTimeout(t);
    }
  }, [stopped, nShown, yearEntries.length, ci, last, k, yearMs]);

  function merge(next: Run) {
    setLog((c) => c.slice(0, next.logFrom).concat(next.log));
    setRun(next);
  }

  // 다 보여줬고 결정도 없으면 다음 해 받아오기
  useEffect(() => {
    if (!drained || halt || rolling || ended || run.pending || fetching || busy || err) return;
    let alive = true;
    setFetching(true);
    const years = skip ? 3 : speed >= 8 ? 3 : speed >= 4 ? 2 : 1;
    const go = async () => {
      try {
        const r = runRef.current;
        // 바꿔 둔 초점이 있으면 먼저 보냄(나이대가 바뀌어 못 쓰는 초점이면 그냥 버림)
        if (wantFocus && wantFocus !== r.focus) {
          const ok = r.focuses.some((f) => f.id === wantFocus);
          setWantFocus(null);
          if (ok) await focusLife(r.id, wantFocus, log.length).then((res) => alive && merge(res.run)).catch(() => {});
        }
        const res = await advanceLife(r.id, log.length, years);
        if (alive) merge(res.run);
      } catch (e) {
        if (alive) setErr(lifeErrorText(e));
      } finally {
        if (alive) setFetching(false);
      }
    };
    go();
    return () => {
      alive = false;
      setFetching(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drained, halt, rolling, ended, run.pending, busy, err]);

  // 결정이 나오면 빨리 감기 끝
  useEffect(() => {
    if (pending && skip) setSkip(false);
  }, [pending, skip]);

  async function choose(o: PendingOpt) {
    if (o.off || busy) return;
    if (o.roll !== undefined) {
      setRolling({ opt: o, text: run.pending?.text ?? "", phase: "ready" });
      return;
    }
    if (o.pts) {
      if (!run.isTest && balance < o.pts) return;
      if (!run.isTest && !(await confirmDialog(`${fmt(o.pts)}P를 후원할까요? 후원한 포인트는 돌려받을 수 없어요.`))) return;
    }
    setBusy(true);
    setErr(null);
    const text = run.pending?.text ?? "";
    try {
      const res = await chooseLife(run.id, o.key, log.length);
      merge(res.run);
      if (typeof res.balance === "number") setBalance(res.balance);
      if (o.pts) {
        qc.invalidateQueries({ queryKey: ["me"] });
        qc.invalidateQueries({ queryKey: ["life-lobby"] });
      }
      // 결과를 선택했던 자리에서 바로 보여줌(아래로 안 내려가도 되게)
      const result = res.run.log.find((e) => e.k !== "pick") ?? null;
      setRolling({ opt: o, text, phase: "done", roll: null, result, plain: true });
    } catch (e) {
      setErr(lifeErrorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function throwDice() {
    if (!rolling || rolling.phase !== "ready") return;
    const t0 = Date.now();
    setRolling({ ...rolling, phase: "rolling", t0 });
    setBusy(true);
    setErr(null);
    try {
      const res = await chooseLife(run.id, rolling.opt.key, log.length);
      const wait = Math.max(0, 1100 - (Date.now() - t0));
      setTimeout(() => {
        merge(res.run);
        const result = res.run.log.find((e) => e.roll) ?? null;
        setRolling((r) => (r ? { ...r, phase: "done", roll: res.roll, result } : r));
        setBusy(false);
      }, wait);
    } catch (e) {
      setErr(lifeErrorText(e));
      setRolling(null);
      setBusy(false);
    }
  }
  const closeRoll = useCallback(() => {
    setRolling(null);
    // 결과 줄은 결과 창에서 이미 봤으니 바로 펼침
    setShown(999);
    yearStart.current = Date.now() - yearMs * 0.6;
  }, [yearMs]);

  async function onFocus(id: string) {
    if (fetching || busy) {
      setWantFocus(id); // 다음 해 받아올 때 같이 보냄
      return;
    }
    setWantFocus(null);
    try {
      const res = await focusLife(run.id, id, log.length);
      merge(res.run);
      setSnap(res.run);
    } catch {
      // 초점 바꾸기 실패는 조용히 넘김(진행은 계속)
    }
  }
  async function onFund(id: string) {
    if (busy || fetching) return;
    setBusy(true);
    try {
      const res = await fundLife(run.id, id, log.length);
      merge(res.run);
      setSnap(res.run);
    } catch (e) {
      setErr(lifeErrorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function onBuy(itemId: string, pay: "cash" | "points", name: string, price: number) {
    if (busy || fetching) return;
    if (pay === "points" && !run.isTest && !(await confirmDialog(`${josa(name, "을")} ${fmt(price)}P로 사줄까요?`))) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await buyLife(run.id, itemId, pay, log.length);
      merge(res.run);
      setSnap(res.run);
      setShown(999);
      if (typeof res.balance === "number") setBalance(res.balance);
      if (pay === "points") qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      setErr(lifeErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  const stage = lifeStage(age);
  const view = snap;
  const timeline = useMemo(() => log.filter((e) => e.age < age && e.k !== "pick").slice(-80).reverse(), [log, age]);
  const visibleNow = yearEntries.slice(0, nShown);
  const luck = row[7] ?? 3;
  const canShop = ci >= last && !rolling && !ended && !fetching;
  function openShop() {
    // 상점을 열면 그 해를 다 보여주고 멈춤
    setCur(last);
    setShown(999);
    yearStart.current = Date.now() - yearMs * 0.6;
    setShopOpen(true);
  }

  return (
    <div className={styles.play}>
      {/* 머리줄 */}
      <header className={styles.playHead}>
        <div className={styles.ageBox}>
          <span>
            {worldLabel(run)} 유진 · {view.houseName}
          </span>
          <b>
            <span className="num" key={age}>
              {age}
            </span>
            <small>세</small>
          </b>
        </div>
        <div className={styles.stageWrap}>
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
        <div className={styles.controls}>
          <div className={styles.speed} role="group" aria-label="진행 속도">
            {SPEEDS.map((sp) => (
              <button key={sp.k} type="button" title={sp.hint} className={`num ${speed === sp.k && !skip ? styles.speedOn : ""}`} onClick={() => { setSpeed(sp.k); setSkip(false); }} aria-pressed={speed === sp.k && !skip}>
                {sp.label}
              </button>
            ))}
          </div>
          <button type="button" className={styles.iconBtn} onClick={() => setPaused((p) => !p)} aria-label={paused ? "계속" : "일시정지"} disabled={ended}>
            {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          </button>
          <button type="button" className={`${styles.skipBtn} ${skip ? styles.skipOn : ""}`} onClick={() => { setSkip((v) => !v); setPaused(false); }} disabled={ended || !!pending}>
            <SkipForward size={15} aria-hidden="true" />
            다음 결정까지
          </button>
        </div>
      </header>

      {/* 왼쪽: 상태·돈 */}
      <aside className={styles.side}>
        <section className={styles.card}>
          <div className={styles.statusRow}>
            <span className={styles.statusChip}>
              {view.job ? <Briefcase size={13} aria-hidden="true" /> : <GraduationCap size={13} aria-hidden="true" />}
              {view.jobName ?? view.school}
            </span>
            {view.focusName && (
              <span className={`${styles.statusChip} ${styles.statusFocus}`}>
                <Target size={13} aria-hidden="true" />
                {view.focusName}
              </span>
            )}
            {view.sick && (
              <span className={`${styles.statusChip} ${styles.statusSick}`}>
                <HeartPulse size={13} aria-hidden="true" />
                {view.sick.name}
              </span>
            )}
            {view.fame > 0 && (
              <span className={styles.statusChip}>
                <Star size={13} aria-hidden="true" />
                인지도 <b className="num">{view.fame}</b>
              </span>
            )}
          </div>
          <StatGrid stats={stats} prev={prevStats} />
        </section>
        <MoneyCard run={view} net={row[6] ?? view.money.net} rows={rows.slice(0, ci + 1)} />
      </aside>

      {/* 가운데: 올해 이야기·선택·지난 기록 */}
      <main className={styles.center2}>
        <section className={`${styles.year} ${skip ? styles.yearSkip : ""}`} aria-live="polite">
          {!pending && !ended && (
            <span
              key={`${age}-${k}`}
              className={styles.yearBar}
              style={{ animationDuration: `${yearMs}ms`, animationPlayState: stopped ? "paused" : "running" }}
              aria-hidden="true"
            />
          )}
          <div className={styles.yearHead}>
            <span>
              <b className="num">{age}</b>세의 유진
            </span>
            <span className={styles.luck} title="올해의 운 — 높을수록 좋은 일이 잘 생겨요">
              올해의 운
              <Die n={luck} size={20} className={luck >= 5 ? styles.luckGood : luck <= 2 ? styles.luckBad : ""} />
            </span>
          </div>
          {visibleNow.length === 0 ? (
            <p className={styles.yearQuiet}>{yearEntries.length === 0 ? "별일 없이 한 해가 지나갔다." : "…"}</p>
          ) : (
            <ul className={styles.yearList}>
              {visibleNow.map((e, i) =>
                e.k === "pick" ? (
                  <li key={`${age}-${i}`} className={styles.pickLine}>
                    <GitFork size={13} aria-hidden="true" />
                    {e.t.split(" → ").slice(-1)[0]}
                  </li>
                ) : (
                  <li key={`${age}-${i}`} className={`${styles.yearItem} ${e.k === "rare" ? styles.yearRare : ""} ${e.hl ? styles.yearHl : ""}`}>
                    <EntryIcon k={e.k} />
                    <div>
                      {e.k === "rare" && <span className={styles.rareTag}>희귀 이벤트</span>}
                      <p>{e.t}</p>
                      <span className={styles.metaRow}>
                        {e.roll && <RollChip r={e.roll} />}
                        <DeltaChips d={e.d} m={e.m} />
                      </span>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </section>

        {rolling && <DicePanel rolling={rolling} onThrow={throwDice} onClose={closeRoll} />}

        {pending && <DecisionSheet pending={pending} age={age} busy={busy} onPick={choose} cash={view.money.cash + view.money.invest} points={run.isTest ? null : balance} />}

        {err && (
          <div className={styles.errBox}>
            <span>{err}</span>
            <button type="button" className="btn btn-sm" onClick={() => setErr(null)}>
              다시 시도
            </button>
          </div>
        )}

        {drained && ended && (
          <section className={styles.endNotice}>
            <Flower2 size={22} aria-hidden="true" />
            <p>{run.ending?.title}</p>
            <button type="button" className="btn btn-primary btn-lg" onClick={() => onReport({ ...run, log })}>
              인생 리포트 보기
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </section>
        )}

      </main>

      {/* 오른쪽: 초점·사람·돈쓰기 */}
      <aside className={styles.rail}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h3>올해의 초점</h3>
            <span className={styles.muted}>다음 해부터 반영</span>
          </div>
          <div className={styles.focusGrid}>
            {view.focuses.map((f) => {
              const on = (wantFocus ?? view.focus) === f.id;
              return (
                <button key={f.id} type="button" className={`${styles.focusBtn} ${on ? styles.focusOn : ""}`} onClick={() => onFocus(f.id)} disabled={ended} aria-pressed={on}>
                  <b>{f.name}</b>
                  <span>{f.hint}</span>
                </button>
              );
            })}
          </div>
        </section>

        <PeopleCard people={view.people} />

        <ShopCard run={view} lobby={lobby} busy={busy || fetching} onOpen={openShop} onFund={onFund} />

        <button type="button" className="btn btn-ghost btn-sm" onClick={onExit}>
          <ArrowLeft size={14} aria-hidden="true" />
          로비로 (진행 상황은 저장돼요)
        </button>
      </aside>
      <Feed items={timeline} className={styles.feedArea} />
      {shopOpen && <ShopModal run={run} balance={balance} canShop={canShop} busy={busy || fetching} onBuy={onBuy} onClose={() => setShopOpen(false)} />}
    </div>
  );
}

function Feed({ items, className }: { items: LogEntry[]; className: string }) {
  if (items.length === 0) return null;
  return (
    <section className={`${styles.card} ${className}`}>
      <h3 className={styles.cardTitle}>지난 이야기</h3>
      <ol className={styles.feed}>
        {items.map((e, i) => (
          <li key={i} className={`${styles.entry} ${e.k === "rare" ? styles.entryRare : ""} ${e.hl ? styles.entryHl : ""}`}>
            <span className={`num ${styles.entryAge}`}>{e.age}</span>
            <div>
              <p>{e.t}</p>
              {(e.roll || e.d || e.m) && (
                <span className={styles.metaRow}>
                  {e.roll && <RollChip r={e.roll} />}
                  <DeltaChips d={e.d} m={e.m} />
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function MoneyCard({ run, net, rows }: { run: Run; net: number; rows: number[][] }) {
  const m = run.money;
  const assets = m.assets.reduce((a, x) => a + x.value, 0);
  const pts = rows.map((r) => r[6] ?? 0);
  const minV = Math.min(0, ...pts);
  const maxV = Math.max(1, ...pts);
  const W = 240;
  const H = 44;
  const line = pts.length > 1 ? pts.map((v, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - ((v - minV) / (maxV - minV)) * H).toFixed(1)}`).join(" ") : "";
  const kid = run.age < 15;
  return (
    <section className={styles.card}>
      <div className={styles.moneyHead}>
        <span>
          <Wallet size={14} aria-hidden="true" />
          순자산
        </span>
        <b className={`num ${net < 0 ? styles.down : ""}`}>{won(net)}</b>
      </div>
      {line && (
        <svg className={styles.spark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <polyline points={line} fill="none" stroke="var(--c-gold)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      )}
      {kid ? (
        <p className={styles.moneyNote}>아직 어려서 용돈만 모아요. 15세부터 돈쓰기와 투자가 열려요.</p>
      ) : (
        <dl className={styles.moneyRows}>
          <div>
            <dt>현금</dt>
            <dd className="num">{won(m.cash)}</dd>
          </div>
          <div>
            <dt>투자</dt>
            <dd className="num">
              {won(m.invest)}
              {m.ret !== 0 && (
                <small className={m.ret > 0 ? styles.up : styles.down}>
                  {m.ret > 0 ? <TrendingUp size={11} aria-hidden="true" /> : <TrendingDown size={11} aria-hidden="true" />}
                  {won(Math.abs(m.ret), true)}
                </small>
              )}
            </dd>
          </div>
          {assets > 0 && (
            <div>
              <dt>{m.assets.map((a) => a.name).join("·")}</dt>
              <dd className="num">{won(assets)}</dd>
            </div>
          )}
          {m.debt > 0 && (
            <div>
              <dt>빚</dt>
              <dd className={`num ${styles.down}`}>−{won(m.debt)}</dd>
            </div>
          )}
          <div className={styles.moneySep} />
          <div>
            <dt>지난해 수입</dt>
            <dd className="num">{won(m.income)}</dd>
          </div>
          <div>
            <dt>지난해 지출</dt>
            <dd className="num">{won(m.expense)}</dd>
          </div>
          <div>
            <dt>평생 번 돈</dt>
            <dd className="num">{won(m.earned)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function PeopleCard({ people }: { people: Person[] }) {
  const order: Person["role"][] = ["spouse", "partner", "child", "mom", "dad", "friend", "pet"];
  const list = [...people].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.id - b.id);
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h3>사람들</h3>
        <span className={styles.muted}>{list.filter((p) => p.alive).length}명</span>
      </div>
      <ul className={styles.people}>
        {list.map((p) => {
          const Icon = ROLE_ICON[p.role];
          return (
            <li key={p.id} className={p.alive ? "" : styles.gone}>
              <span className={`${styles.personIcon} ${styles[`r_${p.role}`] ?? ""}`} aria-hidden="true">
                <Icon size={15} />
              </span>
              <div className={styles.personBody}>
                <span className={styles.personTop}>
                  <b>{p.role === "mom" || p.role === "dad" ? ROLE_LABEL[p.role] : p.name}</b>
                  <span>
                    {p.role === "mom" || p.role === "dad" ? "" : `${ROLE_LABEL[p.role]} · `}
                    {p.alive ? `${p.age}세` : "곁을 떠남"}
                  </span>
                </span>
                {p.alive && (
                  <span className={styles.bond} title={`사이 ${p.bond}`}>
                    <span style={{ width: `${p.bond}%` }} />
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ShopCard({ run, lobby, busy, onOpen, onFund }: {
  run: Run; lobby: Lobby; busy: boolean; onOpen: () => void; onFund: (id: string) => void;
}) {
  const ptsLeft = run.pointsLimit - run.pointsUsed;
  const kid = run.age < 15;
  const ready = run.shop.filter((s) => !s.off).length;
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h3>{kid ? "보호자 지원" : "돈쓰기"}</h3>
        <span className={styles.muted}>
          포인트 <b className="num">{ptsLeft}</b>/{run.pointsLimit}번
        </span>
      </div>
      <button type="button" className={styles.shopOpen} onClick={onOpen}>
        <ShoppingBag size={18} aria-hidden="true" />
        <span>
          <b>{kid ? "보호자가 사주기" : "상점 열기"}</b>
          <small>
            {kid ? "포인트로만 살 수 있어요" : `보유 ${won(run.money.cash + run.money.invest)}`} · 살 수 있는 것 {ready}개
          </small>
        </span>
        <ArrowRight size={16} aria-hidden="true" />
      </button>
      {!kid && (
        <div className={styles.fund}>
          <span className={styles.fundLabel}>여유자금 굴리기</span>
          <div className={styles.fundBtns}>
            {lobby.funds.map((f) => (
              <button key={f.id} type="button" className={run.money.fund === f.id ? styles.fundOn : ""} onClick={() => onFund(f.id)} disabled={busy} title={f.hint}>
                {f.name}
              </button>
            ))}
          </div>
          <span className={styles.fundHint}>{lobby.funds.find((f) => f.id === run.money.fund)?.hint}</span>
        </div>
      )}
    </section>
  );
}

function ShopModal({ run, balance, canShop, busy, onBuy, onClose }: {
  run: Run; balance: number; canShop: boolean; busy: boolean;
  onBuy: (id: string, pay: "cash" | "points", name: string, price: number) => void; onClose: () => void;
}) {
  const cats = useMemo(() => [...new Set(run.shop.map((s) => s.cat))], [run.shop]);
  const [cat, setCat] = useState<string | null>(null);
  const curCat = cat && cats.includes(cat) ? cat : cats[0];
  const items = run.shop.filter((s) => s.cat === curCat);
  const ptsLeft = run.pointsLimit - run.pointsUsed;
  const cash = run.money.cash + run.money.invest;
  const kid = run.age < 15;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className={styles.modalBack} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="돈쓰기" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <div>
            <h3>{kid ? "보호자 지원" : "돈쓰기"}</h3>
            <span className={styles.muted}>
              {run.age}세 · {kid ? "포인트로만" : <>보유 <b className="num">{won(cash)}</b></>} · 포인트 <b className="num">{ptsLeft}</b>/{run.pointsLimit}번
              {!run.isTest && <> · 내 포인트 <b className="num">{fmt(balance)}P</b></>}
            </span>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="닫기">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className={styles.catTabs}>
          {cats.map((c) => (
            <button key={c} type="button" className={c === curCat ? styles.catOn : ""} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        <ul className={styles.shopGrid}>
          {items.map((it) => (
            <li key={it.id} className={it.off ? styles.shopDim : ""}>
              <div className={styles.shopInfo}>
                {it.maxLv !== null && (
                  <span className={styles.tierRow}>
                    <span className={styles.tierDots} aria-label={`${it.lv}/${it.maxLv}단계`}>
                      {Array.from({ length: it.maxLv }, (_, i) => (
                        <i key={i} className={i < (it.lv ?? 0) ? styles.tierOn : ""} />
                      ))}
                    </span>
                    {it.cur ? `지금: ${it.cur}` : "아직 없음"}
                  </span>
                )}
                <b>
                  {it.maxLv !== null && it.cur && !it.off?.startsWith("최고") && <em className={styles.upTag}>업그레이드</em>}
                  {it.name}
                </b>
                <span>{it.hint}</span>
                {it.off && <span className={styles.shopOff}>{it.off}</span>}
              </div>
              <div className={styles.shopBtns}>
                {!it.child && !kid && (
                  <button type="button" className={styles.buyBtn} disabled={!canShop || busy || !!it.off || cash < it.price} onClick={() => onBuy(it.id, "cash", it.name, it.price)}>
                    {won(it.price)}
                  </button>
                )}
                <button type="button" className={`${styles.buyBtn} ${styles.buyPts}`} disabled={!canShop || busy || !!it.off || ptsLeft <= 0 || (!run.isTest && balance < it.price)} onClick={() => onBuy(it.id, "points", it.name, it.price)}>
                  {run.isTest ? "0" : fmt(it.price)}P
                </button>
              </div>
            </li>
          ))}
        </ul>
        <p className={styles.fine}>상점이 열려 있는 동안은 시간이 멈춰요 · 1만원 = 1P</p>
      </div>
    </div>
  );
}

// points: 포인트 잔액(테스트 판이면 null — 포인트가 안 빠짐)
function DecisionSheet({ pending, age, busy, onPick, cash, points }: { pending: Pending; age: number; busy: boolean; onPick: (o: PendingOpt) => void; cash: number; points: number | null }) {
  const tag = pending.kind === "think" ? "생각 남기기" : pending.kind === "focus" ? "인생 마디" : pending.tag ?? "갈림길";
  return (
    <section className={`${styles.sheet} ${pending.kind === "think" ? styles.sheetThink : ""}`}>
      <div className={styles.sheetHead}>
        <span className={styles.forkTag}>
          {pending.kind === "think" ? <MessageCircle size={12} aria-hidden="true" /> : <GitFork size={12} aria-hidden="true" />}
          {tag}
        </span>
        <span className={styles.muted}>{age}세 · 보호자의 선택</span>
      </div>
      <p className={styles.sheetText}>{pending.text}</p>
      <div className={styles.choices}>
        {pending.opts.map((o) => {
          const ptsShort = !!o.pts && points !== null && points < o.pts;
          return (
          <button key={o.key} type="button" className={styles.choice} onClick={() => onPick(o)} disabled={busy || !!o.off || ptsShort}>
            <span className={`num ${styles.choiceKey}`}>{o.key}</span>
            <span className={styles.choiceBody}>
              <span className={styles.choiceText}>{o.text}</span>
              {(o.hint || o.cost || o.pts || o.roll !== undefined) && (
                <span className={styles.choiceMeta}>
                  {o.roll !== undefined && (
                    <span className={styles.choiceDice}>
                      <Dice5 size={12} aria-hidden="true" />
                      {o.mod ? (o.mod > 0 ? `+${o.mod}` : o.mod) : "±0"}
                    </span>
                  )}
                  {o.hint && <span>{o.hint}</span>}
                  {!!o.cost && <span className={o.off ? styles.down : styles.costTag}>−{won(o.cost)}{o.off ? ` · 보유 ${won(cash)}` : ""}</span>}
                  {!!o.pts && (
                    <span className={ptsShort ? styles.down : styles.costTag}>
                      {points === null ? "테스트 · 0P" : `−${fmt(o.pts)}P`}{ptsShort ? ` · 보유 ${fmt(points!)}P` : ""}
                    </span>
                  )}
                </span>
              )}
            </span>
          </button>
          );
        })}
      </div>
    </section>
  );
}

function DicePanel({ rolling, onThrow, onClose }: { rolling: Rolling; onThrow: () => void; onClose: () => void }) {
  const [faces, setFaces] = useState<[number, number]>([3, 5]);
  useEffect(() => {
    if (rolling.phase !== "rolling") return;
    const t = setInterval(() => setFaces([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]), 70);
    return () => clearInterval(t);
  }, [rolling.phase]);
  // 결과가 나오면 잠깐 보여주고 저절로 계속(버튼으로 바로 넘어갈 수도 있음)
  useEffect(() => {
    if (rolling.phase !== "done") return;
    const t = setTimeout(onClose, RESULT_MS);
    return () => clearTimeout(t);
  }, [rolling.phase, onClose]);
  const r = rolling.phase === "done" ? rolling.roll : null;
  const show: [number, number] = r ? r.dice : faces;
  const mod = rolling.opt.mod ?? 0;
  if (rolling.plain) {
    return (
      <section className={styles.dicePanel}>
        <span className={styles.diceQ}>{rolling.text}</span>
        <b className={styles.diceOpt}>{rolling.opt.text}</b>
        {rolling.result && (
          <div className={styles.diceResult}>
            <p>{rolling.result.t}</p>
            <DeltaChips d={rolling.result.d} m={rolling.result.m} />
          </div>
        )}
        <button type="button" className={`btn btn-primary btn-lg ${styles.contBtn}`} onClick={onClose}>
          계속하기
          <span className={styles.contBar} style={{ animationDuration: `${RESULT_MS}ms` }} aria-hidden="true" />
        </button>
      </section>
    );
  }
  return (
    <section className={`${styles.dicePanel} ${r ? styles[`t_${r.tier}`] : ""}`}>
      <span className={styles.diceQ}>{rolling.text}</span>
      <b className={styles.diceOpt}>{rolling.opt.text}</b>
      <div className={`${styles.diceRow} ${rolling.phase === "rolling" ? styles.diceShake : ""}`}>
        <Die n={show[0]} size={56} className={styles.dieBig} />
        <Die n={show[1]} size={56} className={styles.dieBig} />
        <span className={`num ${styles.diceMod}`}>{mod >= 0 ? `+${mod}` : mod}</span>
      </div>
      {rolling.phase === "ready" && (
        <>
          <p className={styles.diceHint}>
            주사위 두 개의 합 + 보정 · <b>9 이상 성공</b> · 12 이상 대성공 · 5 이하 실패
          </p>
          <button type="button" className="btn btn-primary btn-lg" onClick={onThrow}>
            주사위 던지기
          </button>
        </>
      )}
      {rolling.phase === "rolling" && <p className={styles.diceHint}>데구르르…</p>}
      {r && (
        <>
          <div className={styles.diceTotal}>
            <span className="num">
              {r.dice[0]} + {r.dice[1]} {r.mod >= 0 ? "+" : "−"} {Math.abs(r.mod)} = <b>{r.total}</b>
            </span>
            <strong>{TIER_LABEL[r.tier]}</strong>
          </div>
          {rolling.result && (
            <div className={styles.diceResult}>
              <p>{rolling.result.t}</p>
              <DeltaChips d={rolling.result.d} m={rolling.result.m} />
            </div>
          )}
          <button type="button" className={`btn btn-primary btn-lg ${styles.contBtn}`} onClick={onClose}>
            계속하기
            <span className={styles.contBar} style={{ animationDuration: `${RESULT_MS}ms` }} aria-hidden="true" />
          </button>
        </>
      )}
    </section>
  );
}

/* ── 인생 리포트 ── */
function LifeGraph({ rows }: { rows: number[][] }) {
  if (rows.length < 2) return null;
  const W = 320;
  const H = 120;
  const maxAge = Math.max(1, rows[rows.length - 1][0]);
  const nets = rows.map((r) => r[6] ?? 0);
  const nMin = Math.min(0, ...nets);
  const nMax = Math.max(1, ...nets);
  const x = (a: number) => ((a / maxAge) * W).toFixed(1);
  const lines = [
    { label: "행복", color: "var(--c-amber)", pts: rows.map((r) => `${x(r[0])},${(H - (r[4] / 100) * H).toFixed(1)}`) },
    { label: "건강", color: "var(--c-accent)", pts: rows.map((r) => `${x(r[0])},${(H - (r[1] / 100) * H).toFixed(1)}`) },
    { label: "순자산", color: "var(--c-gold)", pts: rows.map((r) => `${x(r[0])},${(H - (((r[6] ?? 0) - nMin) / (nMax - nMin)) * H).toFixed(1)}`) },
  ];
  const ticks = [0, Math.round(maxAge / 4), Math.round(maxAge / 2), Math.round((maxAge * 3) / 4), maxAge];
  return (
    <section className={styles.card}>
      <div className={styles.graphHead}>
        <h3 className={styles.cardTitle}>인생 그래프</h3>
        {lines.map((l) => (
          <span key={l.label} className={styles.legend}>
            <i style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
      <svg className={styles.graph} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="나이에 따른 행복, 건강, 순자산 변화">
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} className={styles.gridLine} />
        {lines.map((l) => (
          <polyline key={l.label} points={l.pts.join(" ")} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className={styles.graphAxis}>
        {ticks.map((t, i) => (
          <span key={i} className="num">
            {t}세
          </span>
        ))}
      </div>
    </section>
  );
}

function ReportView({ run, onAgain, onDex }: { run: Run; onAgain: () => void; onDex: () => void }) {
  const e = run.ending;
  if (!e) return <p className={styles.center}>아직 끝나지 않은 인생이에요.</p>;
  const special = !!e.specialId;
  const moments = run.log.filter((x) => x.hl && x.k !== "end").slice(0, 14);
  const family = run.people.filter((p) => p.role !== "mom" && p.role !== "dad");
  return (
    <div className={styles.report}>
      <div className={styles.reportMain}>
        <TopBar title="인생 리포트" right={<span className={`num ${styles.muted}`}>{worldLabel(run)}</span>} />
        <section className={`${styles.endCard} ${special ? styles.endSpecial : ""}`}>
          <Orbit className={styles.endOrbit} />
          <span className={styles.endPre}>
            {e.age}세, {e.cause === "accident" ? "갑작스러운 사고로" : e.cause === "sick" ? josa(e.causeText, "로") : "편안히"} 생을 마친 유진은
          </span>
          {special && <span className={styles.chipGold}>특수 엔딩</span>}
          {!special && e.mod && e.modId !== "ordinary" && <span className={styles.endMod}>{e.mod}</span>}
          <b className={styles.endTitle}>{special ? e.title : `${e.job} 유진`}</b>
          {special && <span className={styles.endFinale}>{e.specialText}</span>}
          <span className={styles.endFinale}>장례식에 {fmt(e.mourners)}명이 찾아왔어요.</span>
        </section>

        <div className={styles.quad}>
          <div>
            <span>수명</span>
            <b className="num">
              {e.age}
              <small>세</small>
            </b>
          </div>
          <div>
            <span>남긴 재산</span>
            <b className={`num ${e.netWorth < 0 ? styles.down : ""}`}>{won(e.netWorth, true)}</b>
          </div>
          <div>
            <span>평생 번 돈</span>
            <b className="num">{won(e.earned, true)}</b>
          </div>
          <div>
            <span>태어난 집</span>
            <b>{run.houseName}</b>
          </div>
        </div>

        <LifeGraph rows={run.hist ?? []} />

        {moments.length > 0 && (
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>결정적 순간</h3>
            <ul className={styles.moments}>
              {moments.map((m, i) => (
                <li key={i}>
                  <span className="num">{m.age}세</span>
                  <div>
                    <p>{m.t}</p>
                    {m.roll && <RollChip r={m.roll} />}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className={styles.reportSide}>
        {run.jobs.length > 0 && (
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>직업 이력</h3>
            <ol className={styles.jobLine}>
              {run.jobs.map((j, i) => (
                <li key={`${j.id}-${i}`} className={i === run.jobs.length - 1 ? styles.jobNow : ""}>
                  <span className={styles.jobDot} aria-hidden="true" />
                  <b>{j.name}</b>
                  <span className="num">{j.age}세</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {family.length > 0 && <PeopleCard people={family} />}
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>마지막 능력치</h3>
          <StatGrid stats={run.stats} />
        </section>
        {run.thoughts.length > 0 && (
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>유진이 남긴 생각</h3>
            <ul className={styles.moments}>
              {run.thoughts.map((t, i) => (
                <li key={i}>
                  <span className="num">{t.age}세</span>
                  <div>
                    <span className={styles.thoughtQ}>{t.q}</span>
                    <p>“{t.a}”</p>
                  </div>
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
      </div>
    </div>
  );
}

function letterLine(run: Run) {
  const s = run.stats;
  if (run.ending?.cause === "accident") return "너무 일찍 떠나서 미안해요. 그래도 보호자님 덕분에 행복했어요.";
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
    <div className={styles.dex}>
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
    </div>
  );
}

