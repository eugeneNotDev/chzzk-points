// 퀴즈(유진고사) — 관리자(유진 알파 계정). 서버: admin-quiz 함수.
//  모의고사: 문항 만들기 → 제출 받기(제한시간 없음) → 제출 마감 → 방송에서 시험지 한 장씩 ○/✕ 채점 → 결과 발표 → 보상 지급
//  OX: 진행 시작 → 문제 출제(대기열/즉석) → 정답 공개 → 종료 → 보상 지급
// 테스트 회차는 보상 지급을 눌러도 포인트가 안 들어가고 "누구에게 얼마"만 남음.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Crown, ImagePlus, MonitorPlay, Plus, Settings, Trash2, Users, Wand2 } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { Select } from "../../components/Select";
import { Modal } from "../../components/ui";
import { apiFetch, ApiError } from "../../lib/auth";
import { API } from "../../lib/config";
import { confirmDialog, toast } from "../../lib/dialog";
import { fmt } from "../../lib/format";
import { maybeCompressImage } from "../../lib/notices";
import { ADMIN_QUIZ_ERRORS, oxPhase, type QType, type QuizStatus } from "../../lib/quiz";
import { supabase } from "../../lib/supabase";
import { readStorage, writeStorage } from "../../lib/storage";
import { ExamPaper, leftText } from "./Exam";
import { OIcon, XIcon } from "./Ox";
import { useNow } from "./useNow";
import styles from "./Quiz.module.css";

type QuizRow = {
  id: number;
  kind: "exam" | "ox";
  title: string;
  subtitle: string;
  status: QuizStatus;
  is_test: boolean;
  ox_mode: "score" | "deathmatch" | null;
  reward_ranks: number[];
  reward_survivor: number;
  rewarded_at: string | null;
};
type QuestionRow = {
  id: number;
  position: number;
  qtype: QType;
  prompt: string;
  image_url: string | null;
  choices: string[];
  answer: string;
  asked_at: string | null;
  revealed_at: string | null;
};
type Sheet = { id: number; name: string; submittedAt: string; answers: Record<string, string>; marks: Record<string, boolean>; picks: Record<string, string>; correct: number; marked: number; total: number };
type Payout = { channelId: string; channelName: string; amount: number; label: string };
type Detail = {
  quiz: QuizRow;
  questions: QuestionRow[];
  payouts: Payout[];
  exam?: { sheets: Sheet[]; unmarked: number; ranking: { rank: number; name: string; score: number; marked: number }[] };
  ox?: {
    current: { id: number; number: number; prompt: string; answer: string; askedAt: string | null; closesAt: string | null; revealed: boolean; counts: { O: number; X: number } } | null;
    queue: { id: number; prompt: string; answer: string }[];
    players: { name: string; correct: number; alive: boolean; outAt: number | null; answeredCurrent: "O" | "X" | null }[];
    started: boolean;
    revealedCount: number;
  };
};
type ListItem = { id: number; kind: "exam" | "ox"; title: string; status: QuizStatus; isTest: boolean; rewardedAt: string | null };

const LAST_ADMIN_KEY = "chzzk_quiz_admin_last";
const adminCall = <T,>(body: Record<string, unknown>) => apiFetch<T>(API.adminQuiz, { body });
const STATUS_LABEL: Record<"exam" | "ox", Record<QuizStatus, string>> = {
  exam: { draft: "준비 중", open: "제출 받는 중", closed: "채점 중", revealed: "발표 끝" },
  ox: { draft: "준비 중", open: "진행 중", closed: "진행 중", revealed: "종료" },
};
const errMsg = (e: unknown, fallback: string) => {
  const code = e instanceof ApiError ? String(e.body.error ?? "") : "";
  return ADMIN_QUIZ_ERRORS[code] || fallback;
};

function useAct() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function act<T = unknown>(body: Record<string, unknown>, okMsg?: string): Promise<T | null> {
    setBusy(true);
    try {
      const r = await adminCall<T>(body);
      if (okMsg) toast(okMsg);
      return r;
    } catch (e) {
      toast(errMsg(e, "처리하지 못했어요. 다시 시도해주세요."), "error");
      return null;
    } finally {
      setBusy(false);
      ["quiz-admin", "quiz-admin-list", "quiz", "quiz-history", "quiz-peek"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    }
  }
  return { act, busy };
}

async function uploadImage(file: File): Promise<string> {
  const f = await maybeCompressImage(file);
  const { path, token, publicUrl } = await adminCall<{ path: string; token: string; publicUrl: string }>({ action: "upload-url", fileName: f.name, contentType: f.type });
  const { error } = await supabase.storage.from("quiz-images").uploadToSignedUrl(path, token, f, { contentType: f.type });
  if (error) throw new Error("upload_failed");
  return publicUrl;
}

