// 투표(승부예측) — 치지직 승부예측과 같은 방식. 항목에 포인트를 걸고, 정산하면 진 쪽 포인트가
// 이긴 쪽에 건 비율대로 나눠짐. 다른 유저에겐 누가 어디 걸었는지 안 보임.
// 처음 건 항목은 못 바꾸고 같은 항목에만 더 걸 수 있음. 관리자는 생성/취소/정산 + 참여자 보기.
import { SkelInline } from "../../components/Skeleton";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Trophy } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { LoginNeeded, PageHead, Stat } from "../../components/ui";
import { apiFetch, ApiError, useAuth } from "../../lib/auth";
import { API } from "../../lib/config";
import { fmt } from "../../lib/format";
import { useMe } from "../../lib/queries";
import { PredictAdmin } from "./PredictAdmin";
import styles from "./Predict.module.css";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import { LoadError } from "../../components/LoadError";
import { LifeVoteCard } from "../life/LifeVoteCard";
import { MysteryVoteCard } from "./MysteryVoteCard";

export type PredictionOption = { id: number; label: string; totalAmount: number; percent: number; multiplier: number };
export type Prediction = {
  id: number;
  title: string;
  status: "open" | "resolved" | "cancelled";
  closesAt: string;
  resolvedAt: string | null;
  cancelledAt: string | null;
  winningOptionId: number | null;
  options: PredictionOption[];
  totalPool: number;
  myBet: { optionId: number; amount: number; payout: number | null } | null;
};

