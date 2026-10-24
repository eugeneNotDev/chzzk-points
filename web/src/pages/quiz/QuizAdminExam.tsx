// 퀴즈 관리자 — 모의고사(문항 만들기, 채점 탭, 채점 방송 화면)
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MonitorPlay, Wand2 } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { confirmDialog } from "../../lib/dialog";
import { adminCall, useAct, useQuizAdminLive, useStreamTitle, type Detail } from "./quizAdminShared";
import styles from "./Quiz.module.css";
import { GradingTab } from "./ExamGrading";
import { QuestionsTab } from "./ExamQuestions";

// ── 모의고사 ──
type ExamTab = "questions" | "grading" | "ranking";

export function ExamAdmin({ d }: { d: Detail }) {
  const { act, busy } = useAct();
  const quiz = d.quiz;
  const exam = d.exam!;
  const [tab, setTab] = useState<ExamTab>(quiz.status === "draft" ? "questions" : "grading");

  async function control(action: string, msg: string, confirmMsg: string) {
    if (!(await confirmDialog(confirmMsg))) return;
    if ((await act({ action, quizId: quiz.id }, msg)) && action === "open") setTab("grading");
  }

  async function autoAll() {
    if (!(await confirmDialog("모든 시험지의 아직 안 매긴 칸을 정답과 비교해서 자동으로 채울까요? 이미 ○/✕를 매긴 칸은 그대로 둬요.", { okText: "자동 채점" }))) return;
    await act({ action: "auto-mark", quizId: quiz.id, onlyEmpty: true }, "안 매긴 칸을 자동으로 채웠어요.");
  }

  async function reveal() {
    const msg =
      exam.unmarked > 0
        ? `아직 안 매긴 칸이 ${exam.unmarked}개 있어요. 안 매긴 칸은 틀린 걸로 치고 결과를 발표할까요?`
        : "맞힌 개수로 순위를 확정하고 결과를 발표할까요? 시청자 화면에 정답이 공개돼요.";
    if (!(await confirmDialog(msg, { okText: "결과 발표" }))) return;
    await act({ action: "reveal", quizId: quiz.id }, "결과를 발표했어요.");
  }

  return (
    <>
      <Card className={styles.admin} title="진행">
        <div className={styles.actions}>
          {quiz.status === "draft" && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || d.questions.length === 0}
                onClick={() => control("open", "제출을 받기 시작했어요.", `${d.questions.length}문항으로 제출을 받기 시작할까요? 시작하면 문항을 추가·삭제할 수 없어요. 제한시간은 없고, 제출 마감을 누를 때까지 받아요.`)}
              >
                제출 받기 시작
              </button>
              <span className="muted">문항 {d.questions.length}개</span>
            </>
          )}
          {quiz.status === "open" && (
            <>
              <span className="tag tag-live">제출 받는 중</span>
              <span className="muted">제출 {exam.sheets.length}장</span>
              <button type="button" className="btn" disabled={busy} onClick={() => control("close", "제출을 마감했어요. 이제 채점할 수 있어요.", "제출을 마감할까요? 마감하면 시청자가 더 내거나 고칠 수 없어요.")}>
                제출 마감
              </button>
            </>
          )}
          {quiz.status === "closed" && (
            <>
              <span className="tag tag-gold">채점 중</span>
              <span className="muted">
                {exam.sheets.length}장 · 안 매긴 칸 {exam.unmarked}개
              </span>
              <button type="button" className="btn btn-sm" disabled={busy || exam.unmarked === 0} onClick={autoAll}>
                <Wand2 size={16} aria-hidden="true" /> 안 매긴 칸 전부 자동 채점
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={reveal}>
                결과 발표
              </button>
            </>
          )}
          {quiz.status === "revealed" && <span className="muted">결과 발표가 끝났어요. 채점을 고치면 순위도 다시 계산돼요(보상 지급 전까지).</span>}
        </div>
      </Card>

      <div className={styles.actions}>
      <div className="segment" role="tablist" aria-label="모의고사 관리">
        <button type="button" role="tab" aria-selected={tab === "questions"} onClick={() => setTab("questions")}>
          문항 {d.questions.length}
        </button>
        <button type="button" role="tab" aria-selected={tab === "grading"} disabled={quiz.status === "draft"} onClick={() => setTab("grading")}>
          제출된 시험지 {exam.sheets.length}
        </button>
        <button type="button" role="tab" aria-selected={tab === "ranking"} disabled={quiz.status === "draft"} onClick={() => setTab("ranking")}>
          순위
        </button>
      </div>
        {quiz.status !== "draft" && (
          <button
            type="button"
            className={`btn btn-sm ${styles.mlAuto}`}
            title="시험지를 크게 띄우고 그 창에서 바로 ○/✕를 매겨요. 정답은 안 보여요."
            onClick={() => window.open(`${location.pathname}?grade=${quiz.id}`, `quiz-grade-${quiz.id}`, "width=1280,height=900")}
          >
            <MonitorPlay size={16} aria-hidden="true" /> 채점 방송 화면 열기
          </button>
        )}
      </div>

      {tab === "questions" && <QuestionsTab d={d} />}
      {tab === "grading" && <GradingTab d={d} />}
      {tab === "ranking" && (
        <Card className={styles.admin} title={quiz.status === "revealed" ? "확정 순위" : "지금 기준 순위"}>
          {exam.ranking.length === 0 ? (
            <EmptyState>아직 제출한 사람이 없어요.</EmptyState>
          ) : (
            <ol className={styles.rank}>
              {exam.ranking.map((r) => (
                <li key={r.rank}>
                  <b className={styles.rankNo}>{r.rank}</b>
                  <span className={styles.rankName}>{r.name}</span>
                  <span className={`muted num ${styles.fs12}`}>
                    {r.marked < d.questions.length ? `채점 ${r.marked}/${d.questions.length}` : "채점 끝"}
                  </span>
                  <b className="num">{r.score}개</b>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </>
  );
}

// 모의고사 채점 방송 화면 — 관리 탭의 "채점 방송 화면 열기"로 뜨는 창. 이 창에서 바로 채점함(정답은 안 보임).
export function ExamGradeStream({ quizId }: { quizId: number }) {
  useStreamTitle("유진고사 채점 방송화면 · 유진 팬보드");
  const q = useQuery({ queryKey: ["quiz-admin", quizId], refetchInterval: 15_000, queryFn: () => adminCall<Detail>({ action: "get", quizId }) });
  useQuizAdminLive(quizId);
  if (!q.data) return <div className={styles.stream}><span className={styles.streamHint}>불러오는 중…</span></div>;
  return <GradingTab d={q.data} stream />;
}
