// 관리자: 날짜 하나의 일정(방송/휴방) 추가·수정·삭제 — admin-schedule 함수.
import { useEffect, useState } from "react";
import { Modal } from "../../components/ui";
import { apiFetch, ApiError } from "../../lib/auth";
import { FUNCTIONS_BASE_URL } from "../../lib/config";
import { WEEK_KO } from "../../lib/format";
import type { SchedRow } from "./Schedule";
import styles from "./Schedule.module.css";
import { confirmDialog } from "../../lib/dialog";

const URL_ = `${FUNCTIONS_BASE_URL}/admin-schedule`;
const pad = (n: number) => String(n).padStart(2, "0");
const ERRORS: Record<string, string> = {
  invalid_title: "제목은 1~30자로 입력해주세요.",
  invalid_time: "시작 시간이 올바르지 않아요.",
  invalid_memo: "메모는 200자까지만 쓸 수 있어요.",
};

export function ScheduleEditor({ day, row, onClose, onSaved }: { day: string | null; row: SchedRow | null; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<"live" | "off">("live");
  const [h24, setH24] = useState(19);
  const [min, setMin] = useState(0);
  const [tbd, setTbd] = useState(false);
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!day) return;
    setKind(row ? row.kind : "live");
    const st = row?.start_time || "19:00"; // 새로 등록할 땐 기본 오후 7시
    setH24(Number(st.slice(0, 2)));
    setMin((Math.round(Number(st.slice(3, 5)) / 5) * 5) % 60);
    setTbd(!!row && row.kind === "live" && !row.start_time);
    setTitle(row?.kind === "live" ? row.title : "");
    setMemo(row?.memo ?? "");
    setStatus({ text: "" });
  }, [day, row]);

  if (!day) return null;
  const [y, m, d] = day.split("-").map(Number);
  const pm = h24 >= 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;

  async function submit(payload: Record<string, unknown>) {
    setBusy(true);
    setStatus({ text: "저장 중..." });
    try {
      await apiFetch(URL_, { body: payload });
      onSaved();
    } catch (e) {
      const code = e instanceof ApiError ? String(e.body.error ?? "") : "";
      setStatus({ text: ERRORS[code] || "저장하지 못했어요.", error: true });
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (kind === "live") {
      const t = title.trim();
      if (!t) return setStatus({ text: "제목을 입력해주세요.", error: true });
      submit({ date: day, kind: "live", time: tbd ? null : `${pad(h24)}:${pad(min)}`, title: t, memo });
    } else {
      submit({ date: day, kind: "off", memo });
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${m}월 ${d}일 (${WEEK_KO[new Date(y, m - 1, d).getDay()]}) 스케줄`}
      actions={
        <>
          {row && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={async () => (await confirmDialog("이 날 일정을 삭제할까요?", { danger: true })) && submit({ date: day, action: "delete" })}
            >
              삭제
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
            저장
          </button>
        </>
      }
    >
      <div className={styles.form}>
        <div className="field">
          <span className="field-label">종류</span>
          <div className="segment">
            <button type="button" aria-selected={kind === "live"} onClick={() => setKind("live")}>
              방송
            </button>
            <button type="button" aria-selected={kind === "off"} onClick={() => setKind("off")}>
              쉬는 날
            </button>
          </div>
        </div>

        {kind === "live" && (
          <>
            <div className="field">
              <span className="field-label">시작 시간</span>
              <div className={`${styles.tp} ${tbd ? styles.tpOff : ""}`}>
                <div className={styles.tpRead}>
                  <span className="muted">{pm ? "오후" : "오전"}</span>
                  <b className="num">
                    {h12}:{pad(min)}
                  </b>
                  <div className={`segment ${styles.mlAuto}`}>
                    <button type="button" aria-selected={!pm} onClick={() => setH24(h24 % 12)}>
                      오전
                    </button>
                    <button type="button" aria-selected={pm} onClick={() => setH24((h24 % 12) + 12)}>
                      오후
                    </button>
                  </div>
                </div>
                <span className={styles.tpLabel}>시</span>
                <div className={styles.tpGrid}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
                    <button key={h} type="button" className={h === h12 ? styles.on : ""} onClick={() => setH24((h % 12) + (pm ? 12 : 0))}>
                      {h}
                    </button>
                  ))}
                </div>
                <span className={styles.tpLabel}>분</span>
                <div className={styles.tpGrid}>
                  {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((mm) => (
                    <button key={mm} type="button" className={mm === min ? styles.on : ""} onClick={() => setMin(mm)}>
                      {pad(mm)}
                    </button>
                  ))}
                </div>
              </div>
              <label className="check">
                <input type="checkbox" checked={tbd} onChange={(e) => setTbd(e.target.checked)} />
                시간 미정 (시간은 나중에 정해요)
              </label>
            </div>
            <label className="field">
              <span className="field-label">제목 / 컨텐츠 (최대 30자)</span>
              <input className="input" maxLength={30} placeholder="예: 잔혹동화 3화" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
          </>
        )}
        <label className="field">
          <span className="field-label">메모 (선택, 최대 200자)</span>
          <textarea className="textarea" rows={3} maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
        <p className={`status ${status.error ? "error" : ""}`}>{status.text}</p>
      </div>
    </Modal>
  );
}
