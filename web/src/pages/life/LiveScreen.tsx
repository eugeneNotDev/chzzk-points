// 유진 키우기 방송 화면(OBS 창) — 진행 화면의 "방송 화면 열기"로 뜸. 주인만.
// 방송 모드인 판의 올해 이야기 · 능력치 · 갈림길과 시청자 투표 현황을 큼직하게 보여줌. 조작은 진행 화면(리모컨)에서.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dice5, Radio, Sprout, Vote } from "lucide-react";
import { STAGES, STATS, TIER_LABEL, fetchLive, lifeStage, won } from "../../lib/life";
import styles from "./Life.module.css";

export default function LiveScreen() {
  useEffect(() => {
    const t = window.setTimeout(() => (document.title = "유진 키우기 방송화면 · 유진 팬보드"), 0);
    return () => window.clearTimeout(t);
  }, []);
  const q = useQuery({ queryKey: ["life-live"], refetchInterval: 1500, queryFn: () => fetchLive(0) });
  const run = q.data?.run ?? null;
  const v = q.data?.vote ?? null;

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

  const age = run.age;
  const now = run.log.filter((e) => e.age === age && e.k !== "pick" && e.k !== "end").slice(-4);
  const lastPick = [...run.log].reverse().find((e) => e.k === "pick" && e.age === age);
  const lastRoll = lastPick ? run.log.slice(run.log.indexOf(lastPick) + 1).find((e) => e.roll) : undefined;
  const p = run.status === "playing" ? run.pending : null;
  const b = run.broadcast;
  const ended = run.status === "ended" && run.ending;

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
          <p className={styles.liveJob}>{run.jobName ?? run.school}</p>
          {STATS.map((st) => (
            <div key={st.key} className={styles.liveStat}>
              <span>{st.label}</span>
              <i>
                <i style={{ width: `${run.stats[st.key]}%`, background: st.color }} />
              </i>
              <b className="num">{run.stats[st.key]}</b>
            </div>
          ))}
          <div className={styles.liveMoney}>
            <span>순자산</span>
            <b className="num">{won(run.money.net, true)}</b>
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
          {ended ? (
            <div className={styles.liveEnd}>
              <span>
                {run.ending!.age}세, 유진은 이렇게 기억됐어요
              </span>
              <b>{run.ending!.specialId ? run.ending!.title : `${run.ending!.mod && run.ending!.modId !== "ordinary" ? run.ending!.mod + " " : ""}${run.ending!.job} 유진`}</b>
              {run.ending!.specialText && <p>{run.ending!.specialText}</p>}
            </div>
          ) : (
            <>
              <ul className={styles.liveYear}>
                {now.length === 0 && <li className={styles.liveQuiet}>조용한 한 해가 흘러간다…</li>}
                {now.map((e, i) => (
                  <li key={i} className={e.hl ? styles.liveHl : ""}>
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
                  {v?.open && <p className={styles.liveHint}>팬보드 → 유진 키우기에서 투표해 주세요</p>}
                </section>
              ) : (
                lastPick && (
                  <section className={styles.liveResult}>
                    <span>방금 고른 것</span>
                    <b>{lastPick.t.split(" → ").slice(-1)[0]}</b>
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
