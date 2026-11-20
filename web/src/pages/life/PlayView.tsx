// 우진 키우기 — 진행 화면(해마다 이야기를 속도에 맞춰 보여주고, 갈림길·초점·쇼핑·방송 모드를 다룸).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, Briefcase, Flower2, GitFork, GraduationCap, HeartPulse, Pause, Play, MonitorPlay, Radio, SkipForward, Star,
  Target,
} from "lucide-react";
import { useAuth } from "../../lib/auth";
import { confirmDialog } from "../../lib/dialog";
import { fmt } from "../../lib/format";
import {
  STAGES, advanceLife, buyLife, chooseLife, closeVote, fetchRun, focusLife, fundLife, histStats, lifeErrorText, lifeStage, josa, openVote, sendLiveCursor, setLive,
  useLifeVote, type Lobby, type LogEntry, type PendingOpt, type Run,
} from "../../lib/life";
import styles from "./Life.module.css";
import { BroadcastCard, Feed, MoneyCard, PeopleCard, ShopCard, ShopModal } from "./PlayCards";
import { DecisionSheet, DicePanel } from "./PlaySheets";
import { Die, StatGrid, worldLabel } from "./parts";
import { DeltaChips, EntryIcon, RollChip, type Rolling, SPEEDS, YEAR_MS } from "./playParts";

