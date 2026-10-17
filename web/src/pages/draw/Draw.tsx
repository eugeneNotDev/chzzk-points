// 그림 후원 — 그림을 그려서 보내면 6자리 코드를 받음. 치지직 후원 메시지에 그 코드를 넣고 3,000치즈 이상 후원하면
// 방송 화면(오버레이)에 그림이 떠요. 코드는 24시간·한 번만. (서버: drawings 함수, 후원 확인은 donation-relay)
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, MessageSquareText, Palette, Send, Tv } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { LoadError } from "../../components/LoadError";
import { SkeletonList } from "../../components/Skeleton";
import { LoginNeeded, PageHead } from "../../components/ui";
import { ApiError, apiFetch, useAuth } from "../../lib/auth";
import { useBroadcastStatus } from "../../lib/queries";
import { API, CHZZK_CHANNEL_URL } from "../../lib/config";
import { confirmDialog, toast } from "../../lib/dialog";
import { fmt, relTime } from "../../lib/format";
import { DrawCanvas, type DrawCanvasHandle } from "./DrawCanvas";
import styles from "./Draw.module.css";

type Item = { id: number; code: string; status: "pending" | "shown" | "hidden" | "expired"; url: string | null; expiresAt: string; createdAt: string; shownAt: string | null; shortAmount: number | null };
type Mine = { items: Item[]; minAmount: number };
const call = <T,>(payload: Record<string, unknown>) => apiFetch<T>(API.drawings, { body: payload });
const MIN = 3000;

const ERR: Record<string, string> = {
  too_fast: "조금만 있다가 다시 보내주세요. (30초에 한 장)",
  too_large: "그림 파일이 너무 커요. 조금 덜 복잡하게 그려주세요.",
  blocked: "그림 후원이 제한된 계정이에요.",
  banned: "이용이 제한된 계정이에요.",
  invalid_image: "그림을 저장하지 못했어요. 다시 시도해주세요.",
  not_live: "방송 중에만 그림을 보낼 수 있어요. 그린 그림은 저장돼 있으니 방송이 켜지면 보내주세요.",
};
const errText = (e: unknown) => (e instanceof ApiError ? ERR[(e.body as { error?: string })?.error ?? ""] : null) ?? "보내지 못했어요. 잠시 후 다시 시도해주세요.";

const STATUS: Record<Item["status"], { label: string; cls: string }> = {
  pending: { label: "후원 기다리는 중", cls: "wait" },
  shown: { label: "방송에 나왔어요", cls: "shown" },
  hidden: { label: "관리자가 내렸어요", cls: "off" },
  expired: { label: "만료됨", cls: "off" },
};

function leftText(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "만료됨";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `${h}시간 ${m}분 남음` : `${m}분 남음`;
}

