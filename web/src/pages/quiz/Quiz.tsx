// 퀴즈 — 방송 중에 여는 모의고사(유진고사, 시험지)·OX 퀴즈. 진행 중인 회차가 있을 때만 메뉴에 뜸(nav.ts quiz).
// 모의고사는 며칠씩 열어둘 수 있어서, 그 사이에 OX가 열리면 둘을 위쪽 버튼으로 오가며 봄.
// 관리자는 "관리" 탭에서 회차를 만들고 진행함(QuizAdmin).
import { lazy, Suspense, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2, Trophy } from "lucide-react";
import { readStorage, writeStorage } from "../../lib/storage";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Card, EmptyState } from "../../components/Card";
import { LoginNeeded, PageHead } from "../../components/ui";
import { PillTabs } from "../../components/PillTabs";
import { Pagination } from "../../components/Pagination";
import { LoadError } from "../../components/LoadError";
import { apiFetch, ApiError, useAuth } from "../../lib/auth";
import { API } from "../../lib/config";
import { confirmDialog, toast } from "../../lib/dialog";
import { fmt, shortDate } from "../../lib/format";
import { ADMIN_QUIZ_ERRORS, useQuiz, useQuizById, useQuizHistory, type QuizHistoryItem, type QuizView } from "../../lib/quiz";
import { ExamPanel } from "./Exam";
import { OxPanel } from "./Ox";
import styles from "./Quiz.module.css";

const QuizAdmin = lazy(() => import("./QuizAdmin"));
const OxStream = lazy(() => import("./QuizAdmin").then((m) => ({ default: m.OxStream })));
const ExamGradeStream = lazy(() => import("./QuizAdmin").then((m) => ({ default: m.ExamGradeStream })));

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
      <b className={styles.fs15}>{quiz.title}</b>
    </div>
  );
}

