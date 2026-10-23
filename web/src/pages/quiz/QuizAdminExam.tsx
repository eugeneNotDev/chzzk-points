// 퀴즈 관리자 — 모의고사(문항 만들기, 채점 탭, 채점 방송 화면)
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ImagePlus, MonitorPlay, PencilLine, Plus, Trash2, Wand2 } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { Select } from "../../components/Select";
import { confirmDialog, toast } from "../../lib/dialog";
import { maybeCompressImage } from "../../lib/notices";
import { type QType } from "../../lib/quiz";
import { supabase } from "../../lib/supabase";
import { ExamPaper } from "./Exam";
import { DoodleLayer, FixedPaper } from "./Doodle";
import type { Doodle } from "../../lib/quiz";
import { adminCall, errMsg, useAct, useQuizAdminLive, useStreamTitle, type Detail, type QuestionRow, type QuizRow } from "./quizAdminShared";
import styles from "./Quiz.module.css";

async function uploadImage(file: File): Promise<string> {
  const f = await maybeCompressImage(file);
  const { path, token, publicUrl } = await adminCall<{ path: string; token: string; publicUrl: string }>({ action: "upload-url", fileName: f.name, contentType: f.type });
  const { error } = await supabase.storage.from("quiz-images").uploadToSignedUrl(path, token, f, { contentType: f.type });
  if (error) throw new Error("upload_failed");
  return publicUrl;
}

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
            <button type="button" className={`btn btn-sm ${styles.mlAuto}`} disabled={sel === "new"} onClick={() => setSel("new")}>
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
          <div className={`${styles.actions} ${styles.mt12}`}>
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
    <input className={`${styles.w20} ${styles.h20} ${styles.accentC} ${styles.flexNone}`} type="radio" name="answer" aria-label={`${k + 1}번을 정답으로`} checked={answer === String(k + 1)} onChange={() => setAnswer(String(k + 1))} />
  );

  return (
    <Card
      className={styles.admin}
      title={isNew ? `${number}번 새 문항` : `${number}번 문항 수정`}
      extra={<span className={`tag ${isNew ? "tag-accent" : ""} ${styles.mlAuto}`}>{isNew ? "작성 중 · 아직 추가 안 됨" : "저장된 문항"}</span>}
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
          <span className={`muted ${styles.fs12}`}>
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
          <fieldset className={`field ${styles.bd0} ${styles.p0} ${styles.m0}`}>
            <legend className={`field-label ${styles.mb6}`}>
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
          <fieldset className={`field ${styles.bd0} ${styles.p0} ${styles.m0}`}>
            <legend className={`field-label ${styles.mb6}`}>
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
          {typeLocked && !locked && <span className={`muted ${styles.fs12}`}>제출을 받는 중엔 오타·정답만 고칠 수 있어요.</span>}
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
  // 시험지 낙서 — 낙서 있는 시험지를 볼 때만 불러옴. 채점하다 가리면 "낙서 숨기기"
  const [showDoodle, setShowDoodle] = useState(true);
  const dq = useQuery({
    queryKey: ["quiz-doodle", sheet?.id],
    enabled: !!sheet?.hasDoodle,
    staleTime: Infinity,
    queryFn: () => adminCall<{ doodle: Doodle | null }>({ action: "doodle", submissionId: sheet!.id }),
  });
  const doodle = sheet?.hasDoodle && showDoodle ? dq.data?.doodle ?? null : null;
  const doodleBtn = sheet?.hasDoodle ? (
    <button type="button" className={`btn btn-sm ${showDoodle ? "btn-primary" : ""}`} onClick={() => setShowDoodle((v) => !v)} aria-pressed={showDoodle}>
      <PencilLine size={15} aria-hidden="true" /> {showDoodle ? "낙서 숨기기" : "낙서 보기"}
    </button>
  ) : null;
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

  const paperBase = sheet && (
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
  const paper = doodle ? <FixedPaper overlay={() => <DoodleLayer doodle={doodle} />}>{paperBase}</FixedPaper> : paperBase;
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
              <span className={`muted num ${styles.fs13} ${styles.wsNowrap}`}>
                채점 {marked}/{d.questions.length}
              </span>
              </div>
              <div className={styles.gradeRight}>
              {doodleBtn}
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
                <b className={`num muted ${styles.mr8}`}>
                  {i + 1}
                </b>
                {s.name}
                {s.hasDoodle && <PencilLine size={13} className={styles.ml8} aria-label="낙서 있음" />}
              </span>
              {s.marked === s.total ? <span className="tag tag-accent num">{s.correct}개</span> : <span className="tag num">{s.marked}/{s.total}</span>}
            </button>
          ))}
        </div>
      </Card>

      {sheet && (
        <div className={`${styles.dFlex} ${styles.fdColumn} ${styles.gap16} ${styles.minW0}`}>
          <Card className={styles.admin}>
            <div className={styles.actions}>
              <button type="button" className="btn btn-sm" aria-label="이전 시험지" disabled={idx === 0} onClick={() => setSid(sheets[idx - 1].id)}>
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <b className={styles.fs17}>{sheet.name}</b>
              <span className={`muted num ${styles.fs13}`}>
                {idx + 1} / {sheets.length}
              </span>
              <button type="button" className="btn btn-sm" aria-label="다음 시험지" disabled={idx === sheets.length - 1} onClick={() => setSid(sheets[idx + 1].id)}>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              <span className={`num ${styles.mlAuto}`}>
                맞음 <b className={`${styles.fs18} ${styles.cAccent}`}>{correct}</b> / {d.questions.length}
                <span className={`muted ${styles.fs12} ${styles.ml8}`}>
                  (채점 {marked}/{d.questions.length})
                </span>
              </span>
            </div>
            <div className={`${styles.actions} ${styles.mt12}`}>
              <button type="button" className="btn btn-sm" disabled={busy || paid} onClick={auto}>
                <Wand2 size={16} aria-hidden="true" /> 이 시험지 자동 채점
              </button>
              {doodleBtn}
              <label className="check" style={{ fontSize: 13 }}>
                <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} />
                정답 표시(방송 화면에 보일 수 있어요)
              </label>
              {nextReady && (
                <button type="button" className={`btn btn-sm btn-primary ${styles.mlAuto}`} onClick={() => setSid(sheets[idx + 1].id)}>
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
  const q = useQuery({ queryKey: ["quiz-admin", quizId], refetchInterval: 15_000, queryFn: () => adminCall<Detail>({ action: "get", quizId }) });
  useQuizAdminLive(quizId);
  if (!q.data) return <div className={styles.stream}><span className={styles.streamHint}>불러오는 중…</span></div>;
  return <GradingTab d={q.data} stream />;
}
