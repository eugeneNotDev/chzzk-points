// 관리자: 투표 생성/취소/정산 + 참여자 목록(비익명). admin 함수의 *-prediction 액션들.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users, X } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { Modal } from "../../components/ui";
import { Pagination } from "../../components/Pagination";
import { apiFetch, ApiError, useAuth } from "../../lib/auth";
import { API } from "../../lib/config";
import { fmt } from "../../lib/format";
import { formatCountdown, useNow, type PredictionOption } from "./Predict";
import styles from "./Predict.module.css";
import { confirmDialog } from "../../lib/dialog";

type AdminPrediction = { id: number; title: string; status: string; closesAt: string; options: PredictionOption[]; bets?: { channelName: string | null; optionId: number; amount: number }[] };

const adminCall = <T,>(body: Record<string, unknown>) => apiFetch<T>(API.admin, { body });

export function PredictAdmin() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const now = useNow();
  const q = useQuery({
    queryKey: ["prediction-admin", token],
    refetchInterval: 5000,
    queryFn: () => adminCall<{ prediction: AdminPrediction | null }>({ action: "get-prediction-status" }),
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [betsOpen, setBetsOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean }>({ text: "" });

  const p = q.data?.prediction;
  const open = !!p && p.status === "open";
  const closed = open && new Date(p!.closesAt).getTime() <= now;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["prediction-admin"] });
    qc.invalidateQueries({ queryKey: ["prediction"] });
  };

  async function cancel() {
    if (!p || !(await confirmDialog("진행 중인 투표를 취소할까요? 걸린 포인트는 전액 환불돼요.", { danger: true }))) return;
    setMsg({ text: "처리 중..." });
    try {
      await adminCall({ action: "cancel-prediction", predictionId: p.id });
      setMsg({ text: "취소하고 환불했어요." });
      refresh();
    } catch {
      setMsg({ text: "취소에 실패했어요.", error: true });
    }
  }

  return (
    <Card
      title="투표 관리"
      className={styles.adminCard}
      extra={
        <button type="button" className="btn btn-sm" style={{ marginLeft: "auto" }} disabled={open} title={open ? "진행 중인 투표가 있어요(한 번에 하나만)" : ""} onClick={() => setCreateOpen(true)}>
          <Plus size={16} aria-hidden="true" />
          투표 생성
        </button>
      }
    >
      {!open && <EmptyState>진행 중인 투표가 없어요.</EmptyState>}
      {open && p && (
        <div className={styles.body}>
          <h3 className={styles.title}>{p.title}</h3>
          <span className={styles.countdown}>{closed ? "마감됨 — 정산 대기중" : <>마감까지 <b className="num">{formatCountdown(new Date(p.closesAt).getTime() - now)}</b></>}</span>
          <div className={styles.options}>
            {p.options.map((o) => (
              <div key={o.id} className={styles.option}>
                <span className={styles.bar} style={{ width: `${o.percent.toFixed(1)}%` }} />
                <span className={styles.optLabel}>{o.label}</span>
                <span className={`${styles.optStats} num`}>
                  <b>{o.percent.toFixed(1)}%</b>
                  <span>{fmt(o.totalAmount)}P</span>
                </span>
              </div>
            ))}
          </div>
          <div className={styles.adminActions}>
            <button type="button" className="btn btn-sm" onClick={() => setBetsOpen(true)}>
              <Users size={16} aria-hidden="true" />
              참여자 보기 ({fmt(p.bets?.length ?? 0)}명)
            </button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm btn-danger" onClick={cancel}>
              투표 취소 (전액 환불)
            </button>
            <button type="button" className="btn btn-sm btn-primary" disabled={!closed} onClick={() => setResolveOpen(true)}>
              {closed ? "정산하기" : "마감 후 정산 가능"}
            </button>
          </div>
        </div>
      )}
      <p className={`status ${msg.error ? "error" : "ok"}`}>{msg.text}</p>

      {createOpen && (
        <CreateModal
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            refresh();
          }}
        />
      )}
      {betsOpen && p && <BetsModal prediction={p} onClose={() => setBetsOpen(false)} />}
      {resolveOpen && p && (
        <ResolveModal
          prediction={p}
          onClose={() => setResolveOpen(false)}
          onDone={() => {
            setResolveOpen(false);
            setMsg({ text: "정산 완료했어요." });
            refresh();
          }}
        />
      )}
    </Card>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [duration, setDuration] = useState<number | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);

  async function submit() {
    const t = title.trim();
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!t) return setStatus({ text: "투표 이름을 입력해주세요.", error: true });
    if (opts.length < 2) return setStatus({ text: "투표 항목을 2개 이상 입력해주세요.", error: true });
    if (!duration) return setStatus({ text: "투표 시간을 선택해주세요.", error: true });
    setBusy(true);
    setStatus({ text: "생성 중..." });
    try {
      await adminCall({ action: "create-prediction", title: t, options: opts, durationMinutes: duration });
      onDone();
    } catch (e) {
      setStatus({ text: e instanceof ApiError && e.body.error === "already_open" ? "이미 진행 중인 투표가 있어요." : "생성에 실패했어요.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="투표 생성"
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
            생성
          </button>
        </>
      }
    >
      <div className={styles.form}>
        <label className="field">
          <span className="field-label">투표 이름</span>
          <input className="input" maxLength={80} placeholder="예: 이번 판 이길까요?" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="field">
          <span className="field-label">투표 항목 (기본 2개, 필요하면 추가)</span>
          {options.map((o, i) => (
            <div key={i} className={styles.optRow}>
              <input
                className="input"
                maxLength={40}
                placeholder={`투표 항목 ${i + 1}`}
                value={o}
                onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {i >= 2 && (
                <button type="button" className="btn btn-ghost icon-btn" aria-label="항목 삭제" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                  <X size={18} />
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setOptions([...options, ""])}>
            <Plus size={16} aria-hidden="true" />
            투표 항목 추가
          </button>
        </div>
        <div className="field">
          <span className="field-label">투표 시간</span>
          <div className="segment">
            {[5, 10, 15].map((m) => (
              <button key={m} type="button" aria-selected={duration === m} onClick={() => setDuration(m)}>
                {m}분
              </button>
            ))}
          </div>
        </div>
        <p className={`status ${status.error ? "error" : ""}`}>{status.text}</p>
      </div>
    </Modal>
  );
}

function BetsModal({ prediction, onClose }: { prediction: AdminPrediction; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const bets = prediction.bets ?? [];
  const labels = new Map(prediction.options.map((o) => [o.id, o.label]));
  const totalPages = Math.max(1, Math.ceil(bets.length / 10));
  const cur = Math.min(page, totalPages);
  return (
    <Modal open onClose={onClose} title="참여자 목록" subtitle={`총 ${fmt(bets.length)}명 참여`} actions={<button type="button" className="btn" onClick={onClose}>닫기</button>}>
      {bets.length === 0 && <EmptyState>아직 베팅이 없어요.</EmptyState>}
      <ul className={styles.betList}>
        {bets.slice((cur - 1) * 10, cur * 10).map((b, i) => (
          <li key={i}>
            <span className={styles.betWho}>{b.channelName || "(이름 없음)"}</span>
            <span className="tag">{labels.get(b.optionId)}</span>
            <b className="num">{fmt(b.amount)}P</b>
          </li>
        ))}
      </ul>
      <Pagination page={cur} totalPages={totalPages} onChange={setPage} />
    </Modal>
  );
}

function ResolveModal({ prediction, onClose, onDone }: { prediction: AdminPrediction; onClose: () => void; onDone: () => void }) {
  const [sel, setSel] = useState<number | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  async function confirmResolve() {
    if (sel == null) return;
    setBusy(true);
    setStatus({ text: "정산 중..." });
    try {
      await adminCall({ action: "resolve-prediction", predictionId: prediction.id, winningOptionId: sel });
      onDone();
    } catch (e) {
      setStatus({ text: e instanceof ApiError && e.body.error === "not_closed_yet" ? "아직 마감 전이에요." : "정산에 실패했어요.", error: true });
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="정산할 항목 선택"
      subtitle={prediction.title}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={sel == null || busy} onClick={confirmResolve}>
            정산 확정
          </button>
        </>
      }
    >
      <div className={styles.options} role="radiogroup">
        {prediction.options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={sel === o.id} className={`${styles.option} ${sel === o.id ? styles.on : ""}`} onClick={() => setSel(o.id)}>
            <span className={styles.optLabel}>{o.label}</span>
            <span className={`${styles.optStats} num`}>
              <b>{o.percent.toFixed(1)}%</b>
              <span>{fmt(o.totalAmount)}P</span>
            </span>
          </button>
        ))}
      </div>
      <p className={`status ${status.error ? "error" : ""}`} style={{ marginTop: 12 }}>
        {status.text}
      </p>
    </Modal>
  );
}
