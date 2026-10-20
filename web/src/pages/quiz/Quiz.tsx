// 퀴즈 — 방송 중에 여는 모의고사(유진고사, 시험지)·OX 퀴즈. 진행 중인 회차가 있을 때만 메뉴에 뜸(nav.ts quiz).
// 모의고사는 며칠씩 열어둘 수 있어서, 그 사이에 OX가 열리면 둘을 위쪽 버튼으로 오가며 봄.
// 관리자는 "관리" 탭에서 회차를 만들고 진행함(QuizAdmin).
import { lazy, Suspense, useState } from "react";
import { ChevronLeft, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, EmptyState } from "../../components/Card";
import { LoginNeeded, PageHead } from "../../components/ui";
import { PillTabs } from "../../components/PillTabs";
import { apiFetch, ApiError, useAuth } from "../../lib/auth";
import { API } from "../../lib/config";
import { confirmDialog, toast } from "../../lib/dialog";
import { fmt, shortDate } from "../../lib/format";
import { ADMIN_QUIZ_ERRORS, useQuiz, useQuizById, type QuizHistoryItem, type QuizView } from "../../lib/quiz";
import { ExamPanel } from "./Exam";
import { OxPanel } from "./Ox";
import styles from "./Quiz.module.css";

const QuizAdmin = lazy(() => import("./QuizAdmin"));
const OxStream = lazy(() => import("./QuizAdmin").then((m) => ({ default: m.OxStream })));

type Tab = "now" | "history" | "admin";

function QuizBody({ quiz }: { quiz: QuizView }) {
  return quiz.kind === "exam" ? <ExamPanel key={quiz.id} quiz={quiz} /> : <OxPanel key={quiz.id} quiz={quiz} />;
}

function QuizTags({ quiz }: { quiz: QuizView }) {
  const label = quiz.status === "open" ? (quiz.kind === "exam" ? "제출 받는 중" : "진행 중") : quiz.status === "closed" ? "채점 중" : quiz.kind === "exam" ? "결과 발표" : "종료";
  return (
    <div className={styles.tags}>
      <span className="tag">{quiz.kind === "exam" ? "모의고사" : "OX 퀴즈"}</span>
      <span className={`tag ${quiz.status === "revealed" ? "tag-accent" : "tag-live"}`}>{label}</span>
      {quiz.isTest && <span className={`tag ${styles.testTag}`}>테스트 회차</span>}
      <b style={{ fontSize: 15 }}>{quiz.title}</b>
    </div>
  );
}

export default function Quiz() {
  const { isLoggedIn, isAdmin } = useAuth();
  const q = useQuiz();
  const [tab, setTab] = useState<Tab>("now");
  const [pastId, setPastId] = useState<number | null>(null);
  const [pickKind, setPickKind] = useState<"exam" | "ox" | null>(null);

  // 방송 화면(OX) — 리모컨의 "방송 화면 열기"로 뜨는 창. 관리자만.
  const streamId = Number(new URLSearchParams(location.search).get("stream"));
  if (isAdmin && Number.isInteger(streamId) && streamId > 0) {
    return (
      <Suspense fallback={null}>
        <OxStream quizId={streamId} />
      </Suspense>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="page">
        <PageHead title="퀴즈" desc="방송 중에 열리는 유진고사(모의고사)와 OX 퀴즈예요." />
        <Card>
          <LoginNeeded>로그인하면 시험에 참여할 수 있어요.</LoginNeeded>
        </Card>
      </div>
    );
  }

  const live = q.data?.quizzes ?? [];
  const quiz = live.find((x) => x.kind === pickKind) ?? live[0] ?? null;
  const tabs = [
    { value: "now" as Tab, label: "지금 회차" },
    { value: "history" as Tab, label: "지난 기록" },
    ...(isAdmin ? [{ value: "admin" as Tab, label: "관리" }] : []),
  ];

  return (
    <div className="page">
      <PageHead
        title="퀴즈"
        desc="방송 중에 열리는 유진고사(모의고사)와 OX 퀴즈예요. 순위권·생존자에게 포인트를 드려요."
        actions={<PillTabs label="퀴즈 보기" value={tab} options={tabs} onChange={(t) => {
              setTab(t);
              setPastId(null);
            }} />}
      />

      {tab === "now" && (
        <>
          {q.isLoading && <span className="skeleton" style={{ height: 320 }} />}
          {!q.isLoading && !quiz && (
            <Card>
              <EmptyState>지금 열린 퀴즈가 없어요. 방송 중에 유진고사나 OX 퀴즈가 열리면 메뉴에 나타나요.</EmptyState>
            </Card>
          )}
          {live.length > 1 && (
            <div className="segment" role="tablist" aria-label="열린 퀴즈">
              {live.map((x) => (
                <button key={x.id} type="button" role="tab" aria-selected={x.id === quiz?.id} onClick={() => setPickKind(x.kind)}>
                  {x.kind === "ox" ? "OX 퀴즈" : "유진고사"}
                </button>
              ))}
            </div>
          )}
          {quiz && (
            <>
              <QuizTags quiz={quiz} />
              <QuizBody quiz={quiz} />
            </>
          )}
        </>
      )}

      {tab === "history" &&
        (pastId != null ? <PastQuiz id={pastId} onBack={() => setPastId(null)} /> : <History items={q.data?.history ?? []} onOpen={setPastId} />)}

      {tab === "admin" && isAdmin && (
        <Suspense fallback={<span className="skeleton" style={{ height: 320 }} />}>
          <QuizAdmin />
        </Suspense>
      )}
    </div>
  );
}

