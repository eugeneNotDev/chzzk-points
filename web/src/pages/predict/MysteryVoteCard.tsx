// 미스테리 라디오 연속 투표 카드 — 이야기 한 편에 투표 3개(예측 ① ② + 최종 진실/거짓)가 차례로 열림.
// 무료로 투표만 해도 맞힌 개수만큼 기본 보상, 원하면 첫 투표 마감 전에 포인트를 걸어 맞힌 개수별 배수로 돌려받음.
// "투표" 메뉴 맨 위에 뜸(진행 중이거나 방금 끝난 이야기가 있을 때만).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Lock, Radio, X } from "lucide-react";
import { ApiError } from "../../lib/auth";
import { fmt } from "../../lib/format";
import { castMysteryVote, MYSTERY_ERRORS, placeMysteryBet, useMystery, type MysteryQuestion, type MysterySet } from "../../lib/mystery";
import styles from "./MysteryVoteCard.module.css";

const NUM = ["①", "②", "③", "④", "⑤", "⑥"];
const errText = (e: unknown, fallback: string) => {
  const code = e instanceof ApiError ? String(e.body.error ?? "") : "";
  return MYSTERY_ERRORS[code] ?? fallback;
};

export function MysteryVoteCard() {
  const q = useMystery();
  const s = q.data?.set;
  if (!s) return null;
  const revealed = s.status !== "open";
  return (
    <section className={styles.card} aria-live="polite">
      <div className={styles.head}>
        <span className={styles.live}>
          <Radio size={14} aria-hidden="true" />
          {revealed ? "미스테리 라디오 결과" : "미스테리 라디오 투표 중"}
        </span>
        {s.isTest && <span className="tag">테스트</span>}
      </div>
      <h3 className={styles.title}>{s.title}</h3>

      {s.myResult && <ResultBox s={s} />}
      {(s.betOpen || s.myBet) && !revealed && <BetBox s={s} />}

      <ol className={styles.steps}>
        {s.questions.map((qq) => (
          <Question key={qq.id} q={qq} last={qq.position === s.questions[s.questions.length - 1].position} />
        ))}
      </ol>

      <RewardTable s={s} />
    </section>
  );
}

