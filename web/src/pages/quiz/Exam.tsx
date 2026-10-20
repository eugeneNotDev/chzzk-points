// 퀴즈(유진고사) — 모의고사(시청자). 제출 마감 전까진 시험지를 풀고 몇 번이든 다시 제출할 수 있음.
// 채점은 방송에서 시험지를 한 장씩 띄워 놓고 함(관리자 화면). 결과 발표 뒤엔 맞은 수·순위·내 시험지 채점 결과.
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Trophy } from "lucide-react";
import { Card } from "../../components/Card";
import { apiFetch, ApiError } from "../../lib/auth";
import { API } from "../../lib/config";
import { confirmDialog, toast } from "../../lib/dialog";
import { fmt } from "../../lib/format";
import { QUIZ_ERRORS, underlineParts, type ExamView, type QType } from "../../lib/quiz";
import { readStorage, writeStorage } from "../../lib/storage";
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

export type PaperQuestion = { id: number; qtype: QType; prompt: string; imageUrl: string | null; choices: string[]; answer?: string };

// 시험지 한 장. 실제 시험지처럼 왼쪽 단을 위에서 아래로 다 채운 뒤 오른쪽 단으로 넘어감(폰에선 한 단).
//  - onPick: 시청자가 푸는 중
//  - marks: 채점 결과(빨간 펜 ○/✕) — 관리자 채점 화면, 결과 발표 뒤 내 시험지
//  - onMark: 관리자가 문항마다 ○/✕를 매김
//  - showKey: 정답 표시(관리자)
export function ExamPaper({
  title,
  subtitle,
  questions,
  answers,
  onPick,
  marks,
  onMark,
  showKey = false,
}: {
  title: string;
  subtitle: string;
  questions: PaperQuestion[];
  answers: Record<string, string>;
  onPick?: (qid: number, v: string) => void;
  marks?: Record<string, boolean | undefined>;
  onMark?: (qid: number, v: boolean | null) => void;
  showKey?: boolean;
}) {
  const half = Math.ceil(questions.length / 2);
  const cols = [questions.slice(0, half), questions.slice(half)];
  const editable = !!onPick;

  const renderQ = (q: PaperQuestion, no: number) => {
    const mine = answers[String(q.id)] ?? "";
    const mark = marks?.[String(q.id)];
    const key = showKey ? q.answer : undefined;
    return (
      <div key={q.id} id={`q-${q.id}`} className={styles.q}>
        <div className={styles.qTitle}>
          {onMark ? (
            // 채점: 번호를 누르면 ○ → ✕ → 지움 순서로 바뀜(옆 ○/✕ 버튼으로 바로 골라도 됨)
            <button
              type="button"
              className={`${styles.qNo} ${styles.qNoBtn} ${mark === true ? styles.markO : mark === false ? styles.markX : ""}`}
              aria-label={`${no}번 채점: ${mark === true ? "맞음" : mark === false ? "틀림" : "안 매김"}`}
              onClick={() => onMark(q.id, mark === undefined ? true : mark === true ? false : null)}
            >
              {no}.
            </button>
          ) : (
            <span className={`${styles.qNo} ${mark === true ? styles.markO : mark === false ? styles.markX : ""}`}>{no}.</span>
          )}
          <span style={{ flex: 1, minWidth: 0 }}>
            <Prompt text={q.prompt} />
            {q.qtype === "short" && <span className={styles.qMeta}>[단답형]</span>}
          </span>
        </div>
        {q.imageUrl && <img className={styles.qImage} src={q.imageUrl} alt="문제 그림" loading="lazy" />}

        {q.qtype === "choice" && (
          <div className={styles.choices} role={editable ? "radiogroup" : undefined} aria-label={`${no}번 보기`}>
            {q.choices.map((c, k) => {
              const v = String(k + 1);
              const picked = mine === v;
              return (
                <button
                  key={k}
                  type="button"
                  role={editable ? "radio" : undefined}
                  aria-checked={editable ? picked : undefined}
                  disabled={!editable}
                  className={`${styles.choice} ${picked ? styles.picked : ""} ${key === v ? styles.keyed : ""}`}
                  onClick={() => onPick?.(q.id, v)}
                >
                  <span className={styles.num}>{k + 1}</span>
                  <span>{c}</span>
                </button>
              );
            })}
          </div>
        )}

        {q.qtype === "image" && (
          <div className={styles.imgChoices} role={editable ? "radiogroup" : undefined} aria-label={`${no}번 보기`}>
            {q.choices.map((src, k) => {
              const v = String(k + 1);
              const picked = mine === v;
              return (
                <button
                  key={k}
                  type="button"
                  role={editable ? "radio" : undefined}
                  aria-checked={editable ? picked : undefined}
                  aria-label={`${k + 1}번 그림`}
                  disabled={!editable}
                  className={`${styles.imgChoice} ${picked ? styles.picked : ""} ${key === v ? styles.keyed : ""}`}
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
            {key && <span className={styles.shortKey}>정답: {key}</span>}
          </label>
        )}

        {onMark && (
          <div className={styles.markBar}>
            <span className={styles.markLabel}>채점</span>
            <button type="button" className={`${styles.markBtn} ${mark === true ? styles.markBtnO : ""}`} aria-label={`${no}번 맞음`} aria-pressed={mark === true} onClick={() => onMark(q.id, mark === true ? null : true)}>
              ○ 맞음
            </button>
            <button type="button" className={`${styles.markBtn} ${mark === false ? styles.markBtnX : ""}`} aria-label={`${no}번 틀림`} aria-pressed={mark === false} onClick={() => onMark(q.id, mark === false ? null : false)}>
              ✕ 틀림
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className={styles.paper} aria-label="시험지">
      <div className={styles.paperHead}>
        <span className={styles.paperRound}>{title}</span>
        <span className={styles.paperArea}>{subtitle || "유진 영역"}</span>
      </div>
      <div className={styles.paperRule} />
      <div className={styles.questions}>
        {cols.map((col, ci) => (
          <div key={ci} className={styles.qCol}>
            {col.map((q, i) => renderQ(q, ci * half + i + 1))}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ExamPanel({ quiz }: { quiz: ExamView }) {
  const qc = useQueryClient();
  const isOpen = quiz.status === "open";
  const submitted = !!quiz.mine;
  const canEdit = isOpen && !submitted; // 제출은 한 번만 — 낸 뒤엔 고칠 수 없음
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(readStorage(draftKey(quiz.id)) || "{}");
    } catch {
      return {};
    }
  });
  const [busy, setBusy] = useState(false);

  // 제출 전 임시저장(새로고침해도 고른 답이 남게)
  useEffect(() => {
    if (canEdit) writeStorage(draftKey(quiz.id), JSON.stringify(answers));
  }, [answers, canEdit, quiz.id]);

  const shown = submitted ? quiz.mine!.answers : answers;
  const done = quiz.questions.filter((q) => (shown[String(q.id)] ?? "").trim() !== "").length;

  async function submit() {
    const left = quiz.questions.length - done;
    const msg = `${left > 0 ? `안 푼 문항이 ${left}개 있어요. ` : ""}제출하면 고칠 수 없어요. 제출할까요?`;
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

  return (
    <div className="split">
      <div className="split-main">
        <ExamPaper title={quiz.title} subtitle={quiz.subtitle} questions={quiz.questions} answers={shown} onPick={canEdit ? pick : undefined} />
        {canEdit && (
          <div className={styles.paperFoot}>
            <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={submit}>
              답안 제출 ({done}/{quiz.questions.length})
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              한 번 제출하면 고칠 수 없어요.
            </span>
          </div>
        )}
      </div>
      <aside className="split-aside split-aside-first">
        <Card title="답안지" tone={canEdit ? "feature" : undefined}>
          <div className={styles.sheetBody}>
            <div className={styles.sheetTop}>
              <span className={`${styles.timer} ${isOpen ? "" : styles.urgent}`}>{isOpen ? "제출 받는 중" : "제출 마감 · 방송에서 채점 중"}</span>
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
            {submitted && (
              <p className={`${styles.banner} ${styles.bannerOk}`}>
                <Check size={16} aria-hidden="true" /> 제출 완료! 방송에서 채점한 뒤 결과를 발표해요.
              </p>
            )}
            {canEdit && (
              <>
                <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={submit}>
                  답안 제출
                </button>
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                  한 번 제출하면 고칠 수 없어요.
                </p>
              </>
            )}
            {!isOpen && !submitted && <p className={styles.banner}>제출이 마감됐어요. 이번 회차엔 제출하지 않았어요.</p>}
          </div>
        </Card>
        <Card title="이번 시험" tone="quiet">
          <div className={styles.rows}>
            <div className={styles.row}>
              <span>문항</span>
              <b>{quiz.questions.length}문항 · 맞힌 개수로 순위</b>
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
      </aside>
    </div>
  );
}

const rankClass = (r: number) => (r === 1 ? styles.gold : r === 2 ? styles.silver : r === 3 ? styles.bronze : "");

function ExamResult({ quiz }: { quiz: ExamView }) {
  const [onlyWrong, setOnlyWrong] = useState(false);
  const mine = quiz.mine;
  const correct = quiz.questions.filter((q) => q.myCorrect).length;
  const killer = useMemo(() => [...quiz.questions].sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0))[0], [quiz.questions]);
  const rows = quiz.questions.map((q, i) => ({ q, no: i + 1 })).filter(({ q }) => !onlyWrong || !q.myCorrect);
  const show = (qtype: QType, v: string | undefined) => (!v ? "–" : qtype === "short" ? v : CIRCLED[Number(v) - 1] ?? v);
  const marks = useMemo(() => Object.fromEntries(quiz.questions.map((q) => [String(q.id), q.myCorrect ?? undefined])), [quiz.questions]);

  return (
    <div className="split">
      <div className="split-main">
        <Card tone="feature">
          {mine ? (
            <div className={styles.score}>
              <div className={`${styles.scoreItem} ${styles.scoreBig}`}>
                <span>맞힌 문항</span>
                <b>
                  {correct}
                  <small> / {quiz.questions.length}</small>
                </b>
              </div>
              <div className={styles.divider} />
              <div className={styles.scoreItem}>
                <span>순위</span>
                <b className={rankClass(mine.rank ?? 0)}>
                  {mine.rank}위<small> / {quiz.participants}명</small>
                </b>
              </div>
              {quiz.myReward && (
                <p className={`${styles.banner} ${styles.bannerOk}`} style={{ marginLeft: "auto" }}>
                  <Trophy size={16} aria-hidden="true" /> {quiz.myReward.label} 보상 +{fmt(quiz.myReward.amount)}P{quiz.isTest ? " (테스트라 실제 지급 안 됨)" : ""}
                </p>
              )}
            </div>
          ) : (
            <p className={styles.banner}>이번 회차엔 제출하지 않았어요. 정답과 순위는 아래에서 볼 수 있어요.</p>
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
                <b>{show(q.qtype, mine?.answers[String(q.id)])}</b>
                <b>{show(q.qtype, q.answer)}</b>
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

        {mine && <ExamPaper title={quiz.title} subtitle={quiz.subtitle} questions={quiz.questions} answers={mine.answers} marks={marks} />}
      </div>
      <aside className="split-aside">
        <Card title="이번 회차 순위">
          <ol className={styles.rank}>
            {quiz.ranking.map((r) => (
              <li key={r.rank} className={r.isMe ? styles.me : ""}>
                <b className={`${styles.rankNo} ${rankClass(r.rank)}`}>{r.rank}</b>
                <span className={styles.rankName}>{r.name}</span>
                <b className="num">{r.score}개</b>
              </li>
            ))}
          </ol>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            맞힌 개수가 같으면 먼저 제출한 사람이 위예요.
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