export default function QuizAdmin() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["quiz-admin-list"], queryFn: () => adminCall<{ quizzes: ListItem[] }>({ action: "list" }) });
  const [selId, setSelIdRaw] = useState<number | null>(null);
  // 마지막으로 다룬 회차를 기억해 두고 다음에 관리 탭을 열면 그 회차부터 보여줌
  const setSelId = (id: number | null) => {
    setSelIdRaw(id);
    writeStorage(LAST_ADMIN_KEY, id == null ? null : String(id));
  };
  const [createKind, setCreateKind] = useState<"exam" | "ox" | null>(null);
  const all = list.data?.quizzes ?? [];
  // 보상 지급까지 끝난 회차는 관리 탭에서 아예 빠짐(결과는 지난 기록에서 봄)
  const isDone = (i: ListItem) => !!i.rewardedAt;
  const items = all.filter((i) => !isDone(i) || i.id === selId);

  // 처음 들어왔을 때만 진행 중인 회차를 골라둠(새로 만든 회차는 목록이 새로 오기 전에도 그대로 선택돼 있게)
  useEffect(() => {
    if (selId == null && list.isSuccess) {
      const last = Number(readStorage(LAST_ADMIN_KEY));
      const first = all.find((i) => i.id === last && !isDone(i)) ?? all.find((i) => !isDone(i));
      if (first) setSelIdRaw(first.id);
    }
  }, [all, selId, list.isSuccess]);

  const detail = useQuery({
    queryKey: ["quiz-admin", selId],
    enabled: selId != null,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (d.quiz.kind === "ox" && d.quiz.status === "open") return 1500;
      return d.quiz.status === "open" || d.quiz.status === "closed" ? 5000 : false;
    },
    queryFn: () => adminCall<Detail>({ action: "get", quizId: selId }),
  });
  const d = detail.data;
  const options = items.map((i) => ({
    value: String(i.id),
    label: `${i.kind === "exam" ? "모의고사" : "OX"} · ${i.title} · ${STATUS_LABEL[i.kind][i.status]}${i.isTest ? " · 테스트" : ""}`,
  }));

  return (
    <>
      <Card className={styles.admin} title="회차">
        <div className={styles.adminTop}>
          {options.length > 0 ? (
            <Select label="회차 고르기" className={styles.grow} value={String(selId ?? options[0].value)} options={options} onChange={(v) => setSelId(Number(v))} />
          ) : (
            <span className="muted" style={{ flex: 1 }}>
              진행 중이거나 준비 중인 회차가 없어요. 새로 만들어 주세요.
            </span>
          )}
          
          <button type="button" className="btn btn-sm" onClick={() => setCreateKind("exam")}>
            <Plus size={16} aria-hidden="true" /> 새 모의고사
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setCreateKind("ox")}>
            <Plus size={16} aria-hidden="true" /> 새 OX 퀴즈
          </button>
        </div>
      </Card>

      {createKind && (
        <QuizSettingsModal
          kind={createKind}
          onClose={() => setCreateKind(null)}
          onSaved={(id) => {
            setCreateKind(null);
            if (id) setSelId(id);
          }}
        />
      )}

      {selId != null && detail.isLoading && <span className="skeleton" style={{ height: 320 }} />}
      {d && d.quiz.id === selId && (
        <QuizDetail
          key={d.quiz.id}
          d={d}
          onFinished={() => {
            // 지운 회차는 바로 화면에서 빼기(목록 새로 받기 전에 다시 골라지지 않게)
            qc.setQueryData<{ quizzes: ListItem[] }>(["quiz-admin-list"], (old) => (old ? { quizzes: old.quizzes.filter((x) => x.id !== d.quiz.id) } : old));
            qc.removeQueries({ queryKey: ["quiz-admin", d.quiz.id] });
            setSelId(null);
          }}
        />
      )}
    </>
  );
}

function Steps({ quiz }: { quiz: QuizRow }) {
  const steps = quiz.kind === "exam" ? ["문제 준비", "제출 받기", "채점", "결과 발표", "보상 지급"] : ["문제 준비", "진행", "종료", "보상 지급"];
  const idx =
    quiz.kind === "exam"
      ? quiz.rewarded_at
        ? 5
        : { draft: 0, open: 1, closed: 2, revealed: 4 }[quiz.status]
      : quiz.rewarded_at
        ? 4
        : { draft: 0, open: 1, closed: 1, revealed: 3 }[quiz.status];
  return (
    <ol className={styles.steps} aria-label="진행 단계">
      {steps.map((s, i) => (
        <li key={s} className={i === idx ? styles.stepNow : i < idx ? styles.stepDone : ""} aria-current={i === idx ? "step" : undefined}>
          {i < idx ? "✓ " : `${i + 1}. `}
          {s}
        </li>
      ))}
    </ol>
  );
}

function QuizDetail({ d, onFinished }: { d: Detail; onFinished: () => void }) {
  const { act, busy } = useAct();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const quiz = d.quiz;

  async function remove() {
    if (!(await confirmDialog(`"${quiz.title}" 회차를 삭제할까요? 답안·응답도 같이 지워져요.`, { danger: true }))) return;
    if (await act({ action: "delete", quizId: quiz.id }, "삭제했어요.")) onFinished();
  }

  return (
    <>
      <Card
        className={styles.admin}
        title={quiz.title}
        extra={
          <div className={styles.actions} style={{ marginLeft: "auto" }}>
            {quiz.is_test && <span className={`tag ${styles.testTag}`}>테스트 회차</span>}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSettingsOpen(true)}>
              <Settings size={16} aria-hidden="true" /> 설정
            </button>
            {(quiz.status === "draft" || quiz.is_test) && (
              <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={remove}>
                <Trash2 size={16} aria-hidden="true" /> 삭제
              </button>
            )}
          </div>
        }
      >
        <Steps quiz={quiz} />
      </Card>
      {settingsOpen && <QuizSettingsModal kind={quiz.kind} quiz={quiz} onClose={() => setSettingsOpen(false)} onSaved={() => setSettingsOpen(false)} />}
      {quiz.status === "revealed" && <Payouts d={d} onPaid={onFinished} />}
      {quiz.kind === "exam" ? <ExamAdmin d={d} /> : <OxAdmin d={d} />}
    </>
  );
}

// ── 회차 만들기 / 설정 ──
function QuizSettingsModal({ kind, quiz, onClose, onSaved }: { kind: "exam" | "ox"; quiz?: QuizRow; onClose: () => void; onSaved: (id?: number) => void }) {
  const { act, busy } = useAct();
  const [title, setTitle] = useState(quiz?.title ?? (kind === "exam" ? "2026년도 제3회 유진능력고사" : "OX 퀴즈"));
  const [subtitle, setSubtitle] = useState(quiz?.subtitle ?? "유진 영역");
  const [oxMode, setOxMode] = useState<"score" | "deathmatch">(quiz?.ox_mode ?? "deathmatch");
  const [ranks, setRanks] = useState((quiz?.reward_ranks ?? [5000, 3000, 1000]).join(", "));
  const [survivor, setSurvivor] = useState(String(quiz?.reward_survivor ?? 1000));
  const paid = !!quiz?.rewarded_at;

  async function save() {
    const rewardRanks = ranks
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((s) => Number(s.replace(/[^0-9]/g, "")));
    const body: Record<string, unknown> = { title, rewardRanks, rewardSurvivor: Number(survivor) || 0 };
    if (kind === "exam") body.subtitle = subtitle;
    else body.oxMode = oxMode;
    if (quiz) {
      if (await act({ action: "update", quizId: quiz.id, ...body }, "저장했어요.")) onSaved();
    } else {
      const r = await act<{ id: number }>({ action: "create", kind, isTest: false, ...body }, "회차를 만들었어요.");
      if (r) onSaved(r.id);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={quiz ? "회차 설정" : kind === "exam" ? "새 모의고사" : "새 OX 퀴즈"}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
            {quiz ? "저장" : "만들기"}
          </button>
        </>
      }
    >
      <div className={styles.form}>
        <label className="field">
          <span className="field-label">제목</span>
          <input className="input" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {kind === "exam" ? (
          <label className="field">
            <span className="field-label">시험지 큰 제목 — 예: 유진 영역, 게임 영역(비워두면 안 보임)</span>
            <input className="input" maxLength={30} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
          </label>
        ) : (
          <div className="field">
            <span className="field-label">방식</span>
            <div className="segment" role="tablist">
              <button type="button" role="tab" aria-selected={oxMode === "deathmatch"} onClick={() => setOxMode("deathmatch")}>
                데스매치(틀리면 탈락)
              </button>
              <button type="button" role="tab" aria-selected={oxMode === "score"} onClick={() => setOxMode("score")}>
                점수전(맞힌 개수)
              </button>
            </div>
          </div>
        )}
        {kind === "ox" && oxMode === "deathmatch" ? (
          <label className="field">
            <span className="field-label">최후 생존자 1명당 보상(P)</span>
            <input className="input num" inputMode="numeric" disabled={paid} value={survivor} onChange={(e) => setSurvivor(e.target.value.replace(/[^0-9]/g, ""))} />
          </label>
        ) : (
          <label className="field">
            <span className="field-label">순위 보상(P) — 1등부터 쉼표로</span>
            <input className="input num" disabled={paid} value={ranks} onChange={(e) => setRanks(e.target.value)} placeholder="5000, 3000, 1000" />
          </label>
        )}
      </div>
    </Modal>
  );
}

