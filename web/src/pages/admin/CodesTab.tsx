// 방송 코드 — 만들기(고정/랜덤 포인트, 선착순, 지속 시간) · 진행 중인 코드(남은 시간·받은 인원, 지금 종료) · 지난 코드.
// 남은 시간은 서버 시각 기준. 진행 중이면 10초마다 받은 인원을 새로 불러옴.
import { useEffect, useState, type FormEvent } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Timer } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { Pagination } from "../../components/Pagination";
import { ApiError, apiFetch } from "../../lib/auth";
import { API } from "../../lib/config";
import { fmtDateTime, num } from "../../lib/admin";
import styles from "./Admin.module.css";
import { alertDialog, confirmDialog, copyDialog } from "../../lib/dialog";

type Code = { id: number; code: string; points: number; pointsMax: number | null; maxUses: number | null; usedCount: number; expiresAt: string | null; endedAt: string | null; createdAt: string };
type CodesData = { active: Code | null; past: Code[]; page: number; totalPages: number; overlayUrl: string | null; serverNow: string };

const ERR: Record<string, string> = {
  invalid_code: "코드는 한글/영문/숫자 2~20자로 써주세요.",
  invalid_points: "포인트를 1 이상으로 넣어주세요.",
  invalid_max_uses: "선착순 인원은 1명 이상이거나 비워두세요.",
  invalid_minutes: "지속 시간은 1분 이상이거나 비워두세요(비우면 무제한).",
  invalid_points_max: "랜덤 최대 포인트는 최소보다 커야 해요.",
};
const pointsLabel = (c: Code) => (c.pointsMax ? `${num(c.points)}~${num(c.pointsMax)}P 랜덤` : `+${num(c.points)}P`);
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const isPosInt = (s: string) => Number.isInteger(Number(s)) && Number(s) > 0;

