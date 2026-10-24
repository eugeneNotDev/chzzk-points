// 유진 키우기 — 로비(이어하기·새로 시작·오늘의 평행세계·도감 입구).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Dice5, RotateCcw, Target, Users, Wallet } from "lucide-react";
import { confirmDialog } from "../../lib/dialog";
import { fmt } from "../../lib/format";
import { fetchRun, lifeErrorText, resetLifeTest, type Lobby, type Run } from "../../lib/life";
import styles from "./Life.module.css";
import { Orbit, Ring, worldLabel } from "./parts";

/* ── 로비 ── */
export function LobbyView({ lobby, onStart, onResume, onReport, onDex }: {
  lobby: Lobby | undefined; onStart: () => void; onResume: (r: Run) => void; onReport: (r: Run) => void; onDex: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!lobby) return <div className={`skeleton ${styles.heroSkel}`} />;
  const left = lobby.isTest ? null : Math.max(0, lobby.dailyLimit - lobby.usedToday);
  const pct = lobby.dex.total ? Math.round((lobby.dex.got / lobby.dex.total) * 100) : 0;

  async function openRun(id: number) {
    setErr(null);
    try {
      onReport(await fetchRun(id));
    } catch (e) {
      setErr(lifeErrorText(e));
    }
  }
  async function reset() {
    if (!(await confirmDialog("테스트로 키운 유진과 테스트 도감을 전부 지울까요? (실제 기록은 그대로예요)"))) return;
    setBusy(true);
    try {
      await resetLifeTest();
      await qc.invalidateQueries({ queryKey: ["life-lobby"] });
      qc.invalidateQueries({ queryKey: ["life-dex"] });
    } catch (e) {
      setErr(lifeErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.lobby}>
      <div className={styles.lobbyMain}>
        <section className={styles.hero}>
          <Orbit className={styles.heroOrbit} />
          <div className={styles.heroNo}>
            <span>다음 평행세계</span>
            <b className="num">{lobby.isTest ? "TEST" : `No.${lobby.nextWorldNo}`}</b>
          </div>
          <p className={styles.heroDesc}>
            {lobby.isTest ? "테스트용" : `${lobby.nextWorldNo}번째`} 유진이 태어날 준비를 하고 있어요.
            <br />
            주사위와 선택으로 유진의 인생을 함께 굴려 주세요.
          </p>
          <div className={styles.heroStats}>
            <div>
              <span>내가 키운 유진</span>
              <b className="num">
                {fmt(lobby.myRuns)}
                <small>명</small>
              </b>
            </div>
            <div>
              <span>오늘 남은 횟수</span>
              <b className="num">{left === null ? "∞" : <>{left}<small> / {lobby.dailyLimit}</small></>}</b>
            </div>
            <div>
              <span>한 판 포인트 구매</span>
              <b className="num">
                {lobby.itemLimit}
                <small>번</small>
              </b>
            </div>
          </div>
          {lobby.playing ? (
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => onResume(lobby.playing!)}>
              {worldLabel(lobby.playing)} 유진 이어서 키우기 · {lobby.playing.age}세
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onStart} disabled={left === 0}>
              {left === 0 ? "오늘은 여기까지" : "새 유진 키우기"}
              {left !== 0 && <ArrowRight size={16} aria-hidden="true" />}
            </button>
          )}
        </section>

        <div className={styles.twoUp}>
          <button type="button" className={styles.tile} onClick={onDex}>
            <Ring pct={pct} />
            <div className={styles.tileText}>
              <b>유진 도감</b>
              <span className="num">
                {lobby.dex.got} / {lobby.dex.total} · {pct}%
              </span>
            </div>
          </button>
          <button type="button" className={styles.tile} onClick={() => lobby.last && openRun(lobby.last.id)} disabled={!lobby.last}>
            <div className={styles.tileText}>
              <span>지난 유진</span>
              <b className={styles.tileTitle}>{lobby.last?.title ?? "아직 없어요"}</b>
            </div>
          </button>
        </div>
        {err && <p className={styles.error}>{err}</p>}
      </div>

      <div className={styles.lobbySide}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h3>오늘의 유진들</h3>
            <span className={styles.muted}>
              오늘 <b className="num">{fmt(lobby.todayCount)}</b>명 탄생
            </span>
          </div>
          {lobby.today.length === 0 && <p className={styles.empty}>오늘 생을 마친 유진이 아직 없어요.</p>}
          <ul className={styles.todayList}>
            {lobby.today.map((t) => (
              <li key={t.id}>
                <span className={`num ${styles.todayNo}`}>{t.worldNo ?? "T"}</span>
                <div>
                  <b>{t.title}</b>
                  <span>
                    {t.channelName ?? "익명의 보호자"} · {t.age}세
                  </span>
                </div>
                {t.special && <span className={styles.chipGold}>특수 엔딩</span>}
              </li>
            ))}
          </ul>
        </section>
        <section className={`${styles.card} ${styles.howTo}`}>
          <h3 className={styles.cardTitle}>이렇게 굴러가요</h3>
          <ul>
            <li>
              <Target size={15} aria-hidden="true" />
              <span>
                <b>올해의 초점</b>을 언제든 바꿀 수 있어요. 다음 해부터 반영돼요.
              </span>
            </li>
            <li>
              <Dice5 size={15} aria-hidden="true" />
              <span>
                중요한 선택은 <b>주사위 두 개 + 능력치 보정</b>으로 대성공~대실패가 갈려요.
              </span>
            </li>
            <li>
              <Wallet size={15} aria-hidden="true" />
              <span>
                15세부터 유진의 돈으로 <b>돈쓰기</b>를 할 수 있어요. 포인트로도 사줄 수 있어요(1만원 = 1P).
              </span>
            </li>
            <li>
              <Users size={15} aria-hidden="true" />
              <span>
                가족·친구·연인과의 <b>사이</b>가 인생을 바꿔요.
              </span>
            </li>
          </ul>
        </section>
        {lobby.isTest && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={busy}>
            <RotateCcw size={14} aria-hidden="true" />
            테스트 기록 초기화
          </button>
        )}
      </div>
    </div>
  );
}