// ── 모의고사 ──
type ExamTab = "questions" | "grading" | "ranking";

function ExamAdmin({ d }: { d: Detail }) {
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
            className="btn btn-sm"
            style={{ marginLeft: "auto" }}
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
                  <span className="muted num" style={{ fontSize: 12 }}>
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

function QuestionsTab({ d }: { d: Detail }) {
  const { act, busy } = useAct();
  const quiz = d.quiz;
  const isDraft = quiz.status === "draft";
  const [sel, setSel] = useState<number | "new" | null>(d.questions[0]?.id ?? (isDraft ? "new" : null));
  const [draftNo, setDraftNo] = useState(0); // 새 문항을 추가할 때마다 올려서 작성 칸을 빈 상태로 새로 띄움
  const selected = typeof sel === "number" ? d.questions.find((q) => q.id === sel) ?? null : null;

  async function move(id: number, dir: -1 | 1) {
    const ids = d.questions.map((q) => q.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await act({ action: "reorder", quizId: quiz.id, ids });
  }

  return (
    <div className={styles.adminGrid}>
      <Card
        title="문항"
        extra={
          isDraft && (
            <button type="button" className="btn btn-sm" style={{ marginLeft: "auto" }} disabled={sel === "new"} onClick={() => setSel("new")}>
              <Plus size={16} aria-hidden="true" /> 새 문항
            </button>
          )
        }
      >
        <div className={styles.qList}>
          {d.questions.map((q, i) => (
            <button key={q.id} type="button" className={`${styles.qItem} ${sel === q.id ? styles.qItemOn : ""}`} onClick={() => setSel(q.id)}>
              <b>{i + 1}</b>
              <span>{q.prompt.replace(/__/g, "")}</span>
              <span className={`tag ${q.qtype === "short" ? "tag-gold" : q.qtype === "image" ? "tag-blue" : ""}`}>{q.qtype === "short" ? "단답" : q.qtype === "image" ? "이미지" : "객관식"}</span>
            </button>
          ))}
          {sel === "new" && (
            <div className={`${styles.qItem} ${styles.qItemOn} ${styles.draftItem}`}>
              <b>{d.questions.length + 1}</b>
              <span>새 문항</span>
              <span className="tag tag-accent">작성 중</span>
            </div>
          )}
          {d.questions.length === 0 && sel !== "new" && <EmptyState>아직 문항이 없어요.</EmptyState>}
        </div>
        {selected && isDraft && (
          <div className={styles.actions} style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-sm" aria-label="위로" disabled={busy} onClick={() => move(selected.id, -1)}>
              <ArrowUp size={16} aria-hidden="true" />
            </button>
            <button type="button" className="btn btn-sm" aria-label="아래로" disabled={busy} onClick={() => move(selected.id, 1)}>
              <ArrowDown size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </Card>

      {sel != null ? (
        <QuestionEditor
          key={sel === "new" ? `new-${draftNo}` : `${sel}-${selected ? "q" : "n"}`}
          quiz={quiz}
          question={selected}
          number={selected ? d.questions.indexOf(selected) + 1 : d.questions.length + 1}
          onSaved={(id, wasNew) => {
            if (wasNew) {
              setDraftNo((n) => n + 1);
              setSel("new");
            } else setSel(id);
          }}
          onDeleted={() => setSel(d.questions[0]?.id ?? null)}
          onCancelNew={() => setSel(d.questions[0]?.id ?? null)}
        />
      ) : (
        <Card>
          <EmptyState>왼쪽에서 문항을 골라요.</EmptyState>
        </Card>
      )}
    </div>
  );
}

function QuestionEditor({
  quiz,
  question,
  number,
  onSaved,
  onDeleted,
  onCancelNew,
}: {
  quiz: QuizRow;
  question: QuestionRow | null;
  number: number;
  onSaved: (id: number, wasNew: boolean) => void;
  onDeleted: () => void;
  onCancelNew: () => void;
}) {
  const { act, busy } = useAct();
  const [qtype, setQtype] = useState<QType>(question?.qtype ?? "choice");
  const [prompt, setPrompt] = useState(question?.prompt ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(question?.image_url ?? null);
  const [texts, setTexts] = useState<string[]>(question?.qtype === "choice" ? question.choices : ["", "", "", ""]);
  const [imgs, setImgs] = useState<string[]>(question?.qtype === "image" ? question.choices : ["", "", "", ""]);
  const [answer, setAnswer] = useState(question?.answer ?? "");
  const [uploading, setUploading] = useState(false);
  const isNew = !question;
  const locked = quiz.status === "revealed";
  const typeLocked = quiz.status !== "draft";

  async function pickImage(onDone: (url: string) => void) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      setUploading(true);
      try {
        onDone(await uploadImage(f));
      } catch (e) {
        toast(errMsg(e, "이미지를 올리지 못했어요."), "error");
      } finally {
        setUploading(false);
      }
    };
    input.click();
  }

  async function save() {
    const choices = qtype === "choice" ? texts : qtype === "image" ? imgs : [];
    const r = await act<{ id: number }>(
      { action: "save-question", quizId: quiz.id, question: { id: question?.id, qtype, prompt, imageUrl, choices, answer } },
      isNew ? `${number}번 문항을 추가했어요. 이어서 ${number + 1}번을 적어요.` : "수정했어요.",
    );
    if (r) onSaved(r.id, isNew);
  }

  async function remove() {
    if (!question || !(await confirmDialog(`${number}번 문항을 삭제할까요?`, { danger: true }))) return;
    if (await act({ action: "delete-question", questionId: question.id }, "삭제했어요.")) onDeleted();
  }

  const choiceRadio = (k: number) => (
    <input type="radio" name="answer" aria-label={`${k + 1}번을 정답으로`} checked={answer === String(k + 1)} onChange={() => setAnswer(String(k + 1))} style={{ width: 20, height: 20, accentColor: "var(--c-accent)", flex: "none" }} />
  );

  return (
    <Card
      className={styles.admin}
      title={isNew ? `${number}번 새 문항` : `${number}번 문항 수정`}
      extra={<span className={`tag ${isNew ? "tag-accent" : ""}`} style={{ marginLeft: "auto" }}>{isNew ? "작성 중 · 아직 추가 안 됨" : "저장된 문항"}</span>}
    >
      <div className={styles.form}>
        <div className="segment" role="tablist" aria-label="문항 유형">
          {(["choice", "image", "short"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={qtype === t} disabled={typeLocked && qtype !== t} onClick={() => setQtype(t)}>
              {t === "choice" ? "4지선다" : t === "image" ? "이미지 보기" : "단답형"}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field-label">문제</span>
          <textarea className="textarea" rows={2} maxLength={300} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="다음 중 유진의 별자리로 옳은 것은?" />
          <span className="muted" style={{ fontSize: 12 }}>
            __아닌__ 처럼 밑줄 두 개로 감싸면 시험지에 밑줄로 나와요.
          </span>
        </label>
        <div className={styles.actions}>
          {imageUrl && <img className={styles.thumb} src={imageUrl} alt="문제 그림" />}
          <button type="button" className="btn btn-sm" disabled={uploading} onClick={() => pickImage(setImageUrl)}>
            <ImagePlus size={16} aria-hidden="true" /> {imageUrl ? "문제 그림 바꾸기" : "문제 그림 넣기(선택)"}
          </button>
          {imageUrl && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setImageUrl(null)}>
              그림 빼기
            </button>
          )}
        </div>

        {qtype === "choice" && (
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label" style={{ marginBottom: 6 }}>
              보기 · 정답에 체크
            </legend>
            {texts.map((t, k) => (
              <div key={k} className={styles.choiceEdit}>
                {choiceRadio(k)}
                <input
                  type="text"
                  className="input"
                  maxLength={80}
                  aria-label={`${k + 1}번 보기`}
                  placeholder={`${k + 1}번 보기`}
                  value={t}
                  onChange={(e) => setTexts((xs) => xs.map((x, i) => (i === k ? e.target.value : x)))}
                />
              </div>
            ))}
          </fieldset>
        )}

        {qtype === "image" && (
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label" style={{ marginBottom: 6 }}>
              보기 그림 4장 · 정답에 체크
            </legend>
            {imgs.map((src, k) => (
              <div key={k} className={styles.choiceEdit}>
                {choiceRadio(k)}
                {src ? <img className={styles.thumb} src={src} alt={`${k + 1}번 그림`} /> : <span className={styles.thumb} />}
                <button type="button" className="btn btn-sm" disabled={uploading} onClick={() => pickImage((url) => setImgs((xs) => xs.map((x, i) => (i === k ? url : x))))}>
                  <ImagePlus size={16} aria-hidden="true" /> {k + 1}번 {src ? "바꾸기" : "올리기"}
                </button>
              </div>
            ))}
          </fieldset>
        )}

        {qtype === "short" && (
          <label className="field">
            <span className="field-label">정답(채점할 때 참고 · 자동 채점 기준)</span>
            <input className="input" maxLength={100} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="overdose" />
          </label>
        )}

        <div className={styles.actions}>
          <button type="button" className="btn btn-primary" disabled={busy || uploading || locked} onClick={save}>
            {isNew ? "문항 추가" : "수정 저장"}
          </button>
          {isNew && quiz.status === "draft" && (
            <button type="button" className="btn btn-ghost" onClick={onCancelNew}>
              작성 취소
            </button>
          )}
          {question && quiz.status === "draft" && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={remove}>
              <Trash2 size={16} aria-hidden="true" /> 삭제
            </button>
          )}
          {typeLocked && !locked && <span className="muted" style={{ fontSize: 12 }}>제출을 받는 중엔 오타·정답만 고칠 수 있어요.</span>}
        </div>
      </div>
    </Card>
  );
}

// 제출된 시험지를 한 장씩 띄워 놓고 문항마다 ○/✕ — 방송에 띄우는 화면
function GradingTab({ d, stream = false }: { d: Detail; stream?: boolean }) {
  const qc = useQueryClient();
  const { act, busy } = useAct();
  const sheets = d.exam!.sheets;
  const [sid, setSid] = useState<number | null>(sheets[0]?.id ?? null);
  const [showKey, setShowKey] = useState(false);
  const [local, setLocal] = useState<Record<string, boolean | null>>({});
  const [localPick, setLocalPick] = useState<Record<string, string | null>>({});
  const idx = Math.max(0, sheets.findIndex((s) => s.id === sid));
  const sheet = sheets[idx];
  const paid = !!d.quiz.rewarded_at;

  useEffect(() => {
    setLocal({});
    setLocalPick({});
  }, [sid]);
  useEffect(() => {
    if (sid == null && sheets.length) setSid(sheets[0].id);
  }, [sheets, sid]);

  const marks = useMemo(() => {
    const m: Record<string, boolean | undefined> = { ...(sheet?.marks ?? {}) };
    for (const [k, v] of Object.entries(local)) m[k] = v === null ? undefined : v;
    return m;
  }, [sheet, local]);
  const picks = useMemo(() => {
    const m: Record<string, string | undefined> = { ...(sheet?.picks ?? {}) };
    for (const [k, v] of Object.entries(localPick)) m[k] = v === null ? undefined : v;
    return m;
  }, [sheet, localPick]);
  const correct = d.questions.filter((q) => marks[String(q.id)] === true).length;
  const marked = d.questions.filter((q) => marks[String(q.id)] !== undefined).length;

  async function mark(qid: number, v: boolean | null) {
    if (!sheet || paid) return;
    setLocal((l) => ({ ...l, [String(qid)]: v }));
    try {
      await adminCall({ action: "mark", submissionId: sheet.id, questionId: qid, correct: v });
    } catch (e) {
      setLocal((l) => {
        const n = { ...l };
        delete n[String(qid)];
        return n;
      });
      toast(errMsg(e, "채점을 저장하지 못했어요."), "error");
    } finally {
      qc.invalidateQueries({ queryKey: ["quiz-admin"] });
    }
  }

  // 객관식 — 고른 번호가 정답. 낸 번호와 같으면 ○, 다르면 ✕
  async function pickKey(qid: number, v: string | null) {
    if (!sheet || paid) return;
    const k = String(qid);
    setLocalPick((l) => ({ ...l, [k]: v }));
    setLocal((l) => ({ ...l, [k]: v === null ? null : sheet.answers[k] === v }));
    try {
      await adminCall({ action: "mark", submissionId: sheet.id, questionId: qid, pick: v });
    } catch (e) {
      const drop = <T,>(l: Record<string, T>) => {
        const n = { ...l };
        delete n[k];
        return n;
      };
      setLocalPick(drop);
      setLocal(drop);
      toast(errMsg(e, "채점을 저장하지 못했어요."), "error");
    } finally {
      qc.invalidateQueries({ queryKey: ["quiz-admin"] });
    }
  }

  async function auto() {
    if (!sheet) return;
    if (marked > 0 && !(await confirmDialog("이 시험지를 정답과 비교해서 자동 채점할까요? 이미 매긴 ○/✕도 다시 매겨져요.", { okText: "자동 채점" }))) return;
    await act({ action: "auto-mark", submissionId: sheet.id }, "자동 채점했어요.");
    setLocal({});
    setLocalPick({});
  }

  const paper = sheet && (
    <ExamPaper
      title={`${sheet.name} 님의 답안`}
      subtitle={d.quiz.subtitle}
      questions={d.questions.map((q) => ({ id: q.id, qtype: q.qtype, prompt: q.prompt, imageUrl: q.image_url, choices: q.choices, answer: q.answer }))}
      answers={sheet.answers}
      marks={marks}
      onMark={paid ? undefined : mark}
      picks={picks}
      onKeyPick={paid ? undefined : pickKey}
      showKey={stream ? false : showKey}
    />
  );
  const nextReady = marked === d.questions.length && idx < sheets.length - 1;

  // 방송 화면 — 시험지를 크게 띄우고 이 창에서 바로 ○/✕. 목록 대신 위쪽 막대에서 이전/다음.
  if (stream) {
    return (
      <div className={`${styles.stream} ${styles.gradeStream}`}>
        <div className={styles.gradeBar}>
          <b className={styles.gradeTitle}>{d.quiz.title}</b>
          {sheets.length > 0 && sheet ? (
            <>
              <div className={styles.gradeLeft}>
              <button type="button" className="btn btn-sm" aria-label="이전 시험지" disabled={idx === 0} onClick={() => setSid(sheets[idx - 1].id)}>
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <Select label="시험지 고르기" className={styles.gradeSelect} value={String(sheet.id)} options={sheets.map((x, i) => ({ value: String(x.id), label: `${i + 1}. ${x.name}` }))} onChange={(v) => setSid(Number(v))} />
              <button type="button" className="btn btn-sm" aria-label="다음 시험지" disabled={idx === sheets.length - 1} onClick={() => setSid(sheets[idx + 1].id)}>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              <span className={styles.gradeScore}>
                <b className="num">{correct}</b>
                <span className="num">/ {d.questions.length} 맞음</span>
              </span>
              <span className="muted num" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                채점 {marked}/{d.questions.length}
              </span>
              </div>
              <div className={styles.gradeRight}>
              <button type="button" className="btn btn-sm" disabled={busy || paid} onClick={auto}>
                <Wand2 size={16} aria-hidden="true" /> 자동 채점
              </button>
              {nextReady && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setSid(sheets[idx + 1].id)}>
                  다음 시험지 <ChevronRight size={16} aria-hidden="true" />
                </button>
              )}
              </div>
            </>
          ) : (
            <span className={`muted ${styles.gradeLeft}`}>아직 제출된 시험지가 없어요.</span>
          )}
        </div>
        <div className={styles.gradeBody}>{paper}</div>
      </div>
    );
  }

  if (sheets.length === 0) {
    return (
      <Card className={styles.admin}>
        <EmptyState>아직 제출된 시험지가 없어요.</EmptyState>
      </Card>
    );
  }

  return (
    <div className={styles.adminGrid}>
      <Card title={`시험지 ${sheets.length}장`}>
        <div className={styles.sheetList}>
          {sheets.map((s, i) => (
            <button key={s.id} type="button" className={`${styles.sheetItem} ${s.id === sheet?.id ? styles.qItemOn : ""}`} onClick={() => setSid(s.id)}>
              <span>
                <b className="num muted" style={{ marginRight: 8 }}>
                  {i + 1}
                </b>
                {s.name}
              </span>
              {s.marked === s.total ? <span className="tag tag-accent num">{s.correct}개</span> : <span className="tag num">{s.marked}/{s.total}</span>}
            </button>
          ))}
        </div>
      </Card>

      {sheet && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <Card className={styles.admin}>
            <div className={styles.actions}>
              <button type="button" className="btn btn-sm" aria-label="이전 시험지" disabled={idx === 0} onClick={() => setSid(sheets[idx - 1].id)}>
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <b style={{ fontSize: 17 }}>{sheet.name}</b>
              <span className="muted num" style={{ fontSize: 13 }}>
                {idx + 1} / {sheets.length}
              </span>
              <button type="button" className="btn btn-sm" aria-label="다음 시험지" disabled={idx === sheets.length - 1} onClick={() => setSid(sheets[idx + 1].id)}>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              <span style={{ marginLeft: "auto" }} className="num">
                맞음 <b style={{ fontSize: 18, color: "var(--c-accent)" }}>{correct}</b> / {d.questions.length}
                <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                  (채점 {marked}/{d.questions.length})
                </span>
              </span>
            </div>
            <div className={styles.actions} style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-sm" disabled={busy || paid} onClick={auto}>
                <Wand2 size={16} aria-hidden="true" /> 이 시험지 자동 채점
              </button>
              <label className="check" style={{ fontSize: 13 }}>
                <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} />
                정답 표시(방송 화면에 보일 수 있어요)
              </label>
              {nextReady && (
                <button type="button" className="btn btn-sm btn-primary" style={{ marginLeft: "auto" }} onClick={() => setSid(sheets[idx + 1].id)}>
                  다음 시험지 <ChevronRight size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </Card>
          {paper}
        </div>
      )}
    </div>
  );
}

// 모의고사 채점 방송 화면 — 관리 탭의 "채점 방송 화면 열기"로 뜨는 창. 이 창에서 바로 채점함(정답은 안 보임).
export function ExamGradeStream({ quizId }: { quizId: number }) {
  useStreamTitle("유진고사 채점 방송화면 · 유진 팬보드");
  const q = useQuery({ queryKey: ["quiz-admin", quizId], refetchInterval: 5000, queryFn: () => adminCall<Detail>({ action: "get", quizId }) });
  if (!q.data) return <div className={styles.stream}><span className={styles.streamHint}>불러오는 중…</span></div>;
  return <GradingTab d={q.data} stream />;
}

// ── OX ──
function OxAdmin({ d }: { d: Detail }) {
  const { act, busy } = useAct();
  const now = useNow(250);
  const quiz = d.quiz;
  const ox = d.ox!;
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState<"" | "O" | "X">("");
  const [seconds, setSeconds] = useState(10);
  const cur = ox.current;
  const pendingCur = !!cur && !cur.revealed;
  const ph = cur ? oxPhase(cur.askedAt, cur.closesAt, cur.revealed, now) : null;
  const curOpen = pendingCur && !!ph && ph.phase !== "closed";
  const answered = cur ? cur.counts.O + cur.counts.X : 0;
  const alive = ox.players.filter((p) => p.alive).length;
  const deathmatch = quiz.ox_mode === "deathmatch";
  const isOpen = quiz.status === "open";
  const next = ox.queue[0];
  const canAsk = isOpen && !pendingCur;

  async function ask(questionId?: number) {
    const body: Record<string, unknown> = { action: "ox-ask", quizId: quiz.id, seconds };
    if (questionId) body.questionId = questionId;
    else Object.assign(body, { prompt, answer });
    if (await act(body)) {
      if (!questionId) {
        setPrompt("");
        setAnswer("");
      }
    }
  }
  async function addQueue() {
    if (await act({ action: "ox-add", quizId: quiz.id, prompt, answer }, "대기열에 넣었어요.")) {
      setPrompt("");
      setAnswer("");
    }
  }

  return (
    <>
      <Card
        className={styles.admin}
        title="OX 리모컨"
        extra={
          <div className={styles.actions} style={{ marginLeft: "auto" }}>
            <span className={`tag ${deathmatch ? "tag-live" : "tag-blue"}`}>{deathmatch ? "데스매치" : "점수전"}</span>
            <button
              type="button"
              className="btn btn-sm"
              title="정답·대기열 없이 문제와 결과만 크게 보여주는 창이에요. 이 창을 방송에 띄우고, 리모컨은 내 화면에만 두세요."
              onClick={() => window.open(`${location.pathname}?stream=${quiz.id}`, `quiz-stream-${quiz.id}`, "width=1280,height=720")}
            >
              <MonitorPlay size={16} aria-hidden="true" /> 방송 화면 열기
            </button>
          </div>
        }
      >
        <p className="muted" style={{ margin: "0 0 14px", fontSize: 12 }}>
          이 리모컨엔 미리 정한 정답과 대기열이 보여요. 방송엔 "방송 화면 열기"로 뜨는 창을 띄워 주세요.
        </p>
        {quiz.status === "draft" && (
          <div className={styles.actions} style={{ marginBottom: 16 }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act({ action: "open", quizId: quiz.id }, "OX 퀴즈를 열었어요. 시청자 메뉴에 떠요.")}>
              진행 시작
            </button>
            <span className="muted">대기열에 문제를 미리 넣어두고, 시작한 뒤 하나씩 내요.</span>
          </div>
        )}
        {quiz.status === "revealed" && <p className="muted">종료된 OX 퀴즈예요. 아래에서 보상을 지급하세요.</p>}

        {quiz.status !== "revealed" && (
          <div className={styles.remote}>
            <div className={styles.panel}>
              <div className={styles.tags}>
                <span className={styles.panelLabel}>지금 문제</span>
                {cur && <span className="tag num">{cur.number}번째 · {cur.revealed ? "정답 공개됨" : curOpen ? "응답 받는 중" : "마감"}</span>}
                {curOpen && ph && (
                  <b className="num" style={{ marginLeft: "auto", color: ph.phase === "ready" ? "var(--c-text-2)" : "var(--c-live-text)", fontSize: ph.phase === "ready" ? 15 : 22 }}>
                    {ph.phase === "ready" ? "곧 시작" : leftText(ph.left)}
                  </b>
                )}
              </div>
              {cur ? (
                <>
                  <h3 className={styles.oxPrompt} style={{ fontSize: 22 }}>
                    {cur.prompt.replace(/__/g, "")}
                  </h3>
                  <div className={styles.rows}>
                    <div className={styles.row}>
                      <b style={{ color: "var(--c-blue)" }}>O · {cur.counts.O}명</b>
                      <span>
                        응답 {answered}명{deathmatch && ox.started ? ` / 생존 ${alive}명` : ""}
                      </span>
                      <b style={{ color: "var(--c-amber)" }}>X · {cur.counts.X}명</b>
                    </div>
                    <div className={styles.split2}>
                      <i style={{ width: answered ? `${(cur.counts.O / answered) * 100}%` : "0%" }} />
                      <i style={{ width: answered ? `${(cur.counts.X / answered) * 100}%` : "0%" }} />
                    </div>
                  </div>
                  {pendingCur && (
                    <div className={styles.actions}>
                      {curOpen && (
                        <button type="button" className="btn" disabled={busy} onClick={() => act({ action: "ox-close", questionId: cur.id })}>
                          지금 마감
                        </button>
                      )}
                      <button type="button" className="btn" style={{ color: "var(--c-blue)" }} disabled={busy} onClick={() => act({ action: "ox-reveal", questionId: cur.id, answer: "O" })}>
                        정답 O 공개{cur.answer === "O" ? " ★" : ""}
                      </button>
                      <button type="button" className="btn" style={{ color: "var(--c-amber)" }} disabled={busy} onClick={() => act({ action: "ox-reveal", questionId: cur.id, answer: "X" })}>
                        정답 X 공개{cur.answer === "X" ? " ★" : ""}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={async () => {
                          if (await confirmDialog("이 문제를 취소할까요? 받은 응답은 지워지고 대기열로 돌아가요.", { danger: true, okText: "문제 취소" })) act({ action: "ox-cancel", questionId: cur.id }, "취소했어요.");
                        }}
                      >
                        문제 취소
                      </button>
                    </div>
                  )}
                  {pendingCur && (cur.answer === "O" || cur.answer === "X") && <span className="muted" style={{ fontSize: 12 }}>★ 미리 정해둔 정답</span>}
                </>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  {isOpen ? "아직 낸 문제가 없어요. 오른쪽에서 첫 문제를 내요." : "진행을 시작하면 여기서 문제를 내요."}
                </p>
              )}
            </div>

            <div className={styles.panel}>
              <span className={styles.panelLabel}>다음 문제</span>
              {next ? (
                <b style={{ fontSize: 16, lineHeight: 1.5 }}>
                  {next.prompt} <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>정답 {next.answer || "나중에"}</span>
                </b>
              ) : (
                <span className="muted">대기열이 비었어요. 아래에서 바로 내거나 넣어두세요.</span>
              )}
              <div className={styles.actions}>
                <span className="muted" style={{ fontSize: 13 }}>제한시간</span>
                <div className="segment" role="tablist" aria-label="제한시간">
                  {[5, 10, 20, 30, 60].map((s) => (
                    <button key={s} type="button" role="tab" aria-selected={seconds === s} onClick={() => setSeconds(s)}>
                      {s === 60 ? "1분" : `${s}초`}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" className="btn btn-primary btn-lg" disabled={busy || !next || !canAsk} onClick={() => next && ask(next.id)}>
                다음 문제 출제
              </button>
              {isOpen && pendingCur && <span className="muted" style={{ fontSize: 12 }}>지금 문제의 정답을 공개해야 다음 문제를 낼 수 있어요.</span>}
              {!isOpen && <span className="muted" style={{ fontSize: 12 }}>진행 시작을 눌러야 출제할 수 있어요.</span>}
              <span className="muted" style={{ fontSize: 12 }}>방송 딜레이를 감안해 마감은 3초 늦게 돼요.</span>
            </div>
          </div>
        )}

        {quiz.status !== "revealed" && (
          <div className={styles.form} style={{ marginTop: 16 }}>
            <div className={styles.actions}>
              <input
                className="input"
                style={{ flex: "1 1 320px", minWidth: 0 }}
                maxLength={200}
                aria-label="새 문제"
                placeholder="새 문제 적기 — 엔터를 누르면 바로 출제"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && prompt.trim() && canAsk) ask();
                }}
              />
              <div className="segment" role="tablist" aria-label="정답 미리 정하기">
                {(["", "O", "X"] as const).map((a) => (
                  <button key={a || "none"} type="button" role="tab" aria-selected={answer === a} onClick={() => setAnswer(a)}>
                    {a ? `정답 ${a}` : "정답 나중에"}
                  </button>
                ))}
              </div>
              <button type="button" className="btn" disabled={busy || !prompt.trim() || !canAsk} onClick={() => ask()}>
                바로 출제
              </button>
              <button type="button" className="btn" disabled={busy || !prompt.trim()} onClick={addQueue}>
                대기열에 추가
              </button>
            </div>
          </div>
        )}
      </Card>

      <div className={styles.twoCol}>
        {quiz.status !== "revealed" && (
          <Card className={styles.admin} title={`대기열 ${ox.queue.length}`}>
            {ox.queue.length === 0 ? (
              <EmptyState>미리 넣어둔 문제가 없어요.</EmptyState>
            ) : (
              <div>
                {ox.queue.map((q, i) => (
                  <div key={q.id} className={`${styles.queueRow} ${i === 0 ? styles.queueNext : ""}`}>
                    <span className="muted num" style={{ width: 18 }}>
                      {i + 1}
                    </span>
                    <b>{q.prompt}</b>
                    <span className="muted" style={{ fontSize: 12, flex: "none" }}>
                      {q.answer ? `정답 ${q.answer}` : "정답 나중에"}
                    </span>
                    <button type="button" className="btn btn-sm" disabled={busy || !canAsk} onClick={() => ask(q.id)}>
                      출제
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" aria-label="대기열에서 삭제" disabled={busy} onClick={() => act({ action: "delete-question", questionId: q.id })}>
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        <Card
          className={styles.admin}
          title={deathmatch ? "생존자" : "순위"}
          extra={
            <span className="muted num" style={{ marginLeft: "auto" }}>
              {deathmatch && ox.started ? `${alive} / ${ox.players.length}명` : `${ox.players.length}명`}
            </span>
          }
        >
          {ox.players.length === 0 ? (
            <EmptyState>아직 응답한 사람이 없어요.</EmptyState>
          ) : (
            <div className={styles.players}>
              {ox.players.map((p, i) => (
                <div key={i} className={`${styles.player} ${deathmatch && ox.started && !p.alive ? styles.dead : ""}`}>
                  <span className={styles.dot} />
                  <span style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
                  <span className="muted num" style={{ fontSize: 12 }}>
                    {deathmatch && ox.started && !p.alive ? (p.outAt ? `Q${p.outAt} 탈락` : "미참여") : `${p.correct}개`}
                    {pendingCur && p.answeredCurrent ? ` · ${p.answeredCurrent}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
          {isOpen && (
            <div className={styles.actions} style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={async () => {
                  if (await confirmDialog(`OX 퀴즈를 종료할까요? ${deathmatch ? `지금 생존자 ${ox.started ? alive : 0}명` : "지금 순위"}로 결과가 확정돼요.`, { okText: "종료" })) act({ action: "reveal", quizId: quiz.id }, "종료했어요.");
                }}
              >
                종료하고 결과 확정
              </button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

// ── 보상 지급 ──
function Payouts({ d, onPaid }: { d: Detail; onPaid: () => void }) {
  const { act, busy } = useAct();
  const quiz = d.quiz;
  const total = useMemo(() => d.payouts.reduce((n, p) => n + p.amount, 0), [d.payouts]);
  const paid = !!quiz.rewarded_at;

  async function pay() {
    const none = d.payouts.length === 0;
    const msg = none
      ? "보상 받을 사람이 없어요. 이대로 회차를 마칠까요? 관리 탭에서 사라지고 결과는 지난 기록에 남아요."
      : quiz.is_test
        ? `테스트 회차라 포인트는 안 들어가요. ${d.payouts.length}명 · 총 ${fmt(total)}P로 지급 기록만 남기고 마칠까요?`
        : `${d.payouts.length}명에게 총 ${fmt(total)}P를 지급하고 마칠까요? 되돌릴 수 없어요.`;
    if (!(await confirmDialog(msg, { okText: none ? "마치기" : "지급" }))) return;
    const r = await act({ action: "pay", quizId: quiz.id }, none ? "회차를 마쳤어요." : quiz.is_test ? "지급 기록을 남기고 마쳤어요(테스트)." : "보상을 지급하고 마쳤어요.");
    if (r) onPaid(); // 다 끝난 회차는 관리 탭에서 빼고 처음 화면으로
  }

  return (
    <Card className={styles.admin} title={paid ? "지급 내역" : "보상 지급 미리보기"} extra={quiz.is_test && <span className={`tag ${styles.testTag}`} style={{ marginLeft: "auto" }}>테스트 · 실제 지급 안 됨</span>}>
      {d.payouts.length === 0 ? (
        <EmptyState>보상 받을 사람이 없어요.</EmptyState>
      ) : (
        <div className={styles.payList}>
          {d.payouts.map((p, i) => (
            <div key={i} className={styles.row}>
              <span>
                {p.label} · {p.channelName}
              </span>
              <b className="num" style={{ color: "var(--c-gold)" }}>
                {fmt(p.amount)}P
              </b>
            </div>
          ))}
          <div className={styles.row} style={{ borderTop: "1px solid var(--c-border)", paddingTop: 10 }}>
            <span>합계</span>
            <b className="num">{fmt(total)}P</b>
          </div>
        </div>
      )}
      {!paid && (
        <div className={styles.actions} style={{ marginTop: 14 }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={pay}>
            {d.payouts.length === 0 ? "보상 없이 마치기" : quiz.is_test ? "지급 기록만 남기고 마치기(테스트)" : "보상 지급하고 마치기"}
          </button>
        </div>
      )}
    </Card>
  );
}

// ── 방송 화면(OX) — 방송에 띄우는 창. 정답은 공개한 뒤에만, 대기열·미리 정한 정답은 절대 안 보임 ──
const RING_R = 54;
const RING_C = 2 * Math.PI * RING_R;

// 방송 화면 창 제목 — OBS 창 캡처에서 구분하기 쉽게 고정된 이름으로(사이트 기본 제목 "퀴즈 · 유진 팬보드"를 덮어씀)
function useStreamTitle(title: string) {
  useEffect(() => {
    const t = window.setTimeout(() => (document.title = title), 0);
    return () => window.clearTimeout(t);
  }, [title]);
}

export function OxStream({ quizId }: { quizId: number }) {
  useStreamTitle("OX 퀴즈 방송화면 · 유진 팬보드");
  const now = useNow(100);
  const q = useQuery({ queryKey: ["quiz-admin", quizId], refetchInterval: 1000, queryFn: () => adminCall<Detail>({ action: "get", quizId }) });
  const d = q.data;
  const ox = d?.ox;
  const cur = ox?.current ?? null;
  const ph = cur ? oxPhase(cur.askedAt, cur.closesAt, cur.revealed, now) : null;
  const open = !!ph && ph.phase !== "closed";
  const closed = !!cur && !open;
  const deathmatch = d?.quiz.ox_mode === "deathmatch";
  const players = ox?.players ?? [];
  const alive = players.filter((p) => p.alive);
  const total = cur ? cur.counts.O + cur.counts.X : 0;
  const ended = d?.quiz.status === "revealed";
  const urgent = ph?.phase === "counting" && ph.left < 3000;
  const frac = ph ? Math.max(0, Math.min(1, ph.left / ph.total)) : 0;


  if (!d) {
    return (
      <div className={`${styles.stream} ${styles.oxStream}`}>
        <span className={styles.streamHint}>불러오는 중…</span>
      </div>
    );
  }

  return (
    <div className={`${styles.stream} ${styles.oxStream}`}>
      <div className={styles.streamTop}>
        <span className={styles.streamBrand}>OX 퀴즈</span>
        <span className={`${styles.streamTag} ${deathmatch ? styles.streamTagHot : ""}`}>{deathmatch ? "데스매치" : "점수전"}</span>
        <span className={styles.streamCount}>
          <Users size={22} aria-hidden="true" />
          {deathmatch && ox?.started ? (
            <>
              생존 <b className="num">{alive.length}</b>
              <span className={styles.streamCountSub}>/ {players.length}</span>
            </>
          ) : (
            <>
              참여 <b className="num">{players.length}</b>
            </>
          )}
        </span>
      </div>

      {ended ? (
        <div className={styles.streamMain}>
          <Crown className={styles.streamCrown} aria-hidden="true" />
          <b className={styles.streamPrompt}>{deathmatch ? "최후의 생존자" : "OX 퀴즈 끝!"}</b>
          <div className={styles.streamNames}>
            {(deathmatch ? alive : [...players].sort((a, b) => b.correct - a.correct).slice(0, 10)).map((p, i) => (
              <span key={i} className={`${styles.streamName} ${styles.streamNameBig}`}>
                {!deathmatch && <b className="num">{i + 1}</b>}
                {p.name}
                {!deathmatch && <small className="num">{p.correct}개</small>}
              </span>
            ))}
            {deathmatch && alive.length === 0 && <span className={styles.streamHint}>살아남은 사람이 없어요</span>}
          </div>
        </div>
      ) : !cur ? (
        <div className={styles.streamMain}>
          <span className={styles.streamPulse} aria-hidden="true" />
          <b className={styles.streamPrompt}>곧 첫 문제가 나와요</b>
          <span className={styles.streamHint}>팬보드 → 퀴즈 메뉴에서 O / X를 골라주세요</span>
        </div>
      ) : (
        <div className={styles.streamMain}>
          <div className={styles.streamQ}>
            <span className={styles.streamQNo}>
              Q<b className="num">{cur.number}</b>
            </span>
            <b className={styles.streamPrompt}>{cur.prompt.replace(/__/g, "")}</b>
          </div>

          <div className={styles.streamState}>
            {ph?.phase === "ready" ? (
              <span className={styles.streamReady}>곧 카운트다운이 시작됩니다</span>
            ) : ph?.phase === "counting" ? (
              <div className={`${styles.streamRing} ${urgent ? styles.streamRingUrgent : ""}`}>
                <svg viewBox="0 0 120 120" aria-hidden="true">
                  <circle cx="60" cy="60" r={RING_R} className={styles.streamRingBg} />
                  <circle cx="60" cy="60" r={RING_R} className={styles.streamRingFg} strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - frac)} />
                </svg>
                <b className="num">{Math.ceil(ph.left / 1000)}</b>
              </div>
            ) : (
              <span className={`${styles.streamReady} ${cur.revealed ? styles.streamReveal : ""}`}>{cur.revealed ? `정답은 ${cur.answer}!` : "마감! 정답은…?"}</span>
            )}
          </div>

          <div className={styles.streamOX}>
            {(["O", "X"] as const).map((c) => {
              const win = cur.revealed && cur.answer === c;
              const lose = cur.revealed && cur.answer !== c;
              const share = closed && total > 0 ? cur.counts[c] / total : 0;
              return (
                <div key={c} className={`${styles.streamCard} ${c === "O" ? styles.streamO : styles.streamX} ${win ? styles.streamWin : ""} ${lose ? styles.streamLose : ""}`}>
                  <i className={styles.streamFill} style={{ height: `${share * 100}%` }} aria-hidden="true" />
                  {c === "O" ? <OIcon /> : <XIcon />}
                  <b className="num">{closed ? `${cur.counts[c]}명` : "?"}</b>
                  <span className="num">{closed && total > 0 ? `${Math.round(share * 100)}%` : c === "O" ? "맞다" : "아니다"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
