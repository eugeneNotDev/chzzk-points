// 무료 뽑기 — 하루 한 번(한국 시간 자정 초기화) 선물 상자를 열어 포인트를 받음.
// 포인트는 서버(free-box 함수 → DB free_box_open)가 정하고, 화면은 연출만 함. 확률은 화면에 안 보여줌.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Gift, LogIn } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, EmptyState } from "../components/Card";
import { ApiError, getToken, startLogin, useAuth } from "../lib/auth";
import { fmt, formatLeft, kstToday } from "../lib/format";
import { openFreeBox, useFreeBox, type FreeBoxState } from "../lib/freeBox";
import styles from "./Freebox.module.css";

type Phase = "ready" | "opening" | "opened" | "done";

function GiftBoxArt({ golden }: { golden: boolean }) {
  const c = golden
    ? { l: "#e0a812", r: "#b8860b", top: "#ffd75e", ribbon: "#ff5c8a", ribbonDark: "#d9406d", ribbonTop: "#ff7aa2", bandL: "#f2c230", bandR: "#d1a21c" }
    : { l: "#00b97f", r: "#00936a", top: "#4df5c2", ribbon: "#ff5c8a", ribbonDark: "#d9406d", ribbonTop: "#ff7aa2", bandL: "#14e3a4", bandR: "#00b88a" };
  return (
    <svg width="220" height="230" viewBox="0 0 220 230" aria-hidden="true">
      <ellipse cx="110" cy="214" rx="78" ry="10" fill="#000" opacity="0.35" />
      <path d="M30 98 L110 136 L110 210 L30 172 Z" fill={c.l} />
      <path d="M190 98 L110 136 L110 210 L190 172 Z" fill={c.r} />
      <path d="M62 113 L80 122 L80 196 L62 187 Z" fill={c.ribbon} />
      <path d="M158 113 L140 122 L140 196 L158 187 Z" fill={c.ribbonDark} />
      <path d="M22 84 L110 126 L110 146 L22 104 Z" fill={c.bandL} />
      <path d="M198 84 L110 126 L110 146 L198 104 Z" fill={c.bandR} />
      <path d="M22 84 L110 44 L198 84 L110 126 Z" fill={c.top} />
      <path d="M56 69 L144 109 L162 101 L74 61 Z" fill={c.ribbonTop} />
      <path d="M146 61 L58 101 L76 109 L164 69 Z" fill={c.ribbonTop} />
      <path d="M110 80 C 92 52, 62 52, 70 72 C 76 86, 98 84, 110 80 Z" fill={c.ribbon} />
      <path d="M110 80 C 128 52, 158 52, 150 72 C 144 86, 122 84, 110 80 Z" fill={c.ribbonDark} />
      <circle cx="110" cy="80" r="9" fill="#ff8fb2" />
    </svg>
  );
}

function useCountdown(state: FreeBoxState | undefined) {
  const offset = useRef(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state?.serverNow) offset.current = new Date(state.serverNow).getTime() - Date.now();
  }, [state?.serverNow]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return state ? new Date(state.nextResetAt).getTime() - (now + offset.current) : 0;
}

