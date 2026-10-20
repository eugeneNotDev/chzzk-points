// 유진고사 — 관리자(유진 알파 계정). 회차 만들기 → 문항 편집 → 응시/출제 → 채점 → 결과 발표 → 보상 지급.
// 서버: admin-quiz 함수. 테스트 회차는 보상 지급을 눌러도 포인트가 안 들어가고 "누구에게 얼마"만 남음.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Settings, Trash2 } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { Modal } from "../../components/ui";
import { apiFetch, ApiError } from "../../lib/auth";
import { API } from "../../lib/config";
import { confirmDialog, toast } from "../../lib/dialog";
import { fmt } from "../../lib/format";
import { maybeCompressImage } from "../../lib/notices";
import { ADMIN_QUIZ_ERRORS, type QType, type QuizStatus } from "../../lib/quiz";
import { supabase } from "../../lib/supabase";
import { leftText } from "./Exam";
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
  time_limit_sec: number;
  reward_ranks: number[];
  reward_survivor: number;
  closes_at: string | null;
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
  points: number;
  grading: "auto" | "manual";
  asked_at: string | null;
  revealed_at: string | null;
};
type Payout = { channelId: string; channelName: string; amount: number; label: string };
type Detail = {
  quiz: QuizRow;
  questions: QuestionRow[];
  payouts: Payout[];
  exam?: {
    submissions: number;
    pending: number;
    ranking: { rank: number; name: string; score: number; correct: number }[];
    shortGroups: { questionId: number; groups: { norm: string; display: string; count: number; isKey: boolean; state: "correct" | "wrong" | "pending" }[] }[];
  };
  ox?: {
    current: { id: number; number: number; prompt: string; answer: string; closesAt: string | null; revealed: boolean; counts: { O: number; X: number } } | null;
    queue: { id: number; prompt: string; answer: string }[];
    players: { name: string; correct: number; alive: boolean; outAt: number | null; answeredCurrent: "O" | "X" | null }[];
    started: boolean;
    revealedCount: number;
  };
};
type ListItem = { id: number; kind: "exam" | "ox"; title: string; status: QuizStatus; isTest: boolean };

const adminCall = <T,>(body: Record<string, unknown>) => apiFetch<T>(API.adminQuiz, { body });
const STATUS_LABEL: Record<QuizStatus, string> = { draft: "준비 중", open: "진행 중", closed: "마감·채점", revealed: "발표 끝" };

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
      const code = e instanceof ApiError ? String(e.body.error ?? "") : "";
      toast(ADMIN_QUIZ_ERRORS[code] || "처리하지 못했어요. 다시 시도해주세요.", "error");
      return null;
    } finally {
      setBusy(false);
      ["quiz-admin", "quiz-admin-list", "quiz", "quiz-peek"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
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
  const list = useQuery({ queryKey: ["quiz-admin-list"], queryFn: () => adminCall<{ quizzes: ListItem[] }>({ action: "list" }) });
  const [selId, setSelId] = useState<number | null>(null);
  const [createKind, setCreateKind] = useState<"exam" | "ox" | null>(null);
  const items = list.data?.quizzes ?? [];

  useEffect(() => {
    if (selId == null && items.length) setSelId((items.find((i) => i.status !== "revealed") ?? items[0]).id);
  }, [items, selId]);

  const detail = useQuery({
    queryKey: ["quiz-admin", selId],
    enabled: selId != null,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (d.quiz.kind === "ox" && d.quiz.status === "open") return 1500;
      return d.quiz.status === "open" || d.quiz.status === "closed" ? 4000 : false;
    },
    queryFn: () => adminCall<Detail>({ action: "get", quizId: selId }),
  });
  const d = detail.data;

  return (
    <>
      <Card className={styles.admin} title="회차">
        <div className={styles.adminTop}>
          <select className="select" style={{ flex: "1 1 260px", minWidth: 0 }} aria-label="회차 고르기" value={selId ?? ""} onChange={(e) => setSelId(Number(e.target.value))}>
            {items.length === 0 && <option value="">아직 만든 회차가 없어요</option>}
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                [{i.kind === "exam" ? "모의고사" : "OX"}] {i.title} · {STATUS_LABEL[i.status]}
                {i.isTest ? " · 테스트" : ""}
              </option>
            ))}
          </select>
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
      {d && <QuizDetail key={d.quiz.id} d={d} onDeleted={() => setSelId(null)} />}
    </>
  );
}

