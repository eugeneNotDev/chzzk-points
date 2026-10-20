// 유진고사 — 모의고사(시청자). 응시 중엔 시험지 + 답안지(OMR), 발표 후엔 점수·내 답안·순위.
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Trophy, X } from "lucide-react";
import { Card } from "../../components/Card";
import { apiFetch, ApiError } from "../../lib/auth";
import { API } from "../../lib/config";
import { confirmDialog, toast } from "../../lib/dialog";
import { fmt } from "../../lib/format";
import { QUIZ_ERRORS, underlineParts, type ExamQuestion, type ExamView } from "../../lib/quiz";
import { readStorage, writeStorage } from "../../lib/storage";
import { useNow } from "./useNow";
import styles from "./Quiz.module.css";

const CIRCLED = ["①", "②", "③", "④"];
const draftKey = (id: number) => `chzzk_quiz_draft_${id}`;

export const leftText = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function Prompt({ text }: { text: string }) {
  return (
    <>
      {underlineParts(text).map((p, i) => (p.u ? <u key={i}>{p.t}</u> : <span key={i}>{p.t}</span>))}
    </>
  );
}

// 시험지 한 장 — 응시(onPick 있음) / 읽기 전용 / 결과(revealed) 모두 이걸로 그림
export function ExamPaper({
  quiz,
  answers,
  onPick,
  revealed = false,
}: {
  quiz: Pick<ExamView, "title" | "subtitle"> & { questions: ExamQuestion[] };
  answers: Record<string, string>;
  onPick?: (qid: number, v: string) => void;
  revealed?: boolean;
}) {
  const editable = !!onPick;
  return (
    <section className={styles.paper} aria-label="시험지">
      <div className={styles.paperHead}>
        <span className={styles.paperRound}>{quiz.title}</span>
        <span className={styles.paperArea}>{quiz.subtitle || "유진 영역"}</span>
      </div>
      <div className={styles.paperRule} />
      <div className={styles.questions}>
        {quiz.questions.map((q, i) => {
          const mine = answers[String(q.id)] ?? "";
          return (
            <div key={q.id} id={`q-${q.id}`} className={styles.q}>
              <div className={styles.qTitle}>
                {i + 1}. <Prompt text={q.prompt} />
                <span className={styles.qMeta}>
                  [{q.points}점{q.qtype === "short" ? " · 단답형" : ""}]
                </span>
              </div>
              {q.imageUrl && <img className={styles.qImage} src={q.imageUrl} alt="문제 그림" loading="lazy" />}

              {q.qtype === "choice" && (
                <div className={styles.choices} role={editable ? "radiogroup" : undefined} aria-label={`${i + 1}번 보기`}>
                  {q.choices.map((c, k) => {
                    const v = String(k + 1);
                    const picked = mine === v;
                    const right = revealed && q.answer === v;
                    const wrong = revealed && picked && !right;
                    return (
                      <button
                        key={k}
                        type="button"
                        role={editable ? "radio" : undefined}
                        aria-checked={editable ? picked : undefined}
                        disabled={!editable}
                        className={`${styles.choice} ${picked ? styles.picked : ""} ${right ? styles.right : ""} ${wrong ? styles.wrong : ""}`}
                        onClick={() => onPick?.(q.id, v)}
                      >
                        <span className={styles.num}>{k + 1}</span>
                        {c}
                      </button>
                    );
                  })}
                </div>
              )}

              {q.qtype === "image" && (
                <div className={styles.imgChoices} role={editable ? "radiogroup" : undefined} aria-label={`${i + 1}번 보기`}>
                  {q.choices.map((src, k) => {
                    const v = String(k + 1);
                    const picked = mine === v;
                    const right = revealed && q.answer === v;
                    const wrong = revealed && picked && !right;
                    return (
                      <button
                        key={k}
                        type="button"
                        role={editable ? "radio" : undefined}
                        aria-checked={editable ? picked : undefined}
                        aria-label={`${k + 1}번 그림`}
                        disabled={!editable}
                        className={`${styles.imgChoice} ${picked ? styles.picked : ""} ${right ? styles.right : ""} ${wrong ? styles.wrong : ""}`}
                        onClick={() => onPick?.(q.id, v)}
                      >
                        <img src={src} alt="" loading="lazy" />
                        <span className={styles.num}>{k + 1}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {q.qtype === "short" && (
                <label className={styles.short}>
                  <span className={styles.shortLabel}>답</span>
                  <input
                    className={styles.shortInput}
                    type="text"
                    maxLength={100}
                    value={mine}
                    readOnly={!editable}
                    placeholder={editable ? "여기에 적어요" : "안 적음"}
                    onChange={(e) => onPick?.(q.id, e.target.value)}
                  />
                  {revealed && <span className={styles.shortKey}>정답: {q.answer}</span>}
                </label>
              )}

              {revealed && (
                <span className={`${styles.verdict} ${q.myCorrect ? styles.ok : styles.no}`}>
                  {q.myCorrect ? <Check size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
                  {q.myCorrect ? (q.myAccepted ? "인정" : "정답") : "오답"} · 정답률 {q.rate}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ExamPanel({ quiz }: { quiz: ExamView }) {
  const qc = useQueryClient();
  const now = useNow();
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(readStorage(draftKey(quiz.id)) || "{}");
    } catch {
      return {};
    }
  });
  const [busy, setBusy] = useState(false);

  const submitted = !!quiz.mine;
  const closesAt = quiz.closesAt ? new Date(quiz.closesAt).getTime() : 0;
  const isOpen = quiz.status === "open" && closesAt > now;
  const canEdit = isOpen && !submitted;

  // 응시 중 임시저장(새로고침해도 고른 답이 남게)
  useEffect(() => {
    if (canEdit) writeStorage(draftKey(quiz.id), JSON.stringify(answers));
  }, [answers, canEdit, quiz.id]);

  const shown = submitted ? quiz.mine!.answers : answers;
  const done = quiz.questions.filter((q) => (shown[String(q.id)] ?? "").trim() !== "").length;

  async function submit() {
    const left = quiz.questions.length - done;
    const msg = left > 0 ? `안 푼 문항이 ${left}개 있어요. 그래도 제출할까요? 제출하면 고칠 수 없어요.` : "답안을 제출할까요? 제출하면 고칠 수 없어요.";
    if (!(await confirmDialog(msg, { okText: "제출" }))) return;
    setBusy(true);
    try {
      await apiFetch(API.quiz, { body: { action: "submit-exam", quizId: quiz.id, answers } });
      writeStorage(draftKey(quiz.id), null);
      toast("답안을 제출했어요.");
    } catch (e) {
      const code = e instanceof ApiError ? String(e.body.error ?? "") : "";
      toast(QUIZ_ERRORS[code] || "제출에 실패했어요. 다시 눌러주세요.", "error");
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["quiz"] });
    }
  }

  if (quiz.status === "revealed") return <ExamResult quiz={quiz} />;

  const pick = (qid: number, v: string) => setAnswers((a) => ({ ...a, [String(qid)]: v }));
  const urgent = isOpen && closesAt - now < 60_000;

  return (
    <div className="split">
      <div className="split-main">
        <ExamPaper quiz={quiz} answers={shown} onPick={canEdit ? pick : undefined} />
        {canEdit && (
          <div className={styles.paperFoot}>
            <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={submit}>
              답안 제출 ({done}/{quiz.questions.length})
            </button>
          </div>
        )}
      </div>
      <aside className="split-aside split-aside-first">
        <Card title="답안지" tone={canEdit ? "feature" : undefined}>
          <div className={styles.sheetBody}>
            <div className={styles.sheetTop}>
              {isOpen ? (
                <span className={`${styles.timer} ${urgent ? styles.urgent : ""}`}>
                  <Clock size={14} aria-hidden="true" /> 남은 시간 <b className="num">{leftText(closesAt - now)}</b>
                </span>
              ) : (
                <span className={styles.timer}>마감됐어요 · 채점 중</span>
              )}
              <b className="num">
                {done} / {quiz.questions.length}
              </b>
            </div>
            <div className={styles.omr}>
              {quiz.questions.map((q, i) => {
                const v = (shown[String(q.id)] ?? "").trim();
                const label = !v ? "–" : q.qtype === "short" ? "작성" : CIRCLED[Number(v) - 1];
                return (
                  <button
                    key={q.id}
                    type="button"
                    className={`${styles.omrCell} ${v ? styles.omrDone : ""}`}
                    aria-label={`${i + 1}번${v ? ", 푼 문항" : ", 안 푼 문항"}`}
                    onClick={() => document.getElementById(`q-${q.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  >
                    <small>{i + 1}</small>
                    <b>{label}</b>
                  </button>
                );
              })}
            </div>
            {submitted ? (
              <p className={`${styles.banner} ${styles.bannerOk}`}>
                <Check size={16} aria-hidden="true" /> 제출 완료! 결과 발표를 기다려주세요.
              </p>
            ) : canEdit ? (
              <>
                <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={submit}>
                  답안 제출
                </button>
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                  한 번 제출하면 고칠 수 없어요.
                </p>
              </>
            ) : (
              <p className={styles.banner}>응시 시간이 끝났어요. 이번 회차엔 제출하지 않았어요.</p>
            )}
          </div>
        </Card>
        <ExamInfo quiz={quiz} />
      </aside>
    </div>
  );
}

function ExamInfo({ quiz }: { quiz: ExamView }) {
  return (
    <Card title="이번 시험" tone="quiet">
      <div className={styles.rows}>
        <div className={styles.row}>
          <span>문항</span>
          <b>
            {quiz.questions.length}문항 · {quiz.totalPoints}점
          </b>
        </div>
        {quiz.rewardRanks.length > 0 && (
          <div className={styles.row}>
            <span>보상</span>
            <b style={{ color: "var(--c-gold)", textAlign: "right" }}>{quiz.rewardRanks.map((p, i) => `${i + 1}등 ${fmt(p)}P`).join(" · ")}</b>
          </div>
        )}
        <div className={styles.row}>
          <span>제출</span>
          <b className="num">{quiz.participants}명</b>
        </div>
      </div>
    </Card>
  );
}

const rankClass = (r: number) => (r === 1 ? styles.gold : r === 2 ? styles.silver : r === 3 ? styles.bronze : "");

function ExamResult({ quiz }: { quiz: ExamView }) {
  const [onlyWrong, setOnlyWrong] = useState(false);
  const mine = quiz.mine;
  const correct = quiz.questions.filter((q) => q.myCorrect).length;
  const killer = useMemo(() => [...quiz.questions].sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0))[0], [quiz.questions]);
  const rows = quiz.questions.map((q, i) => ({ q, no: i + 1 })).filter(({ q }) => !onlyWrong || !q.myCorrect);
  const show = (q: ExamQuestion, v: string | undefined) => (!v ? "–" : q.qtype === "short" ? v : CIRCLED[Number(v) - 1] ?? v);

  return (
    <div className="split">
      <div className="split-main">
        <Card tone="feature">
          {mine ? (
            <div className={styles.score}>
              <div className={`${styles.scoreItem} ${styles.scoreBig}`}>
                <span>내 점수</span>
                <b>
                  {mine.score ?? 0}
                  <small> / {quiz.totalPoints}</small>
                </b>
              </div>
              <div className={styles.divider} />
              <div className={styles.scoreItem}>
                <span>순위</span>
                <b className={rankClass(mine.rank ?? 0)}>
                  {mine.rank}위<small> / {quiz.participants}명</small>
                </b>
              </div>
              <div className={styles.divider} />
              <div className={styles.scoreItem}>
                <span>맞힌 문항</span>
                <b>
                  {correct}
                  <small> / {quiz.questions.length}</small>
                </b>
              </div>
              {quiz.myReward && (
                <p className={`${styles.banner} ${styles.bannerOk}`} style={{ marginLeft: "auto" }}>
                  <Trophy size={16} aria-hidden="true" /> {quiz.myReward.label} 보상 +{fmt(quiz.myReward.amount)}P{quiz.isTest ? " (테스트라 실제 지급 안 됨)" : ""}
                </p>
              )}
            </div>
          ) : (
            <p className={styles.banner}>이번 회차엔 응시하지 않았어요. 정답과 순위는 아래에서 볼 수 있어요.</p>
          )}
        </Card>

        <Card
          title="문항별 결과"
          extra={
            mine && (
              <div className="segment" style={{ marginLeft: "auto" }} role="tablist">
                <button type="button" role="tab" aria-selected={!onlyWrong} onClick={() => setOnlyWrong(false)}>
                  전체
                </button>
                <button type="button" role="tab" aria-selected={onlyWrong} onClick={() => setOnlyWrong(true)}>
                  틀린 문항만
                </button>
              </div>
            )
          }
        >
          <div className={styles.table}>
            <div className={`${styles.tr} ${styles.th}`}>
              <span>번호</span>
              <span>문제</span>
              <span>내 답</span>
              <span>정답</span>
              <span>정답률</span>
            </div>
            {rows.map(({ q, no }) => (
              <div key={q.id} className={`${styles.tr} ${mine && !q.myCorrect ? styles.trWrong : ""}`}>
                <b className={`num ${mine ? (q.myCorrect ? styles.ok : styles.no) : ""}`}>
                  {mine ? (q.myCorrect ? "○" : "✕") : ""} {no}
                </b>
                <span className={styles.ellipsis}>{q.prompt.replace(/__/g, "")}</span>
                <b style={{ color: q.myAccepted ? "var(--c-gold)" : undefined }}>
                  {show(q, mine?.answers[String(q.id)])}
                  {q.myAccepted ? " (인정)" : ""}
                </b>
                <b>{show(q, q.answer)}</b>
                <span className={styles.bar}>
                  <span>
                    <i style={{ width: `${q.rate ?? 0}%` }} />
                  </span>
                  <b className="num">{q.rate ?? 0}%</b>
                </span>
              </div>
            ))}
          </div>
        </Card>

        {mine && <ExamPaper quiz={quiz} answers={mine.answers} revealed />}
      </div>
      <aside className="split-aside">
        <Card title="이번 회차 순위">
          <ol className={styles.rank}>
            {quiz.ranking.map((r) => (
              <li key={r.rank} className={r.isMe ? styles.me : ""}>
                <b className={`${styles.rankNo} ${rankClass(r.rank)}`}>{r.rank}</b>
                <span className={styles.rankName}>{r.name}</span>
                <b className="num">{r.score}점</b>
              </li>
            ))}
          </ol>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            같은 점수면 먼저 제출한 사람이 위예요.
          </p>
        </Card>
        {killer && (
          <Card title="킬러 문항">
            <div className={styles.killer}>
              <b>
                {quiz.questions.indexOf(killer) + 1}. <Prompt text={killer.prompt} />
              </b>
              <span className="muted" style={{ fontSize: 13 }}>
                정답률 <b className="num">{killer.rate}%</b>
              </span>
            </div>
          </Card>
        )}
      </aside>
    </div>
  );
}