export default function Freebox() {
  const { isLoggedIn } = useAuth();
  const q = useFreeBox();
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("ready");
  const [result, setResult] = useState<{ points: number; jackpot: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const left = useCountdown(q.data);

  // 서버 상태가 오면 화면 단계 맞추기(이미 열었으면 done)
  useEffect(() => {
    if (!q.data || phase === "opening" || phase === "opened") return;
    setPhase(q.data.openedToday ? "done" : "ready");
  }, [q.data, phase]);

  // 자정이 지나면 새 상자 다시 불러오기
  useEffect(() => {
    if (q.data?.openedToday && left <= 0) qc.invalidateQueries({ queryKey: ["free-box"] });
  }, [left, q.data?.openedToday, qc]);

  async function onOpen() {
    if (phase !== "ready" || !q.data || q.data.openedToday) return;
    setError(null);
    setPhase("opening");
    try {
      const [res] = await Promise.all([openFreeBox(), new Promise((r) => setTimeout(r, reduce ? 200 : 1400))]);
      setResult({ points: res.points, jackpot: res.jackpot });
      setPhase("opened");
      // 캐시 갱신 — 상단 포인트, 홈 바로가기 문구, 최근 기록이 같이 바뀜
      qc.setQueryData<FreeBoxState>(["free-box", getToken()], (prev) =>
        prev
          ? {
              ...prev,
              openedToday: true,
              todayPoints: res.points,
              balance: res.balance,
              nextResetAt: res.nextResetAt,
              serverNow: res.serverNow,
              recent: [{ date: kstToday(), points: res.points }, ...prev.recent].slice(0, 7),
            }
          : prev,
      );
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      if (e instanceof ApiError && e.body.error === "already_opened") {
        await qc.invalidateQueries({ queryKey: ["free-box"] });
        setPhase("done");
        return;
      }
      setPhase("ready");
      setError("상자를 열지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }

  if (!isLoggedIn) {
    return (
      <div className={styles.page}>
        <PageHead />
        <Card>
          <div className={styles.loggedOut}>
            <GiftBoxArt golden={false} />
            <p>로그인하면 매일 무료 선물 상자를 열 수 있어요.</p>
            <button type="button" className={styles.openBtn} onClick={startLogin}>
              <LogIn size={18} aria-hidden="true" />
              치지직으로 로그인
            </button>
          </div>
        </Card>
      </div>
    );
  }

  const opened = phase === "opened";
  const jackpot = !!result?.jackpot;
  const caption =
    phase === "ready"
      ? "오늘의 선물 상자가 도착했어요!"
      : phase === "opening"
        ? "두근두근…"
        : opened
          ? jackpot
            ? "대박! 황금 상자예요!"
            : result && result.points > 0
              ? `선물 상자에서 ${fmt(result.points)}P가 나왔어요!`
              : "앗, 상자가 비어 있었어요… 내일 다시 도전!"
          : "오늘 상자는 이미 열었어요";

  return (
    <div className={styles.page}>
      <PageHead />
      <div className={styles.layout}>
        <section className={styles.stageCard}>
          <div className={`${styles.stage} ${jackpot ? styles.jackpot : ""}`}>
            <div className={`${styles.rays} ${opened ? styles.raysOn : ""}`} aria-hidden="true" />
            <div className={styles.glow} aria-hidden="true" />

            {q.isLoading ? (
              <span className="skeleton" style={{ width: 200, height: 200, borderRadius: 24 }} />
            ) : (
              <AnimatePresence mode="wait">
                {!opened ? (
                  <motion.button
                    key="box"
                    type="button"
                    className={styles.box}
                    onClick={onOpen}
                    disabled={phase !== "ready"}
                    aria-label="선물 상자 열기"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={
                      phase === "opening"
                        ? { opacity: 1, scale: 1, rotate: [0, -7, 7, -5, 5, -3, 3, 0], transition: { duration: 0.7, repeat: Infinity } }
                        : phase === "done"
                          ? { opacity: 0.45, scale: 0.92, rotate: 0, y: 0, filter: "grayscale(0.7)" }
                          : { opacity: 1, scale: 1, rotate: 0, y: reduce ? 0 : [0, -10, 0], transition: { y: { duration: 3.2, repeat: Infinity, ease: "easeInOut" } } }
                    }
                    exit={{ opacity: 0, scale: 1.25, transition: { duration: 0.25 } }}
                    whileHover={phase === "ready" ? { scale: 1.04 } : undefined}
                    whileTap={phase === "ready" ? { scale: 0.96 } : undefined}
                  >
                    <GiftBoxArt golden={false} />
                  </motion.button>
                ) : (
                  <motion.div
                    key="prize"
                    className={styles.prize}
                    role="status"
                    aria-live="polite"
                    initial={{ opacity: 0, scale: 0.4 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 14 }}
                  >
                    <span className={styles.prizeLabel}>{jackpot ? "황금 상자" : "상자에서 나왔어요"}</span>
                    <span className={`${styles.prizeAmount} num`}>
                      +{fmt(result?.points ?? 0)}
                      <span>P</span>
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
            <p className={styles.caption}>{caption}</p>
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.openBtn} onClick={onOpen} disabled={phase !== "ready" || !q.data}>
              <Gift size={20} aria-hidden="true" />
              {phase === "opening" ? "여는 중…" : phase === "ready" ? "무료로 열기" : "오늘은 이미 열었어요"}
            </button>
            {error && <p className={styles.error}>{error}</p>}
            <p className={styles.reset}>
              {phase === "ready" ? (
                "하루 한 번 · 매일 자정(00시)에 다시 열 수 있어요"
              ) : (
                <>
                  다음 상자까지 <b className="num">{formatLeft(left)}</b>
                </>
              )}
            </p>
          </div>
        </section>

        <div className={styles.side}>
          <Card>
            <span className={styles.balLabel}>보유 포인트</span>
            <div className={`${styles.balance} num`}>
              {q.data ? fmt(q.data.balance) : "···"}
              <span>P</span>
            </div>
            {q.data?.openedToday && q.data.todayPoints != null && <span className={styles.todayChip}>오늘 +{fmt(q.data.todayPoints)}P 받음</span>}
          </Card>

          <Card title="상자에서 나오는 포인트">
            <div className={styles.odds}>
              <div className={styles.oddBox}>
                <span>일반 상자</span>
                <b className="num">10 ~ 300P</b>
              </div>
              <div className={`${styles.oddBox} ${styles.oddGold}`}>
                <span>황금 상자</span>
                <b className="num">1,000P</b>
              </div>
            </div>
          </Card>

          <Card title="최근 기록" flush>
            {q.data && q.data.recent.length === 0 && <EmptyState>아직 연 상자가 없어요.</EmptyState>}
            <ul className={styles.recent}>
              {q.data?.recent.map((r) => {
                const [, m, d] = r.date.split("-").map(Number);
                const gold = r.points >= 1000;
                return (
                  <li key={r.date}>
                    <span className={`${styles.recentDot} ${gold ? styles.dotGold : ""}`} aria-hidden="true" />
                    <span className={styles.recentDate}>
                      {m}월 {d}일
                    </span>
                    <b className={`num ${gold ? styles.goldText : ""}`}>+{fmt(r.points)}P</b>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PageHead() {
  return (
    <div className={styles.head}>
      <h2 className={styles.title}>무료 뽑기</h2>
      <p className={styles.desc}>하루 한 번, 선물 상자를 공짜로 열 수 있어요. 등급 제한 없어요.</p>
    </div>
  );
}