function Steps({ quiz }: { quiz: QuizRow }) {
  const steps = quiz.kind === "exam" ? ["문제 준비", "응시", "마감·채점", "결과 발표", "보상 지급"] : ["문제 준비", "진행", "종료", "보상 지급"];
  const idx =
    quiz.kind === "exam"
      ? quiz.rewarded_at ? 5 : { draft: 0, open: 1, closed: 2, revealed: 3 }[quiz.status] + (quiz.status === "revealed" ? 1 : 0)
      : quiz.rewarded_at ? 4 : { draft: 0, open: 1, closed: 1, revealed: 3 }[quiz.status];
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

function QuizDetail({ d, onDeleted }: { d: Detail; onDeleted: () => void }) {
  const { act, busy } = useAct();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const quiz = d.quiz;

  async function remove() {
    if (!(await confirmDialog(`"${quiz.title}" 회차를 삭제할까요? 답안·응답도 같이 지워져요.`, { danger: true }))) return;
    if (await act({ action: "delete", quizId: quiz.id }, "삭제했어요.")) onDeleted();
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
      {quiz.kind === "exam" ? <ExamAdmin d={d} /> : <OxAdmin d={d} />}
      {quiz.status === "revealed" && <Payouts d={d} />}
    </>
  );
}

// ── 회차 만들기 / 설정 ──
function QuizSettingsModal({ kind, quiz, onClose, onSaved }: { kind: "exam" | "ox"; quiz?: QuizRow; onClose: () => void; onSaved: (id?: number) => void }) {
  const { act, busy } = useAct();
  const [title, setTitle] = useState(quiz?.title ?? (kind === "exam" ? "2026년도 제3회 유진능력고사" : "OX 데스매치"));
  const [subtitle, setSubtitle] = useState(quiz?.subtitle ?? "유진 영역");
  const [isTest, setIsTest] = useState(quiz?.is_test ?? true);
  const [oxMode, setOxMode] = useState<"score" | "deathmatch">(quiz?.ox_mode ?? "deathmatch");
  const [minutes, setMinutes] = useState(String(Math.round((quiz?.time_limit_sec ?? 1200) / 60)));
  const [ranks, setRanks] = useState((quiz?.reward_ranks ?? [5000, 3000, 1000]).join(", "));
  const [survivor, setSurvivor] = useState(String(quiz?.reward_survivor ?? 1000));
  const paid = !!quiz?.rewarded_at;

  async function save() {
    const rewardRanks = ranks
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((s) => Number(s.replace(/[^0-9]/g, "")));
    const body: Record<string, unknown> = { title, isTest, rewardRanks, rewardSurvivor: Number(survivor) || 0 };
    if (kind === "exam") Object.assign(body, { subtitle, timeLimitSec: Math.round(Number(minutes) * 60) });
    else body.oxMode = oxMode;
    if (quiz) {
      if (await act({ action: "update", quizId: quiz.id, ...body }, "저장했어요.")) onSaved();
    } else {
      const r = await act<{ id: number }>({ action: "create", kind, ...body }, "회차를 만들었어요.");
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
          <div className={styles.formRow}>
            <label className="field">
              <span className="field-label">영역 이름(시험지 큰 글씨)</span>
              <input className="input" maxLength={30} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">제한시간(분)</span>
              <input className="input num" inputMode="numeric" value={minutes} disabled={!!quiz && quiz.status !== "draft"} onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, ""))} />
            </label>
          </div>
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
        <label className="check">
          <input type="checkbox" checked={isTest} disabled={paid} onChange={(e) => setIsTest(e.target.checked)} />
          테스트 회차(보상 지급을 눌러도 포인트는 안 들어가요)
        </label>
      </div>
    </Modal>
  );
}

