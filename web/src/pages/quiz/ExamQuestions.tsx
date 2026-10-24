// 퀴즈 관리자 — 모의고사 문항 탭(문항 목록·순서, 문항 편집기, 이미지 올리기).
import { useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2 } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { confirmDialog, toast } from "../../lib/dialog";
import { maybeCompressImage } from "../../lib/notices";
import { type QType } from "../../lib/quiz";
import { supabase } from "../../lib/supabase";
import { adminCall, errMsg, useAct, type Detail, type QuestionRow, type QuizRow } from "./quizAdminShared";
import styles from "./Quiz.module.css";

async function uploadImage(file: File): Promise<string> {
  const f = await maybeCompressImage(file);
  const { path, token, publicUrl } = await adminCall<{ path: string; token: string; publicUrl: string }>({ action: "upload-url", fileName: f.name, contentType: f.type });
  const { error } = await supabase.storage.from("quiz-images").uploadToSignedUrl(path, token, f, { contentType: f.type });
  if (error) throw new Error("upload_failed");
  return publicUrl;
}

export function QuestionsTab({ d }: { d: Detail }) {
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
