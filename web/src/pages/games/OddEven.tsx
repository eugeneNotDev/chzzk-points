// 홀짝 — 홀이나 짝을 고르면 카드(A~10) 한 장이 섞였다가 뒤집힘. 카드와 결과는 서버(odd_even_play)가 정함.
// 카드 무늬(♠♥♦♣)는 보기용으로 화면에서 아무거나 고름(결과와 상관없음). 맞히면 1.9배, 틀리면 0.
import { useEffect, useState } from "react";
import { Card } from "../../components/Card";
import { LoginNeeded, PageHead } from "../../components/ui";
import { apiFetch } from "../../lib/auth";
import { API } from "../../lib/config";
import { fmt } from "../../lib/format";
import { BetPanel, GameLock, GameResult, netTone, RecentList, signed, type ResultView } from "./GameParts";
import { SUIT_ICONS } from "./suitIcons";
import { AFTER_RESULT_WAIT_MS, REDUCED_MOTION, sleep, useMinigame, type GameStateBase } from "./useMinigame";
import styles from "./Games.module.css";

type Pick = "odd" | "even";
type OeState = GameStateBase & { winMultiplier: number; recent: { bet: number; pick: Pick; card: number; result: "win" | "lose"; payout: number; createdAt: string }[] };

const PICK_KO: Record<Pick, string> = { odd: "홀", even: "짝" };
const RESULT_KO = { win: "맞힘", lose: "틀림" };
const RESULT_COLOR = { win: "#2fb574", lose: "#e03141" };
const SUITS: [string, boolean][] = [["spade", false], ["heart", true], ["diamond", true], ["club", false]];
const SHUFFLE_MIN_MS = REDUCED_MOTION ? 250 : 950;
const FLIP_MS = REDUCED_MOTION ? 50 : 720;
const SERVER_COOLDOWN_MS = 3000;
const cardLabel = (n: number) => (n === 1 ? "A" : String(n));
const parityOf = (n: number): Pick => (n % 2 === 1 ? "odd" : "even");

function Suit({ suit }: { suit: string }) {
  const i = SUIT_ICONS[suit];
  return <svg viewBox={i.viewBox} aria-hidden="true" dangerouslySetInnerHTML={{ __html: i.inner }} />;
}