// ── 모의고사 ──
function ExamAdmin({ d }: { d: Detail }) {
  const { act, busy } = useAct();
  const now = useNow();
  const quiz = d.quiz;
  const [sel, setSel] = useState<number | "new" | null>(d.questions[0]?.id ?? (quiz.status === "draft" ? "new" : null));
  const selected = typeof sel === "number" ? d.questions.find((q) => q.id === sel) ?? null : null;
  const closesAt = quiz.closes_at ? new Date(quiz.closes_at).getTime() : 0;
  const exam = d.exam!;

  async function move(id: number, dir: -1 | 1) {
    const ids = d.questions.map((q) => q.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await act({ action: "reorder", quizId: quiz.id, ids });
  }

  async function control(action: string, msg: string, confirmMsg?: string) {
    if (confirmMsg && !(await confirmDialog(confirmMsg))) return;
    await act({ action, quizId: quiz.id }, msg);
  }

  return (
    <>
      <Card className={styles.admin} title="진행">
        <div className={styles.actions}>
          {quiz.status === "draft" && (
            <button type="button" className="btn btn-primary" disabled={busy || d.questions.length === 0} onClick={() => control("open", "응시를 시작했어요.", `${d.questions.length}문항, 제한시간 ${Math.round(quiz.time_limit_sec / 60)}분으로 응시를 시작할까요? 시작하면 문항을 추가·삭제할 수 없어요.`)}>
              응시 시작 ({Math.round(quiz.time_limit_sec / 60)}분)
            </button>
          )}
          {quiz.status === "open" && (
            <>
              <span className="tag tag-live num">남은 시간 {leftText(closesAt - now)}</span>
              <span className="muted">제출 {exam.submissions}명</span>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => act({ action: "extend", quizId: quiz.id, minutes: 5 }, "5분 늘렸어요.")}>
                +5분
              </button>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => control("close", "응시를 마감했어요.", "지금 응시를 마감할까요?")}>
                지금 마감
              </button>
            </>
          )}
          {(quiz.status === "closed" || quiz.status === "open") && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || exam.pending > 0}
              title={exam.pending > 0 ? "채점 안 한 단답이 있어요" : ""}
              onClick={() => control("reveal", "결과를 발표했어요.", "점수·순위를 확정하고 결과를 발표할까요? 시청자 화면에 정답이 공개돼요.")}
            >
              결과 발표{exam.pending > 0 ? ` (미채점 ${exam.pending})` : ""}
            </button>
          )}
          {quiz.status === "revealed" && <span className="muted">결과 발표가 끝났어요. 아래에서 보상을 지급하세요.</span>}
        </div>
      </Card>

      <div className={styles.adminGrid}>
        <Card
          title={`문항 ${d.questions.length}`}
          extra={
            quiz.status === "draft" && (
              <button type="button" className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setSel("new")}>
                <Plus size={16} aria-hidden="true" /> 추가
              </button>
            )
          }
        >
          {d.questions.length === 0 ? (
            <EmptyState>아직 문항이 없어요.</EmptyState>
          ) : (
            <div className={styles.qList}>
              {d.questions.map((q, i) => (
                <button key={q.id} type="button" className={`${styles.qItem} ${sel === q.id ? styles.qItemOn : ""}`} onClick={() => setSel(q.id)}>
                  <b>{i + 1}</b>
                  <span>{q.prompt.replace(/__/g, "")}</span>
                  <span className={`tag ${q.qtype === "short" ? "tag-gold" : q.qtype === "image" ? "tag-blue" : ""}`}>{q.qtype === "short" ? "단답" : q.qtype === "image" ? "이미지" : "객관식"}</span>
                </button>
              ))}
            </div>
          )}
          {selected && quiz.status === "draft" && (
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
            key={String(sel)}
            quiz={quiz}
            question={selected}
            number={selected ? d.questions.indexOf(selected) + 1 : d.questions.length + 1}
            onSaved={(id) => setSel(id)}
            onDeleted={() => setSel(null)}
          />
        ) : (
          <Card>
            <EmptyState>왼쪽에서 문항을 골라요.</EmptyState>
          </Card>
        )}
      </div>

      {quiz.status !== "draft" && exam.shortGroups.length > 0 && <ShortGrading d={d} />}

      {quiz.status !== "draft" && (
        <Card className={styles.admin} title={`${quiz.status === "revealed" ? "확정" : "지금 기준"} 순위`} extra={<span className="muted" style={{ marginLeft: "auto" }}>제출 {exam.submissions}명</span>}>
          {exam.ranking.length === 0 ? (
            <EmptyState>아직 제출한 사람이 없어요.</EmptyState>
          ) : (
            <ol className={styles.rank}>
              {exam.ranking.slice(0, 20).map((r) => (
                <li key={r.rank}>
                  <b className={styles.rankNo}>{r.rank}</b>
                  <span className={styles.rankName}>{r.name}</span>
                  <span className="muted num">{r.correct}개</span>
                  <b className="num">{r.score}점</b>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </>
  );
}

function QuestionEditor({ quiz, question, number, onSaved, onDeleted }: { quiz: QuizRow; question: QuestionRow | null; number: number; onSaved: (id: number) => void; onDeleted: () => void }) {
  const { act, busy } = useAct();
  const [qtype, setQtype] = useState<QType>(question?.qtype ?? "choice");
  const [prompt, setPrompt] = useState(question?.prompt ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(question?.image_url ?? null);
  const [texts, setTexts] = useState<string[]>(question?.qtype === "choice" ? question.choices : ["", "", "", ""]);
  const [imgs, setImgs] = useState<string[]>(question?.qtype === "image" ? question.choices : ["", "", "", ""]);
  const [answer, setAnswer] = useState(question?.answer ?? "");
  const [points, setPoints] = useState(String(question?.points ?? 5));
  const [grading, setGrading] = useState<"auto" | "manual">(question?.grading ?? "manual");
  const [uploading, setUploading] = useState(false);
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
        const code = e instanceof ApiError ? String(e.body.error ?? "") : "";
        toast(ADMIN_QUIZ_ERRORS[code] || "이미지를 올리지 못했어요.", "error");
      } finally {
        setUploading(false);
      }
    };
    input.click();
  }

  async function save() {
    const choices = qtype === "choice" ? texts : qtype === "image" ? imgs : [];
    const r = await act<{ id: number }>(
      { action: "save-question", quizId: quiz.id, question: { id: question?.id, qtype, prompt, imageUrl, choices, answer: qtype === "short" ? answer : answer || "", points: Number(points), grading } },
      question ? "문항을 저장했어요." : "문항을 추가했어요.",
    );
    if (r) onSaved(r.id);
  }

  async function remove() {
    if (!question || !(await confirmDialog(`${number}번 문항을 삭제할까요?`, { danger: true }))) return;
    if (await act({ action: "delete-question", questionId: question.id }, "삭제했어요.")) onDeleted();
  }

  const choiceRadio = (k: number) => (
    <input type="radio" name="answer" aria-label={`${k + 1}번을 정답으로`} checked={answer === String(k + 1)} onChange={() => setAnswer(String(k + 1))} style={{ width: 20, height: 20, accentColor: "var(--c-accent)" }} />
  );

  return (
    <Card className={styles.admin} title={question ? `${number}번 문항 편집` : "새 문항"}>
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
          <>
            <label className="field">
              <span className="field-label">기준 정답</span>
              <input className="input" maxLength={100} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="overdose" />
              <span className="muted" style={{ fontSize: 12 }}>
                대소문자·띄어쓰기는 무시하고 비교해요.
              </span>
            </label>
            <div className="field">
              <span className="field-label">채점 방식</span>
              <label className="check">
                <input type="radio" name="grading" checked={grading === "manual"} onChange={() => setGrading("manual")} />
                방송에서 같이 보고 내가 채점(기준 정답과 같은 답은 미리 정답 처리)
              </label>
              <label className="check">
                <input type="radio" name="grading" checked={grading === "auto"} onChange={() => setGrading("auto")} />
                기준 정답과 같으면 정답, 다르면 오답(자동)
              </label>
            </div>
          </>
        )}

        <label className="field" style={{ maxWidth: 160 }}>
          <span className="field-label">배점</span>
          <input className="input num" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value.replace(/[^0-9]/g, ""))} />
        </label>

        <div className={styles.actions}>
          <button type="button" className="btn btn-primary" disabled={busy || uploading || locked} onClick={save}>
            {question ? "저장" : "문항 추가"}
          </button>
          {question && quiz.status === "draft" && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={remove}>
              <Trash2 size={16} aria-hidden="true" /> 삭제
            </button>
          )}
          {typeLocked && !locked && <span className="muted" style={{ fontSize: 12 }}>응시 중엔 오타·정답만 고칠 수 있어요.</span>}
        </div>
      </div>
    </Card>
  );
}