function Question({ q, last }: { q: MysteryQuestion; last: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const label = last ? "최종 투표" : `예측 투표 ${NUM[q.position - 1] ?? q.position}`;

  if (q.status === "pending") {
    return (
      <li className={`${styles.step} ${styles.pending}`}>
        <span className={styles.stepLabel}>{label}</span>
        <span className={styles.wait}>
          <Lock size={13} aria-hidden="true" /> 이야기가 진행되면 열려요
        </span>
      </li>
    );
  }

  const open = q.status === "open";
  const showPct = q.myChoice !== null || !open;
  async function pick(i: number) {
    setBusy(i);
    setErr(null);
    try {
      await castMysteryVote(q.id, i);
      qc.invalidateQueries({ queryKey: ["mystery"] });
    } catch (e) {
      setErr(errText(e, "투표에 실패했어요."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className={`${styles.step} ${open ? styles.stepOpen : ""}`}>
      <div className={styles.stepTop}>
        <span className={styles.stepLabel}>{label}</span>
        <span className={styles.stepMeta}>
          {open ? "투표 중" : q.answer !== null ? "정답 공개" : "마감"} · <b className="num">{q.total}</b>표
        </span>
      </div>
      <p className={styles.prompt}>{q.prompt}</p>
      <div className={styles.opts}>
        {q.options.map((o, i) => {
          const pct = q.total ? Math.round((q.counts[i] / q.total) * 100) : 0;
          const mine = q.myChoice === i;
          const right = q.answer !== null && q.answer === i;
          const wrong = q.answer !== null && mine && !right;
          return (
            <button
              key={i}
              type="button"
              className={`${styles.opt} ${mine ? styles.mine : ""} ${right ? styles.right : ""} ${wrong ? styles.wrong : ""}`}
              disabled={!open || busy !== null}
              aria-pressed={mine}
              onClick={() => pick(i)}
            >
              {showPct && <i className={styles.fill} style={{ width: `${pct}%` }} aria-hidden="true" />}
              <span className={`num ${styles.key}`}>{i + 1}</span>
              <span className={styles.optText}>{o}</span>
              {showPct && <span className={`num ${styles.pct}`}>{pct}%</span>}
              {right && <Check size={16} aria-hidden="true" />}
              {wrong && <X size={16} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <p className={styles.fine}>
        {err ?? (open ? (q.myChoice !== null ? "마감 전까지 다른 선택지로 바꿀 수 있어요" : "골라서 누르면 바로 투표돼요") : q.myChoice === null ? "이 투표엔 참여하지 않았어요" : "")}
      </p>
    </li>
  );
}

function BetBox({ s }: { s: MysterySet }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  async function bet() {
    const a = Math.trunc(Number(amount));
    if (!Number.isFinite(a) || a < 100) return setMsg({ text: "100P 이상 입력해주세요.", error: true });
    setBusy(true);
    setMsg(null);
    try {
      const d = await placeMysteryBet(s.id, a);
      setMsg({ text: `${fmt(a)}P 걸었어요! (이 이야기에 총 ${fmt(d.amount)}P)${d.test ? " · 테스트라 포인트는 안 빠져요" : ""}` });
      setAmount("");
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["mystery"] });
    } catch (e) {
      setMsg({ text: errText(e, "베팅에 실패했어요."), error: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.bet}>
      <div className={styles.betHead}>
        <b>포인트 걸기 (선택)</b>
        <span>{s.betOpen ? "첫 번째 투표가 마감되기 전까지" : "베팅 마감"}</span>
      </div>
      {s.myBet && (
        <p className={styles.betMine}>
          이 이야기에 <b className="num">{fmt(s.myBet.amount)}P</b> 걸었어요. 맞힌 개수에 따라 돌려받아요.
        </p>
      )}
      {s.betOpen && (
        <>
          <div className={styles.betForm}>
            <input
              className="input num"
              inputMode="numeric"
              placeholder={s.myBet ? "추가로 걸 포인트 (최소 100P)" : "걸 포인트 (최소 100P)"}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              aria-label="걸 포인트"
            />
            <button type="button" className="btn btn-primary" disabled={busy || !amount} onClick={bet}>
              {s.myBet ? "더 걸기" : "걸기"}
            </button>
          </div>
          <div className={styles.quick}>
            {[100, 500, 1000].map((v) => (
              <button key={v} type="button" className="btn btn-sm" onClick={() => setAmount(String((Number(amount) || 0) + v))}>
                +{fmt(v)}
              </button>
            ))}
          </div>
        </>
      )}
      {msg && <p className={`status ${msg.error ? "error" : "ok"}`} role="status">{msg.text}</p>}
    </div>
  );
}

function ResultBox({ s }: { s: MysterySet }) {
  const r = s.myResult!;
  const n = s.questions.length;
  const paid = s.status === "paid";
  return (
    <div className={`${styles.result} ${r.correct === n ? styles.perfect : ""}`}>
      <p className={styles.resultBig}>
        {n}개 중 <b className="num">{r.correct}</b>개 적중{r.correct === n ? " — 전부 맞혔어요!" : ""}
      </p>
      <div className={styles.resultRows}>
        <span>기본 보상</span>
        <b className="num">+{fmt(r.base)}P</b>
        {r.betPayout !== null && s.myBet && (
          <>
            <span>베팅 정산 ({fmt(s.myBet.amount)}P × {s.multipliers[r.correct]}배)</span>
            <b className="num">+{fmt(r.betPayout)}P</b>
          </>
        )}
      </div>
      <p className={styles.fine}>{paid ? (s.isTest ? "테스트라 실제 포인트는 들어가지 않았어요." : "지급 완료!") : "곧 지급돼요."}</p>
    </div>
  );
}

function RewardTable({ s }: { s: MysterySet }) {
  return (
    <div className={styles.table} aria-label="맞힌 개수별 보상">
      <div className={styles.row}>
        <span>맞힌 개수</span>
        {s.rewards.map((_, i) => (
          <span key={i} className="num">{i}개</span>
        ))}
      </div>
      <div className={styles.row}>
        <span>기본 보상</span>
        {s.rewards.map((v, i) => (
          <span key={i} className="num">{v ? `${fmt(v)}P` : "-"}</span>
        ))}
      </div>
      <div className={styles.row}>
        <span>베팅 배수</span>
        {s.multipliers.map((v, i) => (
          <span key={i} className="num">{v}배</span>
        ))}
      </div>
    </div>
  );
}