export default function Quiz() {
  const { isLoggedIn, isAdmin } = useAuth();
  const q = useQuiz();
  const hist = useQuizHistory();
  // 탭·지난 기록 상세는 주소(?tab=, ?past=)에 담아서 브라우저 뒤로가기로 한 단계씩 돌아오게 함
  const [params, setParams] = useSearchParams();
  const tp = params.get("tab");
  const tabPick: Tab | null = tp === "now" || tp === "history" || tp === "admin" ? tp : null;
  const setTab = (t: Tab) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set("tab", t);
      n.delete("past");
      return n;
    });
  const [pickKind, setPickKind] = useState<"exam" | "ox" | null>(null);

  // 방송 화면(OX) — 리모컨의 "방송 화면 열기"로 뜨는 창. 관리자만.
  const sp = new URLSearchParams(location.search);
  const streamId = Number(sp.get("stream"));
  const gradeId = Number(sp.get("grade"));
  if (isAdmin && Number.isInteger(gradeId) && gradeId > 0) {
    return (
      <Suspense fallback={null}>
        <ExamGradeStream quizId={gradeId} />
      </Suspense>
    );
  }
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

  // 지금 회차엔 진행 중(제출 받는 중·채점 중·OX 진행 중)인 것만. 끝난 회차 결과는 지난 기록에서 봄.
  const live = (q.data?.quizzes ?? []).filter((x) => x.status !== "revealed");
  // 처음 들어왔을 때 진행 중인 회차가 없으면 지난 기록부터 보여줌
  const tab: Tab = tabPick ?? (q.data && live.length === 0 && (hist.data?.history ?? []).length > 0 ? "history" : "now");
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
        actions={<PillTabs label="퀴즈 보기" value={tab} options={tabs} onChange={setTab} />}
      />

      {tab === "now" && (
        <>
          {q.isLoading && <span className={`skeleton ${styles.h320}`} />}
          {!q.isLoading && !quiz && (
            <Card>
              <EmptyState>지금 진행 중인 퀴즈가 없어요. 끝난 회차 결과는 "지난 기록"에서 볼 수 있어요.</EmptyState>
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
        (hist.isLoading ? (
          <span className={`skeleton ${styles.h320}`} />
        ) : hist.isError && !hist.data ? (
          <LoadError what="지난 기록" onRetry={() => hist.refetch()} />
        ) : (
          <History items={hist.data?.history ?? []} />
        ))}

      {tab === "admin" && isAdmin && (
        <Suspense fallback={<span className={`skeleton ${styles.h320}`} />}>
          <QuizAdmin />
        </Suspense>
      )}
    </div>
  );
}

// 지난 기록 — 위: 종류별(모의고사 / OX) 최근에 본 회차 간단 요약, 아래: 기록 목록(한 페이지 5개).
// 목록을 누르면 게시판 글처럼 따로 들어가서 시험지·문항별 결과 등 자세히 봄. 관리자는 회차를 지울 수 있음.
const HIST_PAGE = 5;
const LAST_SEEN_KEY = "chzzk_quiz_last_seen";

function readLastSeen(): Partial<Record<"exam" | "ox", number>> {
  try {
    return JSON.parse(readStorage(LAST_SEEN_KEY) || "{}");
  } catch {
    return {};
  }
}

function History({ items }: { items: QuizHistoryItem[] }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const openId = Number(params.get("past")) || null;
  const setOpenId = (id: number | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set("tab", "history");
      if (id == null) n.delete("past");
      else n.set("past", String(id));
      return n;
    });
  // 목록으로: 사이트 안에서 들어왔으면 브라우저 뒤로가기와 같게, 주소로 바로 들어왔으면 목록 주소로 바꿈
  const backToList = () => (location.key !== "default" ? navigate(-1) : setParams((p) => {
    const n = new URLSearchParams(p);
    n.delete("past");
    return n;
  }, { replace: true }));
  const [lastSeen, setLastSeen] = useState(readLastSeen);
  const totalPages = Math.max(1, Math.ceil(items.length / HIST_PAGE));
  const cur = Math.min(page, totalPages);
  const shown = items.slice((cur - 1) * HIST_PAGE, cur * HIST_PAGE);

  // 종류별 요약에 띄울 회차: 최근에 들어가 본 것, 없으면 가장 최근 회차
  const pickFor = (kind: "exam" | "ox") => {
    const seen = lastSeen[kind];
    return (items.find((h) => h.kind === kind && h.id === seen) ?? items.find((h) => h.kind === kind))?.id ?? null;
  };
  const examId = pickFor("exam");
  const oxId = pickFor("ox");

  function open(h: QuizHistoryItem) {
    const next = { ...lastSeen, [h.kind]: h.id };
    setLastSeen(next);
    writeStorage(LAST_SEEN_KEY, JSON.stringify(next));
    setOpenId(h.id);
    window.scrollTo({ top: 0 });
  }

  async function remove(h: QuizHistoryItem) {
    const msg = `"${h.title}" 회차를 삭제할까요? 모든 사람의 기록에서 사라져요.${!h.isTest && h.reward ? " 이미 지급한 포인트는 그대로 남아요." : ""}`;
    if (!(await confirmDialog(msg, { danger: true }))) return;
    setBusy(h.id);
    try {
      await apiFetch(API.adminQuiz, { body: { action: "delete", quizId: h.id } });
      toast("삭제했어요.");
      if (openId === h.id) setOpenId(null);
    } catch (e) {
      const code = e instanceof ApiError ? String(e.body.error ?? "") : "";
      toast(ADMIN_QUIZ_ERRORS[code] || "삭제하지 못했어요.", "error");
    } finally {
      setBusy(null);
      ["quiz", "quiz-history", "quiz-peek", "quiz-by-id", "quiz-admin-list", "quiz-admin"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    }
  }

  if (openId != null && items.some((h) => h.id === openId)) {
    return (
      <>
        <div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={backToList}>
            <ChevronLeft size={16} aria-hidden="true" /> 지난 기록
          </button>
        </div>
        <PastQuiz id={openId} />
      </>
    );
  }

  return (
    <>
      <div className={styles.sumGrid}>
        {examId != null ? <SummaryCard id={examId} onOpen={() => open(items.find((h) => h.id === examId)!)} /> : <EmptySummary kind="exam" />}
        {oxId != null ? <SummaryCard id={oxId} onOpen={() => open(items.find((h) => h.id === oxId)!)} /> : <EmptySummary kind="ox" />}
      </div>
      <Card title={`지난 기록 ${items.length}개`}>
        <div>
          {items.length === 0 && <EmptyState>아직 참여한 퀴즈가 없어요.</EmptyState>}
          {shown.map((h) => (
            <div key={h.id} className={styles.histItem}>
              <button
                type="button"
                className="list-row"
                style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}
                onClick={() => open(h)}
              >
                <span className={`list-row-title ${styles.histTitle}`}>
                  <span className={`tag ${h.kind === "exam" ? "" : "tag-blue"}`}>{h.kind === "exam" ? "모의고사" : "OX"}</span>
                  <span className={styles.histName}>{h.title}</span>
                  {h.isTest && <span className={`tag ${styles.testTag}`}>테스트</span>}
                </span>
                <span className="list-row-meta">
                  {h.kind === "exam" ? (h.rank != null ? `${h.score ?? 0}개 맞힘 · ${h.rank}위` : "참여 안 함") : h.oxMode === "deathmatch" ? "데스매치" : "점수전"}
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
        <Pagination page={cur} totalPages={totalPages} onChange={setPage} />
      </Card>
    </>
  );
}

function EmptySummary({ kind }: { kind: "exam" | "ox" }) {
  return (
    <Card className={styles.sumCard}>
      <div className={styles.sumHead}>
        <span className={`tag ${kind === "exam" ? "" : "tag-blue"}`}>{kind === "exam" ? "모의고사" : "OX 퀴즈"}</span>
      </div>
      <div className={styles.sumEmpty}>아직 참여한 {kind === "exam" ? "모의고사" : "OX 퀴즈"} 기록이 없어요.</div>
    </Card>
  );
}

// 요약 카드 — 모의고사: 맞힌 수·순위·보상 / OX: 결과(생존·탈락·순위)·맞힌 수·보상
function SummaryCard({ id, onOpen }: { id: number; onOpen: () => void }) {
  const q = useQuizById(id);
  const { isAdmin } = useAuth();
  const quiz = q.data?.quiz;
  if (q.isLoading) return <span className={`skeleton ${styles.h180}`} />;
  if (!quiz) return null;

  // 관리자가 직접 안 푼 회차는 "내 결과"(전부 –) 대신 회차 전체 숫자로
  const joined = quiz.kind === "exam" ? !!quiz.mine : quiz.me.joined;
  const overview = isAdmin && !joined;

  let stats: { label: string; value: string; sub?: string; accent?: boolean }[];
  if (overview && quiz.kind === "exam") {
    const top = quiz.ranking[0];
    stats = [
      { label: "응시", value: String(quiz.participants), sub: "명", accent: true },
      { label: "문항", value: String(quiz.questions.length), sub: "개" },
      { label: "1등", value: top ? String(top.score) : "–", sub: top ? "개" : undefined },
    ];
  } else if (overview && quiz.kind === "ox") {
    const dm = quiz.oxMode === "deathmatch";
    const top = quiz.ranking[0];
    stats = [
      { label: "참여", value: String(quiz.participants), sub: "명", accent: true },
      { label: "문제", value: String(quiz.revealedCount), sub: "개" },
      dm
        ? { label: "생존자", value: String(quiz.aliveCount), sub: "명" }
        : { label: "1등", value: top ? String(top.correct) : "–", sub: top ? "개" : undefined },
    ];
  } else if (quiz.kind === "exam") {
    const total = quiz.questions.length;
    const correct = quiz.mine ? quiz.questions.filter((x) => x.myCorrect).length : 0;
    stats = [
      { label: "맞힌 문항", value: quiz.mine ? String(correct) : "–", sub: `/ ${total}`, accent: true },
      { label: "순위", value: quiz.mine?.rank ? `${quiz.mine.rank}위` : "–", sub: `/ ${quiz.participants}명` },
    ];
  } else {
    const dm = quiz.oxMode === "deathmatch";
    const me = quiz.ranking.find((r) => r.isMe);
    stats = [
      { label: "결과", value: dm ? (quiz.me.joined ? (quiz.me.alive ? "생존" : "탈락") : "–") : me ? `${me.rank}위` : "–", accent: dm ? quiz.me.alive && quiz.me.joined : !!me },
      { label: "맞힌 문제", value: String(quiz.me.correct), sub: `/ ${quiz.revealedCount}` },
      { label: dm ? "생존자" : "참여", value: String(dm ? quiz.aliveCount : quiz.participants), sub: "명" },
    ];
  }

  return (
    <Card className={styles.sumCard}>
      <div className={styles.sumHead}>
        <span className={`tag ${quiz.kind === "exam" ? "" : "tag-blue"}`}>{quiz.kind === "exam" ? "모의고사" : quiz.oxMode === "deathmatch" ? "OX 데스매치" : "OX 점수전"}</span>
        {quiz.isTest && <span className={`tag ${styles.testTag}`}>테스트</span>}
        <span className={`muted ${styles.mlAuto} ${styles.fs12}`}>
          {quiz.revealedAt ? shortDate(quiz.revealedAt) : ""}
        </span>
      </div>
      <b className={styles.sumTitle}>{quiz.title}</b>
      <div className={styles.sumStats}>
        {stats.map((s) => (
          <div key={s.label} className={styles.sumStat}>
            <span>{s.label}</span>
            <b className={`num ${s.accent ? styles.sumAccent : ""}`}>
              {s.value}
              {s.sub && <small>{s.sub}</small>}
            </b>
          </div>
        ))}
      </div>
      <div className={styles.sumFoot}>
        {overview ? (
          <span className={`muted ${styles.fs13}`}>
            관리자 보기 · 회차 전체
          </span>
        ) : quiz.myReward ? (
          <span className={styles.sumReward}>
            <Trophy size={14} aria-hidden="true" /> {quiz.myReward.label} +{fmt(quiz.myReward.amount)}P
          </span>
        ) : (
          <span className={`muted ${styles.fs13}`}>
            보상 없음
          </span>
        )}
        <button type="button" className="btn btn-sm" onClick={onOpen}>
          자세히 보기 <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </Card>
  );
}

function PastQuiz({ id }: { id: number }) {
  const q = useQuizById(id);
  const quiz = q.data?.quiz;
  if (q.isLoading) return <span className={`skeleton ${styles.h320}`} />;
  if (!quiz)
    return (
      <Card>
        <EmptyState>이 회차를 불러오지 못했어요.</EmptyState>
      </Card>
    );
  return (
    <>
      <QuizTags quiz={quiz} />
      <QuizBody quiz={quiz} />
    </>
  );
}