export default function OddEven() {
  const game = useMinigame<OeState>(API.oddEven, "홀짝");
  const [card, setCard] = useState<{ n: number; suit: string; red: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  const [chosen, setChosen] = useState<Pick | null>(null);
  const [reveal, setReveal] = useState<Pick | null>(null);
  const [result, setResult] = useState<ResultView | null>(null);
  useEffect(() => {
    if (game.error) setResult({ tone: "error", title: game.error });
  }, [game.error]);

  async function play(pick: Pick) {
    if (!game.canPlay) return;
    const bet = game.bet;
    game.setPlaying(true);
    game.setError(null);
    setResult(null);
    setReveal(null);
    setChosen(pick);
    if (open) {
      setOpen(false);
      await sleep(REDUCED_MOTION ? 30 : 260);
    }
    setShuffling(true);
    const started = Date.now();
    try {
      const d = await apiFetch<{ card: number; result: "win" | "lose"; payout: number; net: number; balance: number; note?: string }>(API.oddEven, { body: { bet, pick } });
      const remain = SHUFFLE_MIN_MS - (Date.now() - started);
      if (remain > 0) await sleep(remain);
      if (!game.alive.current) return;
      setShuffling(false);
      const [suit, red] = SUITS[Math.floor(Math.random() * SUITS.length)];
      setCard({ n: d.card, suit, red });
      setOpen(true);
      await sleep(FLIP_MS);
      if (!game.alive.current) return;
      setReveal(parityOf(d.card));
      game.applyResult(d.balance, { bet, pick, card: d.card, result: d.result, payout: d.payout, createdAt: new Date().toISOString() });
      setResult({
        tone: netTone(d.net),
        color: RESULT_COLOR[d.result],
        title: `${RESULT_KO[d.result]} · ${signed(d.net)}`,
        desc: `${PICK_KO[pick]} 선택 · 카드 ${cardLabel(d.card)} · ${fmt(bet)}P 걸어서 ${fmt(d.payout)}P 받았어요`,
        note: d.note ?? null,
      });
      game.startWait(Math.max(AFTER_RESULT_WAIT_MS, SERVER_COOLDOWN_MS + 300 - (Date.now() - started)));
      setTimeout(() => game.alive.current && setChosen(null), Math.max(AFTER_RESULT_WAIT_MS, SERVER_COOLDOWN_MS + 300 - (Date.now() - started)) + 30);
    } catch (e) {
      const remain = SHUFFLE_MIN_MS - (Date.now() - started);
      if (remain > 0) await sleep(remain);
      setShuffling(false);
      setChosen(null);
      game.handleError(e);
    } finally {
      if (game.alive.current) game.setPlaying(false);
    }
  }

  if (!game.isLoggedIn) {
    return (
      <div className="page">
        <PageHead title="홀짝" desc="카드 한 장이 홀일지 짝일지 맞혀보세요." />
        <Card>
          <LoginNeeded>로그인하면 홀짝을 할 수 있어요.</LoginNeeded>
        </Card>
      </div>
    );
  }

  const mult = game.state?.winMultiplier ?? 1.9;
  return (
    <div className="page">
      <PageHead title="홀짝" desc={`카드(A~10) 한 장이 홀일지 짝일지 맞혀보세요. 맞히면 ${mult}배, 틀리면 0`} />
      <GameLock state={game.state} />
      <div className={styles.gameLayout}>
        <section className={styles.stageCard}>
          <div className={styles.oeStage}>
            <div className={`${styles.deck} ${shuffling ? styles.shuffling : ""}`}>
              <div className={`${styles.ghost} ${styles.ghostL}`} />
              <div className={`${styles.ghost} ${styles.ghostR}`} />
              <div className={`${styles.flip} ${open ? styles.flipOpen : ""}`}>
                <div className={`${styles.face} ${styles.back}`}>
                  <b>?</b>
                </div>
                <div className={`${styles.face} ${styles.front} ${card?.red ? styles.red : ""}`}>
                  {card && (
                    <>
                      <span className={`${styles.corner} ${styles.tl}`}>
                        {cardLabel(card.n)}
                        <Suit suit={card.suit} />
                      </span>
                      <span className={`${styles.cardNum} num`}>{cardLabel(card.n)}</span>
                      <span className={styles.bigSuit}>
                        <Suit suit={card.suit} />
                      </span>
                      <span className={`${styles.corner} ${styles.br}`}>
                        {cardLabel(card.n)}
                        <Suit suit={card.suit} />
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <p className={styles.reveal}>
              {reveal && card && (
                <>
                  {cardLabel(card.n)} → <b className={reveal === "odd" ? styles.oddText : styles.evenText}>{PICK_KO[reveal]}</b>
                </>
              )}
            </p>
          </div>
          <BetPanel game={game}>
            <div className={styles.oePicks} role="group" aria-label="홀 또는 짝">
              {(["odd", "even"] as Pick[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`${styles.oePick} ${p === "odd" ? styles.odd : styles.even} ${chosen === p ? styles.chosen : ""}`}
                  disabled={!game.canPlay}
                  onClick={() => play(p)}
                >
                  {chosen === p && <span className={styles.mine}>내 선택</span>}
                  {PICK_KO[p]}
                </button>
              ))}
            </div>
            <GameResult result={result} />
          </BetPanel>
        </section>
        <div className={styles.side}>
          <RecentList
            items={game.state?.recent}
            empty="아직 한 판도 안 했어요."
            render={(r) => ({
              tag: RESULT_KO[r.result] || "-",
              color: RESULT_COLOR[r.result] || "#6b7480",
              detail: `${fmt(r.bet)}P · ${PICK_KO[r.pick] || "-"} 선택 · 카드 ${cardLabel(r.card)}(${PICK_KO[parityOf(r.card)]})`,
              net: r.payout - r.bet,
              createdAt: r.createdAt,
            })}
          />
        </div>
      </div>
    </div>
  );
}
