// 유진 키우기 진행 화면의 아래에서 올라오는 창 — 갈림길 선택, 주사위 굴리기.
import { useEffect, useState } from "react";
import { Dice5, GitFork, MessageCircle, Vote } from "lucide-react";
import { fmt } from "../../lib/format";
import { TIER_LABEL, won, type Pending, type PendingOpt } from "../../lib/life";
import styles from "./Life.module.css";
import { Die } from "./parts";
import { DeltaChips, RESULT_MS, type Rolling } from "./playParts";

type LiveBar = { open: boolean; counts: Record<string, number>; total: number; onOpen: () => void; onClose: () => void };
export function DecisionSheet({ pending, age, busy, onPick, cash, points, live }: { pending: Pending; age: number; busy: boolean; onPick: (o: PendingOpt) => void; cash: number; points: number | null; live?: LiveBar | null }) {
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
            {live?.open && !o.pts && <span className={`num ${styles.voteCount}`}>{live.counts[o.key] ?? 0}표</span>}
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
      {live && (
        <div className={styles.liveBar}>
          {live.open ? (
            <>
              <span>
                <Vote size={14} aria-hidden="true" /> 시청자 투표 중 · <b className="num">{live.total}</b>표
              </span>
              <button type="button" className="btn btn-primary" onClick={live.onClose} disabled={busy}>
                투표 마감하고 진행
              </button>
            </>
          ) : (
            <>
              <span>선택지를 직접 누르거나 시청자 투표를 열 수 있어요</span>
              <button type="button" className="btn" onClick={live.onOpen} disabled={busy}>
                <Vote size={15} aria-hidden="true" /> 시청자 투표 열기
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function DicePanel({ rolling, onThrow, onClose }: { rolling: Rolling; onThrow: () => void; onClose: () => void }) {
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