// startBalance: 막 태어난 판이면 집 값을 뺀 잔액(로비 데이터는 아직 갱신 전이라)
export function PlayView({ lobby, initial, startBalance, onReport, onExit }: { lobby: Lobby; initial: Run; startBalance?: number; onReport: (r: Run) => void; onExit: () => void }) {
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
  const [shopErr, setShopErr] = useState<string | null>(null); // 상점 창 안에 보여줄 에러(진행은 안 멈춤)
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [wantFocus, setWantFocus] = useState<string | null>(null);
  const [balance, setBalance] = useState(startBalance ?? lobby.balance); // 포인트 잔액(후원·포인트 구매 뒤 서버가 준 값으로 갱신)
  // 방송 모드(주인만): 이 판의 갈림길을 시청자 투표로
  const { isAdmin } = useAuth();
  const [liveOn, setLiveOn] = useState(lobby.liveId === initial.id);
  const liveVote = useLifeVote(liveOn);
  const [voteBusy, setVoteBusy] = useState(false);
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
  const done = ended && drained; // 서버는 끝났어도 미리 받은 해를 다 보여주기 전까진 진행 중처럼

  // 방송 모드: 이 화면이 지금 몇 번째 기록까지 보여줬는지 방송 화면(OBS)에 알림 — 서버는 몇 해씩 앞서 있어서
  // 서버 기준으로 보여주면 방송 화면이 진행 화면보다 앞서갔음. 바뀔 때마다 보내되 1.2초에 한 번까지만.
  const shownCount = useMemo(() => log.filter((e) => e.age < age).length + nShown, [log, age, nShown]);
  const cursorSent = useRef<{ n: number; at: number } | null>(null);
  useEffect(() => {
    if (!liveOn) {
      cursorSent.current = null;
      return;
    }
    const sent = cursorSent.current;
    if (sent && sent.n === shownCount) return;
    const wait = sent ? Math.max(0, 1200 - (Date.now() - sent.at)) : 0;
    const t = setTimeout(() => {
      cursorSent.current = { n: shownCount, at: Date.now() };
      sendLiveCursor(run.id, shownCount).catch(() => {});
    }, wait);
    return () => clearTimeout(t);
  }, [liveOn, shownCount, run.id]);

  // 방송 모드: 갈림길이 화면에 뜨면 시청자 투표를 자동으로 염(마감은 직접)
  const autoVoted = useRef<string | null>(null);
  useEffect(() => {
    if (!liveOn || !pending || pending.opts.length < 2 || voteBusy || rolling || liveVote.data?.open) return;
    const key = `${run.id}:${age}:${pending.id}`;
    if (autoVoted.current === key) return;
    autoVoted.current = key;
    setVoteBusy(true);
    openVote()
      .then(() => liveVote.refetch())
      .catch(() => {}) // 투표로 못 정하는 결정이면 조용히 넘어감(직접 고르면 됨)
      .finally(() => setVoteBusy(false));
  }, [liveOn, pending, voteBusy, rolling, liveVote, run.id, age]);

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
  // 서버와 어긋났을 때(응답을 놓쳐 이미 반영됨·다른 창에서 진행) 판을 통째로 다시 받아서 맞춤
  async function onFail(e: unknown, show: (m: string | null) => void) {
    const code = (e as { body?: { error?: string } })?.body?.error;
    if (code === "no_pending" || code === "busy") {
      try {
        const full = await fetchRun(runRef.current.id);
        if (!mounted.current) return;
        setLog(full.log);
        setRun(full);
        setRolling(null);
        show(null);
        return;
      } catch {
        // 다시 받기도 실패하면 아래 에러 표시
      }
    }
    show(lifeErrorText(e));
  }

  // 다 보여줬고 결정도 없으면 다음 해 받아오기
  useEffect(() => {
    if (!drained || halt || rolling || ended || run.pending || fetching || busy || err) return;
    setFetching(true);
    const years = skip ? 3 : speed >= 8 ? 3 : speed >= 4 ? 2 : 1;
    const go = async () => {
      try {
        const r = runRef.current;
        // 바꿔 둔 초점이 있으면 먼저 보냄(나이대가 바뀌어 못 쓰는 초점이면 그냥 버림)
        if (wantFocus && wantFocus !== r.focus) {
          const ok = r.focuses.some((f) => f.id === wantFocus);
          setWantFocus(null);
          if (ok) await focusLife(r.id, wantFocus, log.length).then((res) => mounted.current && merge(res.run)).catch(() => {});
        }
        const res = await advanceLife(r.id, log.length, years);
        if (mounted.current) merge(res.run);
      } catch (e) {
        if (mounted.current) await onFail(e, setErr);
      } finally {
        if (mounted.current) setFetching(false);
      }
    };
    // 멈추거나 상점을 열어도 받아오던 해는 버리지 않음(서버는 이미 그 해를 굴려 저장했으니 버리면 화면과 어긋남)
    go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drained, halt, rolling, ended, run.pending, busy, err]);

  // 다른 탭으로 가면 자동 일시정지(돌아왔을 때 여러 해가 훌쩍 지나 있지 않게)
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) setPaused(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

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
      const res = await chooseLife(run.id, o.key, log.length, run.pending?.id);
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
      await onFail(e, setErr);
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
      const res = await chooseLife(run.id, rolling.opt.key, log.length, run.pending?.id);
      const wait = Math.max(0, 1100 - (Date.now() - t0));
      setTimeout(() => {
        merge(res.run);
        const result = res.run.log.find((e) => e.roll) ?? null;
        setRolling((r) => (r ? { ...r, phase: "done", roll: res.roll, result } : r));
        setBusy(false);
      }, wait);
    } catch (e) {
      setRolling(null);
      await onFail(e, setErr);
      setBusy(false);
    }
  }
  const closeRoll = useCallback(() => {
    setRolling(null);
    // 결과 줄은 결과 창에서 이미 봤으니 바로 펼침
    setShown(999);
    yearStart.current = Date.now() - yearMs * 0.6;
    // 결과 창이 떠 있던 시간을 또 밀지 않게(안 그러면 결정마다 몇 초씩 멈춤). 일시정지 중이면 지금부터 멈춘 걸로
    stoppedAt.current = halt ? Date.now() : null;
  }, [yearMs, halt]);

  async function onFocus(id: string) {
    if (fetching || busy) {
      setWantFocus(id); // 다음 해 받아올 때 같이 보냄
      return;
    }
    setWantFocus(null);
    setBusy(true); // 초점 요청 중엔 다음 해 받아오기를 멈춤(두 요청이 겹치면 한쪽이 busy로 실패)
    try {
      const res = await focusLife(run.id, id, log.length);
      merge(res.run);
    } catch {
      // 초점 바꾸기 실패는 조용히 넘김(진행은 계속)
    } finally {
      setBusy(false);
    }
  }
  async function onFund(id: string) {
    if (busy || fetching) return;
    setBusy(true);
    try {
      const res = await fundLife(run.id, id, log.length);
      merge(res.run);
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
    setShopErr(null);
    try {
      const res = await buyLife(run.id, itemId, pay, log.length);
      merge(res.run);
      setSnap(res.run);
      if (typeof res.balance === "number") setBalance(res.balance);
      if (pay === "points") qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      await onFail(e, setShopErr);
    } finally {
      setBusy(false);
    }
  }

  async function toggleLive() {
    try {
      await setLive(liveOn ? null : run.id);
      setLiveOn(!liveOn);
      qc.invalidateQueries({ queryKey: ["life-lobby"] });
      liveVote.refetch();
    } catch (e) {
      setErr(lifeErrorText(e));
    }
  }
  async function startVote() {
    setVoteBusy(true);
    setErr(null);
    try {
      await openVote();
      await liveVote.refetch();
    } catch (e) {
      setErr(lifeErrorText(e));
    } finally {
      setVoteBusy(false);
    }
  }
  async function endVote() {
    const p = run.pending;
    if (!p) return;
    setVoteBusy(true);
    setErr(null);
    try {
      const res = await closeVote(log.length);
      merge(res.run);
      const opt = p.opts.find((o) => o.key === res.winner) ?? p.opts[0];
      const result = res.roll ? res.run.log.find((e) => e.roll) ?? null : res.run.log.find((e) => e.k !== "pick") ?? null;
      setRolling({ opt, text: `${p.text} · 투표 ${res.counts[res.winner] ?? 0}/${res.total}표`, phase: "done", roll: res.roll, result, plain: !res.roll });
      liveVote.refetch();
    } catch (e) {
      setErr(lifeErrorText(e));
    } finally {
      setVoteBusy(false);
    }
  }

  const stage = lifeStage(age);
  const view = snap;
  const timeline = useMemo(() => log.filter((e) => e.age < age && e.k !== "pick").slice(-80).reverse(), [log, age]);
  const visibleNow = yearEntries.slice(0, nShown);
  const luck = row[7] ?? 3;
  // 생각 남기기·인생 마디 결정이 떠 있으면 서버가 구매를 거절하니 막음
  const canShop = ci >= last && !rolling && !ended && !fetching && !(run.pending && !["fork", "mile"].includes(run.pending.kind));
  function openShop() {
    // 상점을 열면 그 자리에서 멈춤(게이지·줄 그대로). 다만 서버가 이미 다음 해를 굴려 둔 상태(지난 해 줄은 다 보여준 뒤)면
    // 산 물건이 맞는 나이에 들어가도록 그 해로 넘어가되, 새 해는 처음부터(줄 0개·게이지 0) — 닫으면 평소 속도로 이어감
    if (ci < last) {
      setCur(last);
      setShown(0);
      yearStart.current = Date.now();
    }
    setShopOpen(true);
  }

  return (
    <div className={styles.play}>
      {/* 머리줄 */}
      <header className={styles.playHead}>
        <div className={styles.ageBox}>
          <span>
            {worldLabel(run)} 우진 · {view.houseName}
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
          <button type="button" className={styles.iconBtn} onClick={() => setPaused((p) => !p)} aria-label={paused ? "계속" : "일시정지"} disabled={done}>
            {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          </button>
          <button type="button" className={`${styles.skipBtn} ${skip ? styles.skipOn : ""}`} onClick={() => { setSkip((v) => !v); setPaused(false); }} disabled={done || !!pending}>
            <SkipForward size={15} aria-hidden="true" />
            다음 결정까지
          </button>
          {isAdmin && !ended && (
            <>
              <button type="button" className={`${styles.skipBtn} ${liveOn ? styles.liveOnBtn : ""}`} onClick={toggleLive} aria-pressed={liveOn} title="이 판의 갈림길을 시청자 투표로 정해요">
                <Radio size={15} aria-hidden="true" />
                {liveOn ? "방송 모드 켜짐" : "방송 모드"}
              </button>
              {liveOn && (
                <button type="button" className={styles.iconBtn} onClick={() => window.open(`${import.meta.env.BASE_URL}life.html?screen=live`, "life-live", "width=1280,height=720")} aria-label="방송 화면 열기" title="방송 화면 열기(OBS용)">
                  <MonitorPlay size={16} aria-hidden="true" />
                </button>
              )}
            </>
          )}
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
                {/* 얼마나 심한지(큰 병원 진료로 낮아지는 게 보이게) */}
                <span className={styles.sickLv}>{view.sick.sev >= 3 ? "위중" : view.sick.sev === 2 ? "치료 중" : "가벼움"}</span>
              </span>
            )}
            {view.fame > 0 && !view.broadcast?.active && (
              <span className={styles.statusChip}>
                <Star size={13} aria-hidden="true" />
                인지도 <b className="num">{view.fame}</b>
              </span>
            )}
          </div>
          <StatGrid stats={stats} prev={prevStats} />
        </section>
        {view.broadcast && <BroadcastCard b={view.broadcast} />}
        <MoneyCard run={view} net={row[6] ?? view.money.net} rows={rows.slice(0, ci + 1)} />
      </aside>

      {/* 가운데: 올해 이야기·선택·지난 기록 */}
      <main className={styles.center2}>
        <section className={`${styles.year} ${skip ? styles.yearSkip : ""}`} aria-live="polite">
          {!pending && !done && (
            <span
              key={`${age}-${k}`}
              className={styles.yearBar}
              style={{ animationDuration: `${yearMs}ms`, animationPlayState: stopped ? "paused" : "running" }}
              aria-hidden="true"
            />
          )}
          <div className={styles.yearHead}>
            <span>
              <b className="num">{age}</b>세의 우진
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
                  <li key={`${age}-${i}`} className={`${styles.yearItem} ${e.k === "rare" ? styles.yearRare : ""} ${e.hl && e.k !== "rare" ? styles.yearHl : ""}`}>
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

        {pending && (
          <DecisionSheet
            pending={pending} age={age} busy={busy || voteBusy} onPick={choose} cash={view.money.cash + view.money.invest} points={run.isTest ? null : balance}
            live={liveOn ? { open: !!liveVote.data?.open, counts: liveVote.data?.counts ?? {}, total: liveVote.data?.total ?? 0, onOpen: startVote, onClose: endVote } : null}
          />
        )}

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
                <button key={f.id} type="button" className={`${styles.focusBtn} ${on ? styles.focusOn : ""}`} onClick={() => onFocus(f.id)} disabled={done} aria-pressed={on}>
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
      {shopOpen && (
        <ShopModal
          run={run} balance={balance} canShop={canShop} busy={busy || fetching} err={shopErr} onBuy={onBuy}
          onClose={() => {
            setShopOpen(false);
            setShopErr(null);
          }}
        />
      )}
    </div>
  );
}

// 방송 카드 — 버튜버 루트(진엔딩 루트)의 상태를 한눈에. 등급은 게임 속 직업 등급 그대로(하꼬 → 중소 → 중견 → 대형 → 레전드)