export const formatCountdown = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// 정산/취소된 투표는 10분 지나면 화면에서만 "진행 중인 투표가 없어요"로 되돌림
const EXPIRE_DISPLAY_MS = 10 * 60_000;
const BET_ERRORS: Record<string, string> = {
  insufficient_balance: "포인트가 부족해요.",
  already_bet: "처음 건 항목에만 더 걸 수 있어요.",
  different_option: "처음 건 항목에만 더 걸 수 있어요.",
  prediction_closed: "이미 마감된 투표예요.",
  amount_too_small: "100P 이상 입력해주세요.",
};

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export default function Predict() {
  const { isLoggedIn, isAdmin, channelId } = useAuth();
  const me = useMe();
  const qc = useQueryClient();
  const now = useNow();
  const q = useQuery({
    queryKey: ["prediction", channelId],
    enabled: isLoggedIn,
    // 다른 사람 베팅이 새로고침 없이 반영되게 — 베팅을 받는 중엔 5초, 마감 후 정산 기다리는 중엔 15초,
    // 진행 중인 투표가 없으면 1분(투표가 없을 때까지 5초마다 부르면 서버만 바빠짐)
    refetchInterval: (query) => {
      const cur = query.state.data?.prediction;
      if (!cur || cur.status !== "open") return 60_000;
      return new Date(cur.closesAt).getTime() > Date.now() ? 5000 : 15_000;
    },
    queryFn: () => apiFetch<{ prediction: Prediction | null }>(API.predictions),
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);

  const p = q.data?.prediction ?? null;
  const ended = p?.status === "resolved" ? p.resolvedAt : p?.status === "cancelled" ? p.cancelledAt : null;
  const hidden = !p || (ended && now - new Date(ended).getTime() >= EXPIRE_DISPLAY_MS);

  // 정산·취소되거나 내 배당/환불이 바뀌면 상단 보유 포인트도 다시 불러옴(처음 그릴 때는 빼고)
  const settleSig = p ? `${p.id}:${p.status}:${p.myBet?.payout ?? ""}:${p.myBet?.amount ?? ""}` : "";
  const prevSettleSig = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSettleSig.current;
    prevSettleSig.current = settleSig;
    if (prev === null || prev === settleSig || !p || p.status === "open") return;
    qc.invalidateQueries({ queryKey: ["me"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settleSig, qc]);

  // 새 투표로 바뀌면 선택 초기화
  useEffect(() => {
    setSelected(null);
    setStatus({ text: "" });
  }, [p?.id]);

  if (!isLoggedIn) {
    return (
      <div className="page">
        <PageHead title="투표" desc="방송 중 승부예측에 포인트를 걸어보세요." />
        <Card>
          <LoginNeeded>로그인하면 투표에 참여할 수 있어요.</LoginNeeded>
        </Card>
      </div>
    );
  }

  const closesAt = p ? new Date(p.closesAt).getTime() : 0;
  const isOpen = !!p && p.status === "open" && closesAt > now;
  const awaiting = !!p && p.status === "open" && closesAt <= now;
  const selectable = isOpen && !p?.myBet;
  const pick = p?.myBet && isOpen ? p.myBet.optionId : selected;

  async function bet() {
    if (!p || pick == null) return;
    const a = Math.trunc(Number(amount));
    if (!Number.isFinite(a) || a < 100) return setStatus({ text: "100P 이상 입력해주세요.", error: true });
    setBusy(true);
    setStatus({ text: "베팅 중..." });
    try {
      const d = await apiFetch<{ balance: number; bet: { amount: number; added: boolean } }>(API.predictions, {
        body: { predictionId: p.id, optionId: pick, amount: a },
      });
      setStatus({ text: d.bet?.added ? `${fmt(a)}P 추가 베팅 완료! (총 ${fmt(d.bet.amount)}P)` : "베팅 완료!" });
      setAmount("");
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      const code = e instanceof ApiError ? String(e.body.error ?? "") : "";
      if (code !== "banned") setStatus({ text: BET_ERRORS[code] || "베팅에 실패했어요.", error: true });
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["prediction"] });
    }
  }

  const heading = !p || hidden ? "진행 중인 투표" : p.status === "cancelled" ? "취소된 투표" : p.status === "resolved" ? "종료된 투표" : awaiting ? "마감된 투표" : "진행 중인 투표";

  return (
    <div className="page">
      <PageHead
        title="투표"
        desc="방송 중 승부예측에 포인트를 걸어보세요. 맞히면 진 쪽 포인트를 건 비율대로 나눠 받아요."
        stats={<Stat label="보유 포인트" value={me.data ? <AnimatedNumber value={me.data.balance} /> : <SkelInline w={90} h={22} />} unit="P" tone="accent" />}
      />

      <div className="split">
      <div className="split-main">
      {/* 미스테리 라디오 연속 투표 — 진행 중이거나 방금 끝난 이야기가 있을 때만 뜸(베타 전용) */}
      <MysteryVoteCard />
      {/* 유진 키우기 방송 투표 — 유진이 방송에서 투표를 열었을 때만 뜸 */}
      <LifeVoteCard />
      {isAdmin && <PredictAdmin />}

      <Card title={heading} tone={p && !hidden && isOpen ? "feature" : undefined}>
        {q.isLoading && <span className={`skeleton ${styles.h160}`} />}
        {q.isError && !q.data && <LoadError what="투표" onRetry={() => q.refetch()} />}
        {!q.isLoading && !(q.isError && !q.data) && hidden && <EmptyState>진행 중인 투표가 없어요. 방송 중에 투표가 열리면 여기에 떠요.</EmptyState>}
        {p && !hidden && (
          <div className={styles.body}>
            <h3 className={styles.title}>{p.title}</h3>
            {isOpen && (
              <span className={`${styles.countdown} ${closesAt - now < 30_000 ? styles.urgent : ""}`}>
                <Clock size={14} aria-hidden="true" />
                마감까지 <b className="num">{formatCountdown(closesAt - now)}</b>
              </span>
            )}
            {awaiting && <span className={styles.countdown}>마감! 정산을 기다리는 중이에요.</span>}
            {p.status === "cancelled" && <p className={styles.banner}>{p.myBet ? "취소된 투표예요. 베팅하신 포인트는 전액 환불됐어요." : "취소된 투표예요."}</p>}
            {p.status === "resolved" &&
              (p.myBet ? (
                p.myBet.optionId === p.winningOptionId ? (
                  <p className={`${styles.banner} ${styles.win}`}>
                    <Trophy size={16} aria-hidden="true" /> 적중! +{fmt(p.myBet.payout ?? 0)}P 받았어요.
                  </p>
                ) : (
                  <p className={`${styles.banner} ${styles.lose}`}>아쉽게 빗나갔어요. 다음 기회에!</p>
                )
              ) : (
                <p className={styles.banner}>정산이 끝난 투표예요.</p>
              ))}

            <div className={styles.options} role={selectable ? "radiogroup" : undefined}>
              {p.options.map((o) => {
                const mine = p.myBet?.optionId === o.id;
                const winner = p.status === "resolved" && p.winningOptionId === o.id;
                const loser = p.status === "resolved" && p.winningOptionId != null && !winner;
                const on = mine || pick === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role={selectable ? "radio" : undefined}
                    aria-checked={selectable ? on : undefined}
                    disabled={!selectable}
                    className={`${styles.option} ${on ? styles.on : ""} ${winner ? styles.winner : ""} ${loser ? styles.loser : ""}`}
                    onClick={() => setSelected(o.id)}
                  >
                    <span className={styles.bar} style={{ width: `${o.percent.toFixed(1)}%` }} />
                    <span className={styles.optLabel}>
                      {winner && <Check size={16} aria-hidden="true" />}
                      {o.label}
                      {mine && <span className="tag tag-accent">내 선택 {fmt(p.myBet!.amount)}P</span>}
                    </span>
                    <span className={`${styles.optStats} num`}>
                      <b>{o.percent.toFixed(1)}%</b>
                      <span>{o.multiplier > 0 ? `${o.multiplier.toFixed(2)}배` : "-"}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className={`muted ${styles.fs12}`}>
              총 <b className="num">{fmt(p.totalPool)}P</b> 걸렸어요
            </p>

            {p.myBet && (
              <p className={styles.myBet}>
                "{p.options.find((o) => o.id === p.myBet!.optionId)?.label}"에 {fmt(p.myBet.amount)}P {isOpen ? "걸었어요. 같은 항목에만 더 걸 수 있어요." : "베팅했어요."}
              </p>
            )}

            {isOpen && (
              <div className={styles.betForm}>
                <input
                  className="input num"
                  inputMode="numeric"
                  placeholder={p.myBet ? "추가로 걸 포인트 (최소 100P)" : "베팅할 포인트 (최소 100P)"}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                  aria-label="베팅할 포인트"
                />
                <div className={styles.quick}>
                  {[100, 500, 1000, 5000].map((v) => (
                    <button key={v} type="button" className="btn btn-sm" onClick={() => setAmount(String((Number(amount) || 0) + v))}>
                      +{fmt(v)}
                    </button>
                  ))}
                </div>
                <button type="button" className="btn btn-primary btn-lg" disabled={pick == null || busy} onClick={bet}>
                  {p.myBet ? "같은 항목에 추가 베팅" : pick == null ? "항목을 먼저 골라주세요" : "선택한 항목에 베팅"}
                </button>
              </div>
            )}
            <p className={`status ${status.error ? "error" : "ok"}`} role="status">
              {status.text}
            </p>
          </div>
        )}
      </Card>
      </div>
      <aside className="split-aside">
        <MyBetCard p={p && !hidden ? p : null} />
        <Card title="참여 방법" tone="quiet">
          <ol className={styles.steps}>
            <li>
              <b>항목 고르기</b>
              <span>방송 중 열린 투표에서 결과를 예상해 골라요.</span>
            </li>
            <li>
              <b>포인트 걸기</b>
              <span>100P부터 걸 수 있고, 마감 전까진 같은 항목에 더 걸 수 있어요.</span>
            </li>
            <li>
              <b>나눠 받기</b>
              <span>맞히면 진 쪽에 걸린 포인트를 건 비율대로 나눠 받아요. 배율은 실시간으로 바뀌어요.</span>
            </li>
          </ol>
        </Card>
      </aside>
      </div>
    </div>
  );
}

// 내 베팅 요약 — 지금 투표에 건 포인트와, 이대로 맞히면 받을 예상 포인트
function MyBetCard({ p }: { p: Prediction | null }) {
  const bet = p?.myBet;
  const opt = bet ? p!.options.find((o) => o.id === bet.optionId) : null;
  return (
    <Card title="내 베팅">
      {!bet || !opt ? (
        <p className={styles.mbEmpty}>{p ? "아직 이번 투표에 걸지 않았어요." : "열린 투표가 없어요."}</p>
      ) : (
        <div className={styles.mb}>
          <div className={styles.mbRow}>
            <span>고른 항목</span>
            <b>{opt.label}</b>
          </div>
          <div className={styles.mbRow}>
            <span>건 포인트</span>
            <b className="num">{fmt(bet.amount)}P</b>
          </div>
          <div className={`${styles.mbRow} ${styles.mbBig}`}>
            <span>{p!.status === "resolved" ? "받은 포인트" : "맞히면 예상"}</span>
            <b className="num">
              {p!.status === "resolved" ? fmt(bet.payout ?? 0) : opt.multiplier > 0 ? `≈ ${fmt(Math.floor(bet.amount * opt.multiplier))}` : "-"}
              <small>P</small>
            </b>
          </div>
        </div>
      )}
    </Card>
  );
}
