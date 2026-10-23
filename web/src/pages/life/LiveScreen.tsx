// 유진 키우기 방송 화면(OBS 창) — 진행 화면의 "방송 화면 열기"로 뜸. 주인만.
// 방송 모드인 판의 올해 이야기 · 능력치 · 갈림길과 시청자 투표 현황을 큼직하게 보여줌. 조작은 진행 화면(리모컨)에서.
// 서버 상태는 한 번에 몇 해씩 앞서 나가므로, 기록은 한 줄씩 차례로 보여주고(LINE_MS) 다 보여준 뒤에만 갈림길·엔딩을 띄움.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dice5, Radio, Sprout, Vote } from "lucide-react";
import { STAGES, STATS, TIER_LABEL, fetchLive, histStats, josa, lifeStage, won } from "../../lib/life";
import styles from "./Life.module.css";

const LINE_MS = 1600; // 기록 한 줄 보여주는 간격
const MAX_BEHIND = 12; // 이보다 많이 밀리면 앞부분은 건너뜀
const END_HOLD_MS = 6000; // 마지막 해(떠나는 장면)를 보여준 뒤 엔딩 화면까지

export default function LiveScreen() {
  useEffect(() => {
    const t = window.setTimeout(() => (document.title = "유진 키우기 방송화면 · 유진 팬보드"), 0);
    return () => window.clearTimeout(t);
  }, []);
  const q = useQuery({ queryKey: ["life-live"], refetchInterval: 1500, queryFn: () => fetchLive(0) });
  const run = q.data?.run ?? null;
  const v = q.data?.vote ?? null;
  const total = run?.log.length ?? 0;

  // 화면이 따라잡은 기록 수 — 처음 열었을 땐 지금까지를 다 본 걸로, 판이 바뀌면 다시
  const [seen, setSeen] = useState<{ id: number; n: number } | null>(null);
  useEffect(() => {
    if (run && (!seen || seen.id !== run.id || seen.n > total)) setSeen({ id: run.id, n: total });
  }, [run, total, seen]);
  const shown = seen && run && seen.id === run.id ? Math.min(seen.n, total) : total;
  useEffect(() => {
    if (!run || shown >= total) return;
    const t = window.setTimeout(() => setSeen({ id: run.id, n: total - shown > MAX_BEHIND ? total - MAX_BEHIND : shown + 1 }), LINE_MS);
    return () => window.clearTimeout(t);
  }, [run, shown, total]);
  const caught = shown >= total;

  // 끝난 판: 마지막 해 장면을 다 보여주고 잠깐 둔 뒤 엔딩
  const [endReady, setEndReady] = useState(false);
  const isEnded = run?.status === "ended";
  useEffect(() => {
    if (!isEnded || !caught) {
      setEndReady(false);
      return;
    }
    const t = window.setTimeout(() => setEndReady(true), END_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [isEnded, caught]);

  // 마지막 투표 결과 — 마감한 뒤에도 "몇 표로 정해졌는지" 보여주려고 열려 있던 동안의 선택지·표를 기억해 둠
  const [lastVote, setLastVote] = useState<{ round: string; text: string; opts: { key: string; text: string }[]; counts: Record<string, number>; total: number } | null>(null);
  const livePending = run?.status === "playing" ? run.pending : null;
  useEffect(() => {
    if (!v?.round) return;
    if (v.open && livePending) {
      const next = { round: v.round, text: livePending.text, opts: v.opts.map((o) => ({ key: o.key, text: o.text })), counts: v.counts, total: v.total };
      if (JSON.stringify(next) !== JSON.stringify(lastVote)) setLastVote(next);
    } else if (!v.open && lastVote && v.round === lastVote.round && v.total !== lastVote.total) {
      setLastVote({ ...lastVote, counts: v.counts, total: v.total });
    }
  }, [v, livePending, lastVote]);

  if (!run) {
    return (
      <div className={styles.live}>
        <div className={styles.liveEmpty}>
          <Sprout size={48} aria-hidden="true" />
          <b>{q.isLoading ? "불러오는 중…" : "방송 모드인 유진이 없어요"}</b>
          <span>진행 화면에서 "방송 모드"를 켜 주세요</span>
        </div>
      </div>
    );
  }

  const visible = run.log.slice(0, shown);
  const age = visible.length ? visible[visible.length - 1].age : run.age;
  const now = visible.filter((e) => e.age === age && e.k !== "pick").slice(-4);
  const lastPick = [...visible].reverse().find((e) => e.k === "pick" && e.age === age);
  const lastRoll = lastPick ? visible.slice(visible.indexOf(lastPick) + 1).find((e) => e.roll) : undefined;
  const p = caught && run.status === "playing" ? run.pending : null;
  const b = run.broadcast;
  const stats = histStats(run.hist.find((r) => r[0] === age), run.stats);
  const ending = endReady && run.ending ? run.ending : null;
  // 방금 고른 게 시청자 투표로 정해진 거면 그 결과
  const picked = lastPick ? lastPick.t.split(" → ").slice(-1)[0] : null;
  const voted = lastPick && lastVote && !v?.open && lastPick.t.startsWith(lastVote.text) && lastVote.total > 0 ? lastVote : null;

  return (
    <div className={styles.live}>
      <header className={styles.liveTop}>
        <span className={styles.liveBrand}>유진 키우기</span>
        <span className={styles.liveWorld}>
          {run.worldNo ? `No.${run.worldNo} 평행세계` : "테스트 세계"} · {run.houseName}
        </span>
        <span className={styles.liveAge}>
          <b className="num">{age}</b>세 · {STAGES[lifeStage(age)]}
        </span>
      </header>

      <div className={styles.liveGrid}>
        <aside className={styles.livePanel}>
          <p className={styles.liveJob}>{caught ? run.jobName ?? run.school : b?.title ?? run.jobName ?? run.school}</p>
          {STATS.map((st) => (
            <div key={st.key} className={styles.liveStat}>
              <span>{st.label}</span>
              <i>
                <i style={{ width: `${stats[st.key]}%`, background: st.color }} />
              </i>
              <b className="num">{stats[st.key]}</b>
            </div>
          ))}
          <div className={styles.liveMoney}>
            <span>순자산</span>
            <b className="num">{won(run.hist.find((r) => r[0] === age)?.[6] ?? run.money.net, true)}</b>
          </div>
          {b && (
            <div className={styles.liveBc}>
              <Radio size={16} aria-hidden="true" />
              {b.title} · 인지도 <b className="num">{b.fame}</b>
              {b.nick[0] ? ` · ${b.nick[0]}` : ""}
            </div>
          )}
        </aside>

        <main className={styles.liveMain}>
          {ending ? (
            <div className={styles.liveEnd}>
              <span>
                {ending.age}세, {ending.cause === "old" ? "편안히" : josa(ending.causeText, "로")} 떠난 유진은 이렇게 기억됐어요
              </span>
              <b>{ending.specialId ? ending.title : `${ending.mod && ending.modId !== "ordinary" ? ending.mod + " " : ""}${ending.job} 유진`}</b>
              {ending.specialText && <p>{ending.specialText}</p>}
            </div>
          ) : (
            <>
              <ul className={styles.liveYear}>
                {now.length === 0 && <li className={styles.liveQuiet}>조용한 한 해가 흘러간다…</li>}
                {now.map((e, i) => (
                  <li key={`${age}-${visible.length}-${i}`} className={e.hl || e.k === "end" ? styles.liveHl : ""}>
                    {e.t}
                    {e.roll && (
                      <em className="num">
                        <Dice5 size={18} aria-hidden="true" /> {e.roll.dice.join("+")}
                        {e.roll.mod ? (e.roll.mod > 0 ? `+${e.roll.mod}` : e.roll.mod) : ""} = {e.roll.total} {TIER_LABEL[e.roll.tier]}
                      </em>
                    )}
                  </li>
                ))}
              </ul>

              {p ? (
                <section className={`${styles.liveFork} ${v?.open ? styles.liveForkOpen : ""}`}>
                  <div className={styles.liveForkHead}>
                    <span>{p.tag ?? "갈림길"}</span>
                    {v?.open ? (
                      <b>
                        <Vote size={20} aria-hidden="true" /> 투표 중 · <span className="num">{v.total}</span>표
                      </b>
                    ) : (
                      <b>유진이 고르는 중…</b>
                    )}
                  </div>
                  <p className={styles.liveForkText}>{p.text}</p>
                  <div className={styles.liveOpts}>
                    {p.opts.map((o) => {
                      const n = v?.counts[o.key] ?? 0;
                      const pct = v?.total ? Math.round((n / v.total) * 100) : 0;
                      const top = !!v?.open && v.total > 0 && n === Math.max(...Object.values(v.counts));
                      return (
                        <div key={o.key} className={`${styles.liveOpt} ${top ? styles.liveOptTop : ""} ${o.pts ? styles.liveOptOff : ""}`}>
                          {v?.open && <i style={{ width: `${pct}%` }} aria-hidden="true" />}
                          <span className={`num ${styles.liveKey}`}>{o.key}</span>
                          <span className={styles.liveOptText}>{o.text}</span>
                          {v?.open && !o.pts && (
                            <span className={`num ${styles.liveOptN}`}>
                              {n}표 <small>{pct}%</small>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {v?.open && <p className={styles.liveHint}>팬보드 → 투표 메뉴에서 골라주세요</p>}
                </section>
              ) : (
                lastPick && (
                  <section className={styles.liveResult}>
                    <span>{voted ? `시청자 투표로 결정 · 총 ${voted.total}표` : "방금 고른 것"}</span>
                    <b>{picked}</b>
                    {voted && (
                      <div className={styles.liveTally}>
                        {voted.opts.map((o) => {
                          const n = voted.counts[o.key] ?? 0;
                          const pct = Math.round((n / voted.total) * 100);
                          return (
                            <div key={o.key} className={o.text === picked ? styles.liveTallyWin : ""}>
                              <i style={{ width: `${pct}%` }} aria-hidden="true" />
                              <span>{o.text}</span>
                              <b className="num">
                                {n}표 · {pct}%
                              </b>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {lastRoll?.roll && (
                      <em className="num">
                        <Dice5 size={20} aria-hidden="true" /> {lastRoll.roll.dice.join(" + ")} → {TIER_LABEL[lastRoll.roll.tier]}
                      </em>
                    )}
                  </section>
                )
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