export function CodesTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["admin", "codes", page],
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.active ? 10_000 : false),
    queryFn: async () => {
      const d = await apiFetch<CodesData>(`${API.adminStreamCodes}?page=${page}`);
      const off = new Date(d.serverNow).getTime() - Date.now();
      return { ...d, offset: Number.isFinite(off) ? off : 0 };
    },
  });
  const d = q.data;
  const reload = () => qc.invalidateQueries({ queryKey: ["admin", "codes"] });

  // 1초마다 남은 시간 갱신, 다 되면 다시 불러옴
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!d?.active?.expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [d?.active?.expiresAt]);
  const left = d?.active ? (d.active.expiresAt ? new Date(d.active.expiresAt).getTime() - (now + d.offset) : Infinity) : 0;
  useEffect(() => {
    if (d?.active && left <= 0) reload();
  }, [left <= 0, d?.active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [code, setCode] = useState("");
  const [points, setPoints] = useState("100");
  const [random, setRandom] = useState(false);
  const [pointsMax, setPointsMax] = useState("500");
  const [maxUses, setMaxUses] = useState("");
  const [minutes, setMinutes] = useState("10");
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!isPosInt(points)) return setMsg({ text: ERR.invalid_points });
    if (maxUses.trim() && !isPosInt(maxUses)) return setMsg({ text: ERR.invalid_max_uses });
    if (minutes.trim() && !isPosInt(minutes)) return setMsg({ text: ERR.invalid_minutes });
    if (random && (!isPosInt(pointsMax) || Number(pointsMax) <= Number(points))) return setMsg({ text: ERR.invalid_points_max });
    if (d?.active && left > 0 && !(await confirmDialog(`진행 중인 코드(${d.active.code})를 끝내고 새 코드를 만들까요?`))) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ code: string }>(API.adminStreamCodes, {
        body: {
          action: "create",
          code: code.trim(),
          points: Number(points),
          pointsMax: random ? Number(pointsMax) : null,
          maxUses: maxUses.trim() ? Number(maxUses) : null,
          minutes: minutes.trim() ? Number(minutes) : null,
        },
      });
      setMsg({
        text: minutes.trim() ? `코드 ${r.code}를 만들었어요. ${num(Number(minutes))}분 동안 입력할 수 있어요.` : `코드 ${r.code}를 만들었어요. 직접 종료할 때까지 입력할 수 있어요.`,
        ok: true,
      });
      setCode("");
      setPage(1);
      reload();
    } catch (er) {
      setMsg({ text: (er instanceof ApiError && ERR[String(er.body.error)]) || "코드를 만들지 못했어요." });
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    const a = d?.active;
    if (!a || !(await confirmDialog(`코드 ${a.code}를 지금 종료할까요? 종료하면 더 이상 입력할 수 없어요.`, { danger: true }))) return;
    try {
      await apiFetch(API.adminStreamCodes, { body: { action: "end", id: a.id } });
    } catch (er) {
      if (!(er instanceof ApiError && er.body.error === "not_active")) alertDialog("종료하지 못했어요.");
    }
    reload();
  };

  const copy = async () => {
    if (!d?.overlayUrl) return;
    try {
      await navigator.clipboard.writeText(d.overlayUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      copyDialog("아래 주소를 복사해서 OBS 브라우저 소스 URL에 넣어주세요.", d.overlayUrl);
    }
  };

  const a = d?.active;
  return (
    <>
      <Card title="방송 코드 만들기">
        <form className={styles.codeForm} onSubmit={create}>
          <label className="field">
            <span className="field-label">코드</span>
            <input className="input" maxLength={20} placeholder="비우면 자동 (예: K7Q2MX)" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <div className="field">
            <span className="field-label">
              포인트
              <label className={styles.inlineCheck}>
                <input type="checkbox" checked={random} onChange={(e) => setRandom(e.target.checked)} /> 랜덤
              </label>
            </span>
            <div className={styles.inline}>
              <input type="number" className="input" min={1} value={points} onChange={(e) => setPoints(e.target.value)} aria-label={random ? "최소 포인트" : "포인트"} />
              {random && (
                <>
                  <span>~</span>
                  <input type="number" className="input" min={1} value={pointsMax} onChange={(e) => setPointsMax(e.target.value)} aria-label="최대 포인트" />
                </>
              )}
            </div>
          </div>
          <label className="field">
            <span className="field-label">선착순 인원</span>
            <input type="number" className="input" min={1} placeholder="비우면 무제한" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">지속 시간(분)</span>
            <input type="number" className="input" min={1} placeholder="비우면 무제한" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            코드 만들기
          </button>
        </form>
        {msg && <p className={`status ${msg.ok ? "ok" : "error"}`}>{msg.text}</p>}
        {q.isError && <p className="status error">방송 코드를 불러오지 못했어요.</p>}
        {d?.overlayUrl && (
          <div className={styles.overlayRow}>
            <span>OBS 오버레이 주소(코드 표시용, 키 포함 — 남에게 공유 X)</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
              <Copy size={14} aria-hidden="true" />
              {copied ? "복사됨!" : "주소 복사"}
            </button>
          </div>
        )}
      </Card>

      <Card title="진행 중인 코드">
        {!a ? (
          <EmptyState>진행 중인 코드가 없어요.</EmptyState>
        ) : (
          <div className={styles.activeCode}>
            <div className={`${styles.codeBig} num`}>{a.code}</div>
            <div className={styles.codeMeta}>
              <span className={styles.codeTime}>
                <Timer size={16} aria-hidden="true" /> {left === Infinity ? "제한 없음" : mmss(left)}
              </span>
              <span>
                {pointsLabel(a)} ·{" "}
                {a.maxUses ? (
                  <>
                    선착순 {num(a.maxUses)}명 중 <b>{num(a.usedCount)}명</b> 받음
                  </>
                ) : (
                  <>
                    <b>{num(a.usedCount)}명</b> 받음 · 무제한
                  </>
                )}
              </span>
            </div>
            <button type="button" className="btn btn-danger btn-sm" onClick={end}>
              지금 종료
            </button>
          </div>
        )}
      </Card>

      <Card title="지난 코드" flush>
        {d && d.past.length === 0 && <EmptyState>아직 만든 코드가 없어요.</EmptyState>}
        {d?.past.map((c) => {
          const full = c.maxUses && c.usedCount >= c.maxUses;
          return (
            <div key={c.id} className={styles.codeRow}>
              <span className={`${styles.codeName} num`}>{c.code}</span>
              <span className={styles.muted}>
                {pointsLabel(c)} · {c.maxUses ? `${num(c.usedCount)}/${num(c.maxUses)}명` : `${num(c.usedCount)}명 받음`}
                {full ? " (마감)" : c.endedAt ? " · 직접 종료" : " · 시간 종료"}
              </span>
              <span className={styles.time}>{fmtDateTime(c.createdAt)}</span>
            </div>
          );
        })}
        {d && <Pagination page={d.page} totalPages={d.totalPages} onChange={setPage} />}
      </Card>
    </>
  );
}