export default function Draw() {
  const { isLoggedIn, isAdmin } = useAuth();
  const qc = useQueryClient();
  // 방송 중에만 보낼 수 있음(그리기는 언제든 — 그리던 그림은 저장됨). 스트리머 계정은 시험용으로 예외.
  const live = useBroadcastStatus();
  const offAir = live.data?.isLive === false && !isAdmin;
  const canvas = useRef<DrawCanvasHandle>(null);
  const [blank, setBlank] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<{ code: string; expiresAt: string } | null>(null);
  const mine = useQuery({
    queryKey: ["drawings", "mine"],
    enabled: isLoggedIn,
    queryFn: () => call<Mine>({ action: "mine" }),
    // 후원 기다리는 그림이 있으면 상태 확인(방송에 나왔는지) — 보낸 지 10분까지는 5초마다, 그 뒤엔 30초마다.
    // (탭이 뒤로 가 있으면 자동으로 멈춤) 서버 호출 수를 아끼려고.
    refetchInterval: (q) => {
      const waiting = q.state.data?.items.filter((i) => i.status === "pending") ?? [];
      if (!waiting.length) return false;
      const newest = Math.max(...waiting.map((i) => new Date(i.createdAt).getTime()));
      return Date.now() - newest < 10 * 60_000 ? 5000 : 30_000;
    },
  });
  const minAmount = mine.data?.minAmount ?? MIN;
  const current = sent ? mine.data?.items.find((i) => i.code === sent.code) : undefined;

  // 방송에 나오는 순간 알려줌
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (current?.status === "shown" && prevStatus.current === "pending") toast("그림이 방송 화면에 떴어요!");
    prevStatus.current = current?.status;
  }, [current?.status]);

  async function send() {
    if (!canvas.current || canvas.current.isBlank() || sending) return;
    // 아직 후원 안 한 코드가 있으면 새 코드를 받는 순간 그 코드(그림)는 사라짐
    const waiting = mine.data?.items.find((i) => i.status === "pending");
    if (waiting && !(await confirmDialog(`아직 후원하지 않은 코드 ${waiting.code}가 있어요.\n새 코드를 받으면 이전 코드와 그림은 사라져요. 보낼까요?`, { okText: "새 코드 받기" }))) return;
    setSending(true);
    setErr(null);
    try {
      const r = await call<{ code: string; expiresAt: string; minAmount: number }>({ action: "create", image: canvas.current.exportImage(), strokes: canvas.current.exportOps() });
      setSent({ code: r.code, expiresAt: r.expiresAt });
      canvas.current.clear();
      qc.invalidateQueries({ queryKey: ["drawings", "mine"] });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setSending(false);
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast("코드를 복사했어요");
    } catch {
      toast("복사하지 못했어요. 코드를 직접 적어주세요.", "info");
    }
  }

  return (
    <div className="page">
      <PageHead
        title="그림 후원"
        desc={`그림을 그려서 코드를 받고, 치지직 후원 메시지에 코드를 넣어 ${fmt(minAmount)}치즈 이상 후원하면 방송 화면에 그림이 떠요.`}
      />

      <ol className={styles.steps}>
        <li>
          <span className={styles.stepIc}>
            <Palette size={18} aria-hidden="true" />
          </span>
          <b>1. 그리기</b>
          <span>아래 그림판에 그리고 보내기를 눌러요</span>
        </li>
        <li>
          <span className={styles.stepIc}>
            <MessageSquareText size={18} aria-hidden="true" />
          </span>
          <b>2. 코드를 후원 메시지에</b>
          <span>
            받은 코드를 넣고 <b className="num">{fmt(minAmount)}</b>치즈 이상 후원해요
          </span>
        </li>
        <li>
          <span className={styles.stepIc}>
            <Tv size={18} aria-hidden="true" />
          </span>
          <b>3. 방송에 그림 표시</b>
          <span>후원이 확인되면 바로 화면에 떠요</span>
        </li>
      </ol>

      {!isLoggedIn ? (
        <Card>
          <LoginNeeded>로그인하면 그림 후원을 보낼 수 있어요.</LoginNeeded>
        </Card>
      ) : (
        <>
          {sent && (
            <Card className={styles.codeCard}>
              <div className={styles.codeHead}>
                <span className={styles.codeLabel}>후원 메시지에 넣을 코드</span>
                <span className={`${styles.state} ${styles[STATUS[current?.status ?? "pending"].cls]}`}>
                  {current?.status === "shown" && <Check size={13} aria-hidden="true" />}
                  {STATUS[current?.status ?? "pending"].label}
                </span>
              </div>
              <div className={styles.codeRow}>
                <span className={`${styles.code} num`} aria-label={`코드 ${sent.code.split("").join(" ")}`}>
                  {sent.code.split("").map((c, i) => (
                    <i key={i}>{c}</i>
                  ))}
                </span>
                <button type="button" className="btn btn-primary" onClick={() => copy(sent.code)}>
                  <Copy size={16} aria-hidden="true" />
                  복사
                </button>
              </div>
              <p className={styles.codeHelp}>
                치지직에서 후원할 때 메시지에 <b>{sent.code}</b>를 넣어 <b className="num">{fmt(minAmount)}</b>치즈 이상 후원해 주세요. 코드는 한 번만 쓸 수 있고{" "}
                {leftText(sent.expiresAt)}이에요. 시간 안에 후원하지 않거나 새 코드를 받으면 이 코드와 그림은 지워져요.
                {current?.shortAmount != null && current.status === "pending" && (
                  <span className={styles.short}>
                    {fmt(current.shortAmount)}치즈 후원은 확인됐는데 {fmt(minAmount)}치즈보다 적어서 그림이 안 떴어요. 다시 후원하면 같은 코드로 떠요.
                  </span>
                )}
              </p>
              <div className={styles.codeActions}>
                <a href={CHZZK_CHANNEL_URL} target="_blank" rel="noopener" className="btn">
                  치지직 방송으로 가기
                </a>
                <button type="button" className="btn btn-ghost" onClick={() => setSent(null)}>
                  새로 그리기
                </button>
              </div>
            </Card>
          )}

          {!sent && (
            <Card flush className={styles.drawCard}>
              <DrawCanvas ref={canvas} onChange={setBlank} />
              <div className={styles.sendRow}>
                {err && (
                  <p className="status error" role="alert">
                    {err}
                  </p>
                )}
                <ol className={styles.notes}>
                  <li>코드는 한 사람당 하나예요. 새로 보내면 아직 후원 안 한 이전 코드는 사라져요.</li>
                  <li>그림판 전체가 방송 화면 전체예요. 후원이 확인되면 배경 없이 그림만, 그린 자리 그대로 방송 화면 위에 그려져요.</li>
                  <li>다른 사람을 불쾌하게 하는 그림은 관리자가 바로 내리고 그림 후원을 막을 수 있어요.</li>
                </ol>
                <button type="button" className="btn btn-primary btn-lg" disabled={blank || sending || offAir} onClick={send}>
                  <Send size={17} aria-hidden="true" />
                  {offAir ? "방송 중에만 보낼 수 있어요" : sending ? "보내는 중…" : "그림 보내고 코드 받기"}
                </button>
              </div>
            </Card>
          )}

          <Card title="내 그림" flush>
            <ol className={`${styles.notes} ${styles.mineNote}`}>
              <li>방송에 나온 그림은 6개월 동안 보관된 뒤 지워져요.</li>
              <li>코드를 받고 24시간 안에 후원하지 않은 그림은 바로 지워져요.</li>
            </ol>
            {mine.isLoading && <SkeletonList rows={3} variant="row" />}
            {mine.isError && <LoadError what="내 그림" onRetry={() => mine.refetch()} />}
            {mine.data?.items.length === 0 && <EmptyState>아직 보낸 그림이 없어요.</EmptyState>}
            <ul className={styles.mine}>
              {mine.data?.items.map((i) => (
                <li key={i.id}>
                  {i.url ? <img src={i.url} alt="" loading="lazy" /> : <span className={styles.gone}>지난 그림</span>}
                  <div className={styles.mineText}>
                    <span className={`${styles.mineCode} num`}>{i.code}</span>
                    <span className="muted">
                      {i.status === "shown" && i.shownAt ? `${relTime(i.shownAt)} 방송에 나옴` : i.status === "pending" ? leftText(i.expiresAt) : relTime(i.createdAt)}
                    </span>
                  </div>
                  <span className={`${styles.state} ${styles[STATUS[i.status].cls]}`}>{STATUS[i.status].label}</span>
                  {i.status === "pending" && (
                    <button type="button" className="btn btn-sm" onClick={() => copy(i.code)} aria-label={`코드 ${i.code} 복사`}>
                      <Copy size={14} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
