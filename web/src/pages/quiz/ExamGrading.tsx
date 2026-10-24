// 퀴즈 관리자 — 모의고사 채점 탭(시험지 한 장씩 채점, 방송용 채점 화면).
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, PencilLine, Wand2 } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { Select } from "../../components/Select";
import { confirmDialog, toast } from "../../lib/dialog";
import { ExamPaper } from "./Exam";
import { DoodleLayer, FixedPaper } from "./Doodle";
import type { Doodle } from "../../lib/quiz";
import { adminCall, errMsg, useAct, type Detail } from "./quizAdminShared";
import styles from "./Quiz.module.css";

// 제출된 시험지를 한 장씩 띄워 놓고 문항마다 ○/✕ — 방송에 띄우는 화면
export function GradingTab({ d, stream = false }: { d: Detail; stream?: boolean }) {
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