// 지난 기록 — 관리자는 회차를 지울 수 있음(진행 중인 실제 회차 빼고. 이미 지급한 포인트는 그대로 남음)
function History({ items, onOpen }: { items: QuizHistoryItem[]; onOpen: (id: number) => void }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);

  async function remove(h: QuizHistoryItem) {
    const msg = `"${h.title}" 회차를 삭제할까요? 모든 사람의 기록에서 사라져요.${!h.isTest && h.reward ? " 이미 지급한 포인트는 그대로 남아요." : ""}`;
    if (!(await confirmDialog(msg, { danger: true }))) return;
    setBusy(h.id);
    try {
      await apiFetch(API.adminQuiz, { body: { action: "delete", quizId: h.id } });
      toast("삭제했어요.");
    } catch (e) {
      const code = e instanceof ApiError ? String(e.body.error ?? "") : "";
      toast(ADMIN_QUIZ_ERRORS[code] || "삭제하지 못했어요.", "error");
    } finally {
      setBusy(null);
      ["quiz", "quiz-peek", "quiz-admin-list", "quiz-admin"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    }
  }

  return (
    <Card title="내 지난 기록">
      {items.length === 0 ? (
        <EmptyState>아직 참여한 퀴즈가 없어요.</EmptyState>
      ) : (
        <div>
          {items.map((h) => (
            <div key={h.id} className={styles.histItem}>
              <button type="button" className="list-row" style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }} onClick={() => onOpen(h.id)}>
                <span className="list-row-title">
                  {h.title}
                  {h.isTest && <span className={`tag ${styles.testTag}`} style={{ marginLeft: 6 }}>테스트</span>}
                </span>
                <span className="list-row-meta">
                  {h.kind === "exam" ? `${h.score ?? 0}개 맞힘 · ${h.rank}위` : h.oxMode === "deathmatch" ? "OX 데스매치" : "OX 점수전"}
                  {h.reward ? ` · +${fmt(h.reward.amount)}P` : ""} · {shortDate(h.revealedAt)}
                </span>
              </button>
              {isAdmin && (
                <button type="button" className="btn btn-sm btn-ghost" aria-label={`${h.title} 삭제`} disabled={busy === h.id} onClick={() => remove(h)}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PastQuiz({ id, onBack }: { id: number; onBack: () => void }) {
  const q = useQuizById(id);
  const quiz = q.data?.quiz;
  return (
    <>
      <div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>
          <ChevronLeft size={16} aria-hidden="true" /> 지난 기록
        </button>
      </div>
      {q.isLoading && <span className="skeleton" style={{ height: 320 }} />}
      {!q.isLoading && !quiz && (
        <Card>
          <EmptyState>이 회차를 불러오지 못했어요.</EmptyState>
        </Card>
      )}
      {quiz && (
        <>
          <QuizTags quiz={quiz} />
          <QuizBody quiz={quiz} />
        </>
      )}
    </>
  );
}
