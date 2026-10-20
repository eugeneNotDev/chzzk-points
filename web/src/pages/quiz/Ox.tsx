// 유진고사 — OX 퀴즈(시청자). 문제가 뜨면 시간 안에 O/X. 데스매치면 틀리는 순간 탈락.
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { apiFetch, ApiError } from "../../lib/auth";
import { API } from "../../lib/config";
import { toast } from "../../lib/dialog";
import { fmt } from "../../lib/format";
import { QUIZ_ERRORS, type OxView } from "../../lib/quiz";
import { leftText, Prompt } from "./Exam";
import { useNow } from "./useNow";
import styles from "./Quiz.module.css";

export const OIcon = () => (
  <svg viewBox="0 0 88 88" aria-hidden="true">
    <circle cx="44" cy="44" r="32" fill="none" stroke="currentColor" strokeWidth="10" />
  </svg>
);
export const XIcon = () => (
  <svg viewBox="0 0 88 88" aria-hidden="true">
    <path d="M18 18 L70 70 M70 18 L18 70" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" />
  </svg>
);

export function OxPanel({ quiz }: { quiz: OxView }) {
  const qc = useQueryClient();
  const now = useNow(250);
  const cur = quiz.current;
  const [local, setLocal] = useState<{ id: number; choice: "O" | "X" } | null>(null);
  const firstLeft = useRef<{ id: number; ms: number } | null>(null);

  const closesAt = cur?.closesAt ? new Date(cur.closesAt).getTime() : 0;
  const open = !!cur && !cur.closed && closesAt > now;
  if (cur && firstLeft.current?.id !== cur.id) firstLeft.current = { id: cur.id, ms: Math.max(1000, closesAt - now) };
  const pct = open && firstLeft.current ? Math.max(0, Math.min(100, ((closesAt - now) / firstLeft.current.ms) * 100)) : 0;

  useEffect(() => setLocal(null), [cur?.id]);
  const myChoice = local && local.id === cur?.id ? local.choice : cur?.myChoice ?? null;
  const deathmatch = quiz.oxMode === "deathmatch";

  async function answer(choice: "O" | "X") {
    if (!cur || !open || !quiz.me.canAnswer) return;
    setLocal({ id: cur.id, choice });
    try {
      await apiFetch(API.quiz, { body: { action: "ox-answer", questionId: cur.id, choice } });
    } catch (e) {
      setLocal(null);
      const code = e instanceof ApiError ? String(e.body.error ?? "") : "";
      toast(QUIZ_ERRORS[code] || "응답을 못 보냈어요. 다시 눌러주세요.", "error");
    } finally {
      qc.invalidateQueries({ queryKey: ["quiz"] });
    }
  }

  if (quiz.status === "revealed") return <OxResult quiz={quiz} />;

  const total = cur?.counts ? cur.counts.O + cur.counts.X : 0;

  return (
    <div className="split">
      <div className="split-main">
        <Card tone={open ? "feature" : undefined}>
          <div className={styles.oxBody}>
            <div className={styles.tags}>
              <span className={`tag ${deathmatch ? "tag-live" : "tag-blue"}`}>{deathmatch ? "데스매치" : "점수전"}</span>
              {cur && <span className="tag num">{cur.number}번째 문제</span>}
              <span className="muted" style={{ marginLeft: "auto", fontSize: 14 }}>
                {deathmatch ? (
                  <>
                    생존 <b className="num" style={{ color: "var(--c-text)", fontSize: 17 }}>{quiz.aliveCount}</b> / {quiz.participants}명
                  </>
                ) : (
                  <>
                    참여 <b className="num" style={{ color: "var(--c-text)", fontSize: 17 }}>{quiz.participants}</b>명
                  </>
                )}
              </span>
            </div>

            {!cur ? (
              <EmptyState>곧 첫 문제가 나와요. 이 화면을 켜두면 문제가 바로 떠요.</EmptyState>
            ) : (
              <>
                <h3 className={styles.oxPrompt}>
                  <Prompt text={cur.prompt} />
                </h3>
                {cur.imageUrl && <img className={styles.qImage} src={cur.imageUrl} alt="문제 그림" />}
                {open ? (
                  <div className={`${styles.progress} ${closesAt - now < 3000 ? styles.progressUrgent : ""}`} aria-label={`남은 시간 ${leftText(closesAt - now)}`}>
                    <i style={{ width: `${pct}%` }} />
                  </div>
                ) : cur.revealed ? (
                  <p className={`${styles.banner} ${myChoice === cur.answer ? styles.bannerOk : ""}`}>
                    정답은 <b>{cur.answer}</b>!{" "}
                    {myChoice ? (myChoice === cur.answer ? "맞혔어요." : deathmatch ? "아쉽게 탈락했어요." : "틀렸어요.") : "이번 문제엔 답하지 않았어요."}
                  </p>
                ) : (
                  <p className={styles.banner}>마감! 정답 공개를 기다리는 중이에요.</p>
                )}
                {cur.counts && total > 0 && (
                  <div className={styles.rows}>
                    <div className={styles.row}>
                      <b style={{ color: "var(--c-blue)" }}>O · {cur.counts.O}명</b>
                      <b style={{ color: "var(--c-amber)" }}>X · {cur.counts.X}명</b>
                    </div>
                    <div className={styles.split2}>
                      <i style={{ width: `${(cur.counts.O / total) * 100}%` }} />
                      <i style={{ width: `${(cur.counts.X / total) * 100}%` }} />
                    </div>
                  </div>
                )}
                <div className={styles.oxButtons}>
                  {(["O", "X"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={myChoice === c}
                      aria-label={c}
                      disabled={!open || !quiz.me.canAnswer}
                      className={`${styles.oxBtn} ${c === "O" ? styles.oxO : styles.oxX} ${myChoice === c ? styles.on : ""}`}
                      onClick={() => answer(c)}
                    >
                      {c === "O" ? <OIcon /> : <XIcon />}
                      {myChoice === c ? "내 선택" : c}
                    </button>
                  ))}
                </div>
                <p className="muted" style={{ textAlign: "center", fontSize: 13, margin: 0 }}>
                  {!quiz.me.canAnswer
                    ? quiz.me.joined
                      ? "탈락했어요. 끝까지 관전할 수 있어요."
                      : "첫 문제를 놓쳐서 이번 판은 관전만 할 수 있어요."
                    : "마감 전까지는 바꿀 수 있어요."}
                </p>
              </>
            )}
          </div>
        </Card>
      </div>
      <aside className="split-aside">
        <MyOx quiz={quiz} />
        <Card title="이번 판" tone="quiet">
          <div className={styles.rows}>
            <div className={styles.row}>
              <span>방식</span>
              <b>{deathmatch ? "틀리면 탈락" : "맞힌 개수로 순위"}</b>
            </div>
            <div className={styles.row}>
              <span>보상</span>
              <b style={{ color: "var(--c-gold)", textAlign: "right" }}>
                {deathmatch
                  ? quiz.rewardSurvivor > 0
                    ? `최후 생존자 각 ${fmt(quiz.rewardSurvivor)}P`
                    : "없음"
                  : quiz.rewardRanks.length
                    ? quiz.rewardRanks.map((p, i) => `${i + 1}등 ${fmt(p)}P`).join(" · ")
                    : "없음"}
              </b>
            </div>
          </div>
        </Card>
      </aside>
    </div>
  );
}

