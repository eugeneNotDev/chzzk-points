// 출석체크 + 방송 코드.
//  - 출석: 방송 1번에 1번(방송 시작일 기준). 1회 100P, 10번째마다 +100P, 100번째마다 +1,000P — 금액은 서버가 내려줌.
//  - 방송 코드: 방송에서 알려준 코드를 정해진 시간 안에 입력하면 포인트.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Ticket } from "lucide-react";
import { Card } from "../../components/Card";
import { LoginNeeded, Modal, PageHead } from "../../components/ui";
import { apiFetch, ApiError, useAuth } from "../../lib/auth";
import { API } from "../../lib/config";
import { fmt, WEEK_KO } from "../../lib/format";
import { supabase } from "../../lib/supabase";
import styles from "./Attendance.module.css";

type MonthData = {
  attendedDates: string[];
  checkedToday: boolean;
  isLive: boolean;
  balance: number;
  attendanceCount: number;
  bonusEvery: number;
  pointsPerCheck: number;
  bonusPoints: number;
  milestoneEvery: number;
  milestonePoints: number;
};
type CheckinResult = MonthData & { pointsEarned: number; bonus: number; milestoneBonus?: number };

const kstToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const pad = (n: number) => String(n).padStart(2, "0");

const CODE_ERRORS: Record<string, string> = {
  invalid_code: "없는 코드예요. 다시 확인해 주세요.",
  expired: "이미 끝난 코드예요.",
  sold_out: "아쉽지만 선착순 인원이 다 찼어요.",
  already_redeemed: "이미 받은 코드예요.",
  too_many_attempts: "틀린 코드를 너무 많이 입력했어요. 잠시 후 다시 시도해 주세요.",
};