function ShortGrading({ d }: { d: Detail }) {
  const { act, busy } = useAct();
  const [idx, setIdx] = useState(0);
  const exam = d.exam!;
  const list = exam.shortGroups;
  const cur = list[Math.min(idx, list.length - 1)];
  const q = d.questions.find((x) => x.id === cur.questionId)!;
  const number = d.questions.indexOf(q) + 1;
  const total = cur.groups.reduce((n, g) => n + g.count, 0);
  const pendingHere = cur.groups.filter((g) => g.state === "pending").length;

  const grade = (norm: string, correct: boolean | null) => act({ action: "grade", questionId: q.id, norm, correct });

  return (
    <Card
      className={styles.admin}
      title={`단답 채점 · ${number}번`}
      extra={
        <div className={styles.actions} style={{ marginLeft: "auto" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            같은 답끼리 묶었어요 · {total}명{pendingHere ? ` · 미채점 ${pendingHere}` : ""}
          </span>
          {list.length > 1 && (
            <select className="select" aria-label="단답 문항 고르기" value={idx} onChange={(e) => setIdx(Number(e.target.value))}>
              {list.map((g, i) => {
                const qq = d.questions.find((x) => x.id === g.questionId)!;
                const p = g.groups.filter((x) => x.state === "pending").length;
                return (
                  <option key={g.questionId} value={i}>
                    {d.questions.indexOf(qq) + 1}번{p ? ` (미채점 ${p})` : ""}
                  </option>
                );
              })}
            </select>
          )}
        </div>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
        {q.prompt.replace(/__/g, "")} · 기준 정답 <b style={{ color: "var(--c-text)" }}>{q.answer}</b>
      </p>
      {cur.groups.length === 0 ? (
        <EmptyState>아직 이 문항에 답한 사람이 없어요.</EmptyState>
      ) : (
        <div className={styles.form} style={{ gap: 8 }}>
          {cur.groups.map((g) => (
            <div key={g.norm} className={styles.group} style={g.state === "correct" ? { borderColor: "color-mix(in srgb, var(--c-accent) 50%, transparent)" } : undefined}>
              <b>{g.display}</b>
              <span className="muted num">{g.count}명</span>
              <span className={`${styles.groupState} ${g.state === "correct" ? styles.ok : g.state === "wrong" ? styles.no : styles.pending}`}>
                {g.isKey && g.state === "correct" ? "기준 정답" : g.state === "correct" ? "정답 처리" : g.state === "wrong" ? "오답 처리" : "미채점"}
              </span>
              <div className={styles.actions}>
                <button type="button" className={`btn btn-sm ${g.state === "correct" ? "btn-primary" : ""}`} aria-pressed={g.state === "correct"} disabled={busy} onClick={() => grade(g.norm, true)}>
                  ○ 정답
                </button>
                <button type="button" className={`btn btn-sm ${g.state === "wrong" ? "btn-danger" : ""}`} aria-pressed={g.state === "wrong"} disabled={busy} onClick={() => grade(g.norm, false)}>
                  ✕ 오답
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {list.length > 1 && idx < list.length - 1 && (
        <div className={styles.actions} style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={() => setIdx(idx + 1)}>
            다음 단답 문항
          </button>
        </div>
      )}
    </Card>
  );
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
  const pendingCur = cur && !cur.revealed;
  const closesAt = cur?.closesAt ? new Date(cur.closesAt).getTime() : 0;
  const curOpen = !!pendingCur && closesAt > now;
  const answered = cur ? cur.counts.O + cur.counts.X : 0;
  const alive = ox.players.filter((p) => p.alive).length;
  const deathmatch = quiz.ox_mode === "deathmatch";

  async function ask(questionId?: number) {
    const body: Record<string, unknown> = { action: "ox-ask", quizId: quiz.id, seconds };
    if (questionId) body.questionId = questionId;
    else Object.assign(body, { prompt, answer });
    if (await act(body)) {
      if (!questionId) setPrompt("");
      setAnswer("");
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
      <Card className={styles.admin} title="진행" extra={<span className={`tag ${deathmatch ? "tag-live" : "tag-blue"}`} style={{ marginLeft: "auto" }}>{deathmatch ? "데스매치" : "점수전"}</span>}>
        {quiz.status === "draft" && (
          <div className={styles.actions}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act({ action: "open", quizId: quiz.id }, "OX 퀴즈를 열었어요. 시청자 메뉴에 떠요.")}>
              진행 시작
            </button>
            <span className="muted">시작하면 메뉴에 나타나고, 아래에서 문제를 하나씩 내요.</span>
          </div>
        )}
        {quiz.status === "open" && (
          <div className={styles.oxBody} style={{ gap: 16 }}>
            {cur ? (
              <>
                <div className={styles.tags}>
                  <span className="tag num">{cur.number}번째 문제 · {cur.revealed ? "정답 공개됨" : curOpen ? "출제 중" : "마감"}</span>
                  {curOpen && <b className="num" style={{ marginLeft: "auto", color: "var(--c-live-text)", fontSize: 20 }}>{leftText(closesAt - now)}</b>}
                </div>
                <h3 className={styles.oxPrompt} style={{ fontSize: 22 }}>
                  {cur.prompt.replace(/__/g, "")}
                </h3>
                <div className={styles.rows}>
                  <div className={styles.row}>
                    <b style={{ color: "var(--c-blue)" }}>O · {cur.counts.O}명</b>
                    <span>
                      응답 {answered} / {deathmatch && ox.started ? `생존 ${alive}` : `참여 ${ox.players.length}`}명
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
                      정답 O 공개{cur.answer === "O" ? " (미리 정한 답)" : ""}
                    </button>
                    <button type="button" className="btn" style={{ color: "var(--c-amber)" }} disabled={busy} onClick={() => act({ action: "ox-reveal", questionId: cur.id, answer: "X" })}>
                      정답 X 공개{cur.answer === "X" ? " (미리 정한 답)" : ""}
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
              </>
            ) : (
              <EmptyState>아직 낸 문제가 없어요. 아래에서 첫 문제를 내요.</EmptyState>
            )}
          </div>
        )}
        {quiz.status === "revealed" && <p className="muted">종료된 OX 퀴즈예요. 아래에서 보상을 지급하세요.</p>}
      </Card>

      {quiz.status !== "revealed" && (
        <div className={styles.adminGrid} style={{ gridTemplateColumns: undefined }}>
          <Card className={styles.admin} title="문제 내기">
            <div className={styles.form}>
              <div className={styles.actions}>
                <input
                  className="input"
                  style={{ flex: "1 1 280px", minWidth: 0 }}
                  maxLength={200}
                  aria-label="문제"
                  placeholder="문제를 적고 엔터 → 바로 출제"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && prompt.trim() && quiz.status === "open" && !pendingCur) ask();
                  }}
                />
              </div>
              <div className={styles.actions}>
                <span className="muted" style={{ fontSize: 13 }}>정답 미리 정하기</span>
                <div className="segment" role="tablist" aria-label="정답 미리 정하기">
                  {(["", "O", "X"] as const).map((a) => (
                    <button key={a || "none"} type="button" role="tab" aria-selected={answer === a} onClick={() => setAnswer(a)}>
                      {a || "나중에"}
                    </button>
                  ))}
                </div>
                <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>제한시간</span>
                <div className="segment" role="tablist" aria-label="제한시간">
                  {[5, 10, 20].map((s) => (
                    <button key={s} type="button" role="tab" aria-selected={seconds === s} onClick={() => setSeconds(s)}>
                      {s}초
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.actions}>
                <button type="button" className="btn btn-primary" disabled={busy || !prompt.trim() || quiz.status !== "open" || !!pendingCur} onClick={() => ask()}>
                  바로 출제
                </button>
                <button type="button" className="btn" disabled={busy || !prompt.trim()} onClick={addQueue}>
                  대기열에 추가
                </button>
                <span className="muted" style={{ fontSize: 12 }}>방송 딜레이를 감안해 마감은 3초 늦게 돼요.</span>
              </div>
              {pendingCur && <p className="muted" style={{ fontSize: 13, margin: 0 }}>지금 문제의 정답을 공개해야 다음 문제를 낼 수 있어요.</p>}

              <h3 className="field-label" style={{ margin: "8px 0 0" }}>
                대기열 {ox.queue.length}
              </h3>
              {ox.queue.length === 0 ? (
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  미리 넣어둔 문제가 없어요.
                </p>
              ) : (
                ox.queue.map((q, i) => (
                  <div key={q.id} className={styles.group}>
                    <span className="muted num">{i + 1}</span>
                    <b>{q.prompt}</b>
                    <span className="muted" style={{ fontSize: 12 }}>
                      정답 {q.answer || "나중에"}
                    </span>
                    <div className={styles.actions}>
                      <button type="button" className="btn btn-sm" disabled={busy || quiz.status !== "open" || !!pendingCur} onClick={() => ask(q.id)}>
                        출제
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" aria-label="대기열에서 삭제" disabled={busy} onClick={() => act({ action: "delete-question", questionId: q.id })}>
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
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
        {quiz.status === "open" && (
          <div className={styles.actions} style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={async () => {
                if (await confirmDialog(`OX 퀴즈를 종료할까요? ${deathmatch ? `지금 생존자 ${ox.started ? alive : 0}명` : "지금 순위"}로 결과가 확정돼요.`)) act({ action: "reveal", quizId: quiz.id }, "종료했어요.");
              }}
            >
              종료하고 결과 확정
            </button>
          </div>
        )}
      </Card>
    </>
  );
}

// ── 보상 지급 ──
function Payouts({ d }: { d: Detail }) {
  const { act, busy } = useAct();
  const quiz = d.quiz;
  const total = useMemo(() => d.payouts.reduce((n, p) => n + p.amount, 0), [d.payouts]);
  const paid = !!quiz.rewarded_at;

  async function pay() {
    const msg = quiz.is_test
      ? `테스트 회차라 포인트는 안 들어가요. ${d.payouts.length}명 · 총 ${fmt(total)}P로 지급 기록만 남길까요?`
      : `${d.payouts.length}명에게 총 ${fmt(total)}P를 지급할까요? 되돌릴 수 없어요.`;
    if (!(await confirmDialog(msg, { okText: "지급" }))) return;
    await act({ action: "pay", quizId: quiz.id }, quiz.is_test ? "지급 기록을 남겼어요(테스트)." : "보상을 지급했어요.");
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
          <button type="button" className="btn btn-primary" disabled={busy || d.payouts.length === 0} onClick={pay}>
            {quiz.is_test ? "지급 기록만 남기기(테스트)" : "보상 지급"}
          </button>
        </div>
      )}
    </Card>
  );
}