function MyOx({ quiz }: { quiz: OxView }) {
  const deathmatch = quiz.oxMode === "deathmatch";
  return (
    <Card
      title="내 기록"
      extra={
        quiz.me.joined && (
          <span className={`tag ${!deathmatch || quiz.me.alive ? "tag-accent" : ""}`} style={{ marginLeft: "auto" }}>
            {deathmatch ? (quiz.me.alive ? "생존 중" : "탈락") : `${quiz.me.correct}개 맞힘`}
          </span>
        )
      }
    >
      {quiz.me.history.length === 0 ? (
        <p className="muted" style={{ fontSize: 14 }}>
          정답이 공개된 문제가 여기에 쌓여요.
        </p>
      ) : (
        <div className={styles.hist}>
          {quiz.me.history.map((h) => (
            <div key={h.number} className={styles.histRow}>
              <b>Q{h.number}</b>
              <span className={styles.ellipsis} style={{ flex: 1, minWidth: 0 }}>
                {h.prompt.replace(/__/g, "")}
              </span>
              <b>{h.mine ?? "–"}</b>
              <b className={h.correct ? styles.ok : styles.no} style={{ width: 36, textAlign: "right" }}>
                {h.correct ? "정답" : "오답"}
              </b>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function OxResult({ quiz }: { quiz: OxView }) {
  const deathmatch = quiz.oxMode === "deathmatch";
  const me = quiz.ranking.find((r) => r.isMe);
  return (
    <div className="split">
      <div className="split-main">
        <Card tone="feature">
          <div className={styles.score}>
            <div className={`${styles.scoreItem} ${styles.scoreBig}`}>
              <span>{deathmatch ? "결과" : "맞힌 문제"}</span>
              <b>{deathmatch ? (quiz.me.joined ? (me?.alive ? "최후 생존" : "탈락") : "–") : quiz.me.correct}</b>
            </div>
            <div className={styles.divider} />
            <div className={styles.scoreItem}>
              <span>맞힌 문제</span>
              <b>
                {quiz.me.correct}
                <small> / {quiz.revealedCount}</small>
              </b>
            </div>
            {quiz.myReward && (
              <p className={`${styles.banner} ${styles.bannerOk}`} style={{ marginLeft: "auto" }}>
                <Trophy size={16} aria-hidden="true" /> {quiz.myReward.label} 보상 +{fmt(quiz.myReward.amount)}P{quiz.isTest ? " (테스트라 실제 지급 안 됨)" : ""}
              </p>
            )}
          </div>
        </Card>
        <MyOx quiz={quiz} />
      </div>
      <aside className="split-aside">
        <Card title={deathmatch ? "최후 생존자" : "순위"}>
          {quiz.ranking.length === 0 ? (
            <EmptyState>{deathmatch ? "살아남은 사람이 없어요." : "맞힌 사람이 없어요."}</EmptyState>
          ) : (
            <ol className={styles.rank}>
              {quiz.ranking.map((r) => (
                <li key={r.rank} className={r.isMe ? styles.me : ""}>
                  <b className={styles.rankNo}>{r.rank}</b>
                  <span className={styles.rankName}>{r.name}</span>
                  <b className="num">{r.correct}개</b>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </aside>
    </div>
  );
}