export default function Attendance() {
  const { isLoggedIn, token } = useAuth();
  const qc = useQueryClient();
  const today = kstToday();
  const [ty, tm] = today.split("-").map(Number);
  const [view, setView] = useState({ y: ty, m: tm });
  const [msg, setMsg] = useState<{ text: string; kind?: "ok" | "error" }>({ text: "" });
  const [checking, setChecking] = useState(false);

  // 오늘 기준 상태는 항상 "이번 달" 응답에서(다른 달 응답의 checkedToday는 그 달 기준이 아님)
  const todayQ = useQuery({
    queryKey: ["attendance", token, ty, tm],
    enabled: isLoggedIn,
    queryFn: () => apiFetch<MonthData>(`${API.attendance}?year=${ty}&month=${tm}`),
  });
  const viewQ = useQuery({
    queryKey: ["attendance", token, view.y, view.m],
    enabled: isLoggedIn && !(view.y === ty && view.m === tm),
    queryFn: () => apiFetch<MonthData>(`${API.attendance}?year=${view.y}&month=${view.m}`),
  });
  const monthData = view.y === ty && view.m === tm ? todayQ.data : viewQ.data;
  const status = todayQ.data;

  // 이 달 방송 예정일(점 표시)
  const liveQ = useQuery({
    queryKey: ["schedule", "live-days", view.y, view.m],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const last = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
      const { data } = await supabase
        .from("broadcast_schedule")
        .select("day, kind")
        .gte("day", `${view.y}-${pad(view.m)}-01`)
        .lte("day", `${view.y}-${pad(view.m)}-${pad(last)}`);
      return new Set(((data ?? []) as { day: string; kind: string }[]).filter((r) => r.kind === "live").map((r) => r.day));
    },
  });

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.m - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
    const prevDays = new Date(Date.UTC(view.y, view.m - 1, 0)).getUTCDate();
    const weeks = Math.ceil((first + days) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => {
      const d = i - first + 1;
      const outside = d < 1 || d > days;
      return { label: d < 1 ? prevDays + d : d > days ? d - days : d, outside, col: i % 7, date: outside ? "" : `${view.y}-${pad(view.m)}-${pad(d)}` };
    });
  }, [view]);

  if (!isLoggedIn) {
    return (
      <div className="page">
        <PageHead title="출석체크" desc="방송 중에 출석하고 포인트를 받아요." />
        <Card>
          <LoginNeeded>로그인하면 출석체크하고 포인트를 받을 수 있어요.</LoginNeeded>
        </Card>
        <CodeCard />
      </div>
    );
  }

  const attended = new Set(monthData?.attendedDates ?? []);
  const monthCount = (monthData?.attendedDates ?? []).filter((d) => d.startsWith(`${view.y}-${pad(view.m)}-`)).length;

  const every = status?.bonusEvery || 10;
  const count = status?.attendanceCount || 0;
  const mEvery = status?.milestoneEvery || 100;
  const base = status?.pointsPerCheck ?? 100;
  const bonus = status?.bonusPoints ?? 100;
  const milestone = status?.milestonePoints ?? 1000;
  const nextBonus = ((count + 1) % every === 0 ? bonus : 0) + ((count + 1) % mEvery === 0 ? milestone : 0);
  const left = every - (count % every);
  const mLeft = mEvery - (count % mEvery);

  let btnLabel = "출석체크";
  let btnDisabled = true;
  if (!status) btnLabel = "불러오는 중...";
  else if (status.checkedToday) btnLabel = status.isLive ? "이번 방송 출석 완료" : "오늘 출석 완료";
  else if (!status.isLive) btnLabel = "방송 중에만 출석체크 할 수 있어요";
  else {
    btnLabel = nextBonus > 0 ? `출석체크 +${fmt(base + nextBonus)}P (${count + 1}번째 보너스!)` : `출석체크 +${fmt(base)}P`;
    btnDisabled = checking;
  }

  async function checkin() {
    setChecking(true);
    setMsg({ text: "" });
    try {
      const data = await apiFetch<CheckinResult>(API.attendance, { method: "POST", body: {} });
      qc.setQueryData(["attendance", token, ty, tm], data);
      qc.invalidateQueries({ queryKey: ["me"] });
      setMsg({
        text:
          data.bonus > 0
            ? `출석체크 완료! ${data.attendanceCount}번째 출석 보너스까지 +${fmt(data.pointsEarned ?? 200)}P 받았어요.`
            : `출석체크 완료! +${fmt(data.pointsEarned ?? 100)}P 받았어요.`,
        kind: "ok",
      });
    } catch (e) {
      const code = e instanceof ApiError ? e.body.error : "";
      if (code === "not_live") setMsg({ text: "지금은 방송 중이 아니에요.", kind: "error" });
      else if (code === "already_checked") setMsg({ text: "이번 방송은 이미 출석체크했어요.", kind: "error" });
      else if (code !== "banned") setMsg({ text: "출석체크에 실패했어요. 다시 시도해주세요.", kind: "error" });
      qc.invalidateQueries({ queryKey: ["attendance"] });
    } finally {
      setChecking(false);
    }
  }

  function move(delta: number) {
    const d = new Date(view.y, view.m - 1 + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() + 1 });
  }

  return (
    <div className="page">
      <PageHead title="출석체크" desc="방송 중에 출석하고 포인트를 받아요. 방송 한 번에 한 번이에요." />

      <div className={styles.layout}>
        <Card className={styles.checkCard}>
          <div className={styles.live}>
            <span className={`${styles.dot} ${status?.isLive ? styles.dotLive : ""}`} aria-hidden="true" />
            {status ? (status.isLive ? "방송 중" : "방송 종료") : "확인 중"}
          </div>
          <button type="button" className={`btn btn-primary btn-lg btn-block ${styles.checkBtn}`} disabled={btnDisabled} onClick={checkin}>
            {status?.checkedToday && <Check size={20} aria-hidden="true" />}
            {btnLabel}
          </button>
          <p className={`status ${msg.kind ?? ""}`} role="status">
            {msg.text}
          </p>

          <div className={styles.stats}>
            <div>
              <span className="muted">누적 출석</span>
              <b className="num">{fmt(count)}회</b>
            </div>
            <div>
              <span className="muted">이번 달</span>
              <b className="num">{view.y === ty && view.m === tm ? monthCount : (todayQ.data?.attendedDates ?? []).filter((d) => d.startsWith(`${ty}-${pad(tm)}-`)).length}회</b>
            </div>
          </div>

          <div className={styles.progress}>
            <ProgressRow label={`${every}번째마다 +${fmt(bonus)}P`} left={left} every={every} soon={left === 1 && !status?.checkedToday} />
            <ProgressRow label={`${mEvery}번째마다 +${fmt(milestone)}P`} left={mLeft} every={mEvery} soon={mLeft === 1 && !status?.checkedToday} />
          </div>
        </Card>

        <Card className={styles.calCard}>
          <div className={styles.top}>
            <button type="button" className="btn btn-ghost icon-btn" aria-label="이전 달" onClick={() => move(-1)}>
              <ChevronLeft size={20} />
            </button>
            <h2 className={styles.month}>
              {view.y}년 {view.m}월
            </h2>
            <button type="button" className="btn btn-ghost icon-btn" aria-label="다음 달" onClick={() => move(1)}>
              <ChevronRight size={20} />
            </button>
            <span className={`${styles.monthCount} muted`}>
              이번 달 <b>{monthCount}회</b>
            </span>
          </div>
          <div className={styles.dow}>
            {WEEK_KO.map((w, i) => (
              <div key={w} className={i === 0 ? styles.sun : i === 6 ? styles.sat : ""}>
                {w}
              </div>
            ))}
          </div>
          <div className={styles.grid}>
            {cells.map((c, i) => {
              const done = !c.outside && attended.has(c.date);
              const cls = [
                styles.cell,
                c.outside && styles.other,
                c.col === 0 && styles.sun,
                c.col === 6 && styles.sat,
                !c.outside && c.date < today && styles.past,
                c.date === today && styles.today,
                done && styles.done,
                !c.outside && liveQ.data?.has(c.date) && styles.liveDay,
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div key={i} className={cls}>
                  <span className={`${styles.n} num`}>{c.label}</span>
                  {done && (
                    <span className={styles.stamp} aria-label="출석함">
                      <Check size={18} strokeWidth={3} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className={styles.legend}>
            <span>
              <i className={styles.legStamp} />
              출석함
            </span>
            <span>
              <i className={styles.legDot} />
              방송 예정일
            </span>
          </div>
        </Card>
      </div>

      <CodeCard />
    </div>
  );
}

function ProgressRow({ label, left, every, soon }: { label: string; left: number; every: number; soon: boolean }) {
  const pct = ((every - left) / every) * 100;
  return (
    <div className={styles.pRow}>
      <div className={styles.pHead}>
        <span>{label}</span>
        <span className={soon ? styles.soon : "muted"}>{soon ? "다음 출석에 보너스!" : `${left}회 남음`}</span>
      </div>
      <div className={styles.bar}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CodeCard() {
  const { isLoggedIn } = useAuth();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; points?: number } | null>(null);
  const [doc, setDoc] = useState<{ title: string; body: string; foot: string } | null>(null);

  useEffect(() => {
    if (!isLoggedIn) setResult(null);
  }, [isLoggedIn]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c) return setResult({ ok: false, text: "코드를 입력해 주세요." });
    setBusy(true);
    setResult(null);
    try {
      const data = await apiFetch<{ points: number; rank: number; maxUses: number | null; balance: number; doc?: { title: string; body: string; foot: string } }>(API.streamCode, {
        body: { code: c },
      });
      setCode("");
      if (data.doc) {
        setDoc({ title: String(data.doc.title || ""), body: String(data.doc.body || ""), foot: String(data.doc.foot || "") });
        return;
      }
      const rankText = data.maxUses ? `선착순 ${fmt(data.maxUses)}명 중 ${fmt(data.rank)}번째` : `${fmt(data.rank)}번째로 받았어요`;
      setResult({ ok: true, points: data.points, text: `받았어요! ${rankText}` });
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return;
      const k = err instanceof ApiError ? String(err.body.error ?? "") : "";
      setResult({ ok: false, text: CODE_ERRORS[k] || "코드 입력에 실패했어요. 다시 시도해 주세요." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={<span className={styles.codeTitle}><Ticket size={18} aria-hidden="true" /> 방송 코드</span>}>
      <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
        방송 화면 왼쪽 위에 뜬 코드를 입력하면 포인트를 받아요. 코드는 10분 동안만 받을 수 있어요.
      </p>
      {isLoggedIn ? (
        <form className={styles.codeForm} onSubmit={submit}>
          <input
            className={`input ${styles.codeInput}`}
            maxLength={20}
            placeholder="코드 입력"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="방송 코드"
          />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            받기
          </button>
        </form>
      ) : (
        <LoginNeeded>로그인하면 방송 코드를 입력할 수 있어요.</LoginNeeded>
      )}
      {result && (
        <div className={`${styles.codeResult} ${result.ok ? styles.codeOk : styles.codeErr}`} role="status">
          {result.points != null && <b className="num">+{fmt(result.points)}P</b>}
          <span>{result.text}</span>
        </div>
      )}

      <Modal open={!!doc} onClose={() => setDoc(null)} title={doc?.title} actions={<button type="button" className="btn" onClick={() => setDoc(null)}>닫기</button>}>
        <pre className={styles.doc}>{doc?.body}</pre>
        {doc?.foot && <p className={styles.docFoot}>{doc.foot}</p>}
      </Modal>
    </Card>
  );
}
