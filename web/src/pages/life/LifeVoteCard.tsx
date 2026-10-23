// 유진 키우기 방송 투표 카드 — 유진이 방송에서 투표를 열면 뜸. "투표" 메뉴와 유진 키우기 화면 위쪽에 같이 씀.
// 투표는 테스트 모드여도 로그인한 시청자 누구나 할 수 있음(서버 life-game ?view=vote / action=vote).
import { useState } from "react";
import { Check, Vote } from "lucide-react";
import { castVote, lifeErrorText, useLifeVote } from "../../lib/life";
import styles from "./LifeVoteCard.module.css";

export function LifeVoteCard() {
  const q = useLifeVote();
  const v = q.data;
  const onVoted = () => q.refetch();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!v?.open) return null;
  async function pick(key: string) {
    setBusy(key);
    setErr(null);
    try {
      await castVote(key);
      onVoted();
    } catch (e) {
      setErr(lifeErrorText(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className={styles.voteCard} aria-live="polite">
      <div className={styles.voteHead}>
        <span className={styles.voteLive}>
          <Vote size={14} aria-hidden="true" />
          방송 투표 중
        </span>
        <span className={styles.voteMeta}>
          {v.age}세 유진{v.jobName ? ` · ${v.jobName}` : ""} · <b className="num">{v.total}</b>표
        </span>
      </div>
      <p className={styles.voteText}>{v.text}</p>
      <div className={styles.voteOpts}>
        {v.opts.map((o) => {
          const n = v.counts[o.key] ?? 0;
          const pct = v.total ? Math.round((n / v.total) * 100) : 0;
          const mine = v.myKey === o.key;
          return (
            <button key={o.key} type="button" className={`${styles.voteOpt} ${mine ? styles.voteMine : ""}`} onClick={() => pick(o.key)} disabled={!!busy} aria-pressed={mine}>
              {v.myKey && <i className={styles.voteFill} style={{ width: `${pct}%` }} aria-hidden="true" />}
              <span className={`num ${styles.key}`}>{o.key}</span>
              <span className={styles.voteOptText}>{o.text}</span>
              {v.myKey && <span className={`num ${styles.votePct}`}>{pct}%</span>}
              {mine && <Check size={16} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <p className={styles.voteFine}>{err ?? (v.myKey ? "마감 전까지 다른 선택지로 바꿀 수 있어요" : "유진이 마감하면 가장 많이 나온 선택지로 진행돼요")}</p>
    </section>
  );
}

