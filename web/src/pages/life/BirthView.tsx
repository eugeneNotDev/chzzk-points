// 유진 키우기 — 태어날 집 고르기(포인트로 시작).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fmt } from "../../lib/format";
import { lifeErrorText, startLife, statChips, won, type Lobby, type Run } from "../../lib/life";
import styles from "./Life.module.css";
import { TopBar } from "./parts";

/* ── 태어날 집 고르기 ── */
export function BirthView({ lobby, onBack, onStarted }: { lobby: Lobby; onBack: () => void; onStarted: (r: Run) => void }) {
  const qc = useQueryClient();
  const [pick, setPick] = useState(lobby.houses[0]?.id ?? "poor");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const house = lobby.houses.find((h) => h.id === pick);
  const cost = lobby.isTest ? 0 : (house?.price ?? 0);
  const after = lobby.balance - cost;
  const short = cost > 0 && after < 0;

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const res = await startLife(pick);
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["life-lobby"] });
      onStarted(res.run);
    } catch (e) {
      setErr(lifeErrorText(e));
      setBusy(false);
    }
  }

  return (
    <div className={styles.birth}>
      <div className={styles.birthMain}>
        <TopBar title="태어날 집 고르기" onBack={onBack} />
        <div className={styles.intro}>
          <h3>유진이 어떤 집에서 태어날까요?</h3>
          <p>집에 따라 용돈·등록금 지원·물려받을 재산이 달라져요. 어느 집에서든 모든 결말이 나올 수 있어요.</p>
        </div>
        <div className={styles.houseList} role="radiogroup" aria-label="태어날 집">
          {lobby.houses.map((h, i) => {
            const sel = h.id === pick;
            const chips = statChips(h.bonus);
            return (
              <button key={h.id} type="button" role="radio" aria-checked={sel} className={`${styles.house} ${sel ? styles.houseSel : ""}`} onClick={() => setPick(h.id)}>
                <span className={styles.houseTop}>
                  <span className={styles.houseIcon} aria-hidden="true">
                    <HouseIcon tier={i} />
                  </span>
                  <b>{h.name}</b>
                  <span className={`num ${styles.housePrice} ${i === lobby.houses.length - 1 ? styles.gold : ""}`}>{h.price ? `${fmt(h.price)} P` : "무료"}</span>
                </span>
                <span className={styles.houseFacts}>
                  <span>
                    용돈 <b className="num">연 {won(h.allowance)}</b>
                  </span>
                  <span>
                    등록금 지원 <b className="num">{Math.round(h.tuition * 100)}%</b>
                  </span>
                  <span>
                    물려받을 재산 <b className="num">{h.inherit ? `약 ${won(h.inherit, true)}` : "거의 없음"}</b>
                  </span>
                </span>
                <span className={styles.chips}>
                  {chips.length === 0 && <span className={styles.chip}>능력치 보정 없음</span>}
                  {chips.map((c) => (
                    <span key={c.label} className={`${styles.chip} ${c.up ? styles.chipUp : styles.chipDown}`}>
                      {c.label}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <section className={styles.receipt}>
        <h3 className={styles.cardTitle}>영수증</h3>
        <div className={styles.rRow}>
          <span>보유 포인트</span>
          <span className="num">{fmt(lobby.balance)} P</span>
        </div>
        <div className={styles.rRow}>
          <span>{house?.name}</span>
          <span className={`num ${cost ? styles.minus : ""}`}>{cost ? `− ${fmt(cost)} P` : lobby.isTest ? "테스트 · 0 P" : "0 P"}</span>
        </div>
        <div className={styles.rLine} />
        <div className={`${styles.rRow} ${styles.rTotal}`}>
          <span>사용 후 잔액</span>
          <span className="num">{fmt(after)} P</span>
        </div>
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={start} disabled={busy || short}>
          {short ? "포인트가 부족해요" : busy ? "태어나는 중…" : "유진 태어나게 하기"}
        </button>
        {err && <p className={styles.error}>{err}</p>}
        <p className={styles.fine}>쓴 포인트는 돌려받지 않아요</p>
      </section>
    </div>
  );
}

function HouseIcon({ tier }: { tier: number }) {
  const d = [
    "M4 20V8h16v12M4 8l2-4h12l2 4M9 20v-6h6v6",
    "M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5",
    "M3 11l9-8 9 8M5 9v11h14V9M9 20v-6h6v6M15 7V4h2v5",
    "M5 21V5l7-2 7 2v16M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1M3 21h18",
  ][Math.min(tier, 3)];
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
