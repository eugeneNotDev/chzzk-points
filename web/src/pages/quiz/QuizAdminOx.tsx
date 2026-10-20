// 퀴즈 관리자 — OX(리모컨, 방송 화면)
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crown, MonitorPlay, Trash2, Users } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { confirmDialog } from "../../lib/dialog";
import { oxPhase } from "../../lib/quiz";
import { leftText } from "./Exam";
import { OIcon, XIcon } from "./Ox";
import { useNow } from "./useNow";
import { adminCall, useAct, useQuizAdminLive, useStreamTitle, type Detail } from "./quizAdminShared";
import styles from "./Quiz.module.css";

// ── OX ──
export function OxAdmin({ d }: { d: Detail }) {
  const { act, busy } = useAct();
  const now = useNow(250);
  const quiz = d.quiz;
  const ox = d.ox!;
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState<"" | "O" | "X">("");
  const [seconds, setSeconds] = useState(10);
  const cur = ox.current;
  const pendingCur = !!cur && !cur.revealed;
  const ph = cur ? oxPhase(cur.askedAt, cur.closesAt, cur.revealed, now) : null;
  const curOpen = pendingCur && !!ph && ph.phase !== "closed";
  const answered = cur ? cur.counts.O + cur.counts.X : 0;
  const alive = ox.players.filter((p) => p.alive).length;
  const deathmatch = quiz.ox_mode === "deathmatch";
  const isOpen = quiz.status === "open";
  const next = ox.queue[0];
  const canAsk = isOpen && !pendingCur;

  async function ask(questionId?: number) {
    const body: Record<string, unknown> = { action: "ox-ask", quizId: quiz.id, seconds };
    if (questionId) body.questionId = questionId;
    else Object.assign(body, { prompt, answer });
    if (await act(body)) {
      if (!questionId) {
        setPrompt("");
        setAnswer("");
      }
    }
  }
  async function addQueue() {
    if (await act({ action: "ox-add", quizId: quiz.id, prompt, answer }, "대기열에 넣었어요.")) {
      setPrompt("");
      setAnswer("");
    }
  }

  return (
    <>
      <Card
        className={styles.admin}
        title="OX 리모컨"
        extra={
          <div className={`${styles.actions} ${styles.mlAuto}`}>
            <span className={`tag ${deathmatch ? "tag-live" : "tag-blue"}`}>{deathmatch ? "데스매치" : "점수전"}</span>
            <button
              type="button"
              className="btn btn-sm"
              title="정답·대기열 없이 문제와 결과만 크게 보여주는 창이에요. 이 창을 방송에 띄우고, 리모컨은 내 화면에만 두세요."
              onClick={() => window.open(`${location.pathname}?stream=${quiz.id}`, `quiz-stream-${quiz.id}`, "width=1280,height=720")}
            >
              <MonitorPlay size={16} aria-hidden="true" /> 방송 화면 열기
            </button>
          </div>
        }
      >
        <p className={`muted ${styles.m_0_0_14} ${styles.fs12}`}>
          이 리모컨엔 미리 정한 정답과 대기열이 보여요. 방송엔 "방송 화면 열기"로 뜨는 창을 띄워 주세요.
        </p>
        {quiz.status === "draft" && (
          <div className={`${styles.actions} ${styles.mb16}`}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act({ action: "open", quizId: quiz.id }, "OX 퀴즈를 열었어요. 시청자 메뉴에 떠요.")}>
              진행 시작
            </button>
            <span className="muted">대기열에 문제를 미리 넣어두고, 시작한 뒤 하나씩 내요.</span>
          </div>
        )}
        {quiz.status === "revealed" && <p className="muted">종료된 OX 퀴즈예요. 아래에서 보상을 지급하세요.</p>}

        {quiz.status !== "revealed" && (
          <div className={styles.remote}>
            <div className={styles.panel}>
              <div className={styles.tags}>
                <span className={styles.panelLabel}>지금 문제</span>
                {cur && <span className="tag num">{cur.number}번째 · {cur.revealed ? "정답 공개됨" : curOpen ? "응답 받는 중" : "마감"}</span>}
                {curOpen && ph && (
                  <b className="num" style={{ marginLeft: "auto", color: ph.phase === "ready" ? "var(--c-text-2)" : "var(--c-live-text)", fontSize: ph.phase === "ready" ? 15 : 22 }}>
                    {ph.phase === "ready" ? "곧 시작" : leftText(ph.left)}
                  </b>
                )}
              </div>
              {cur ? (
                <>
                  <h3 className={`${styles.oxPrompt} ${styles.fs22}`}>
                    {cur.prompt.replace(/__/g, "")}
                  </h3>
                  <div className={styles.rows}>
                    <div className={styles.row}>
                      <b className={styles.cBlue}>O · {cur.counts.O}명</b>
                      <span>
                        응답 {answered}명{deathmatch && ox.started ? ` / 생존 ${alive}명` : ""}
                      </span>
                      <b className={styles.cAmber}>X · {cur.counts.X}명</b>
                    </div>
                    <div className={styles.split2}>
                      <i style={{ width: answered ? `${(cur.counts.O / answered) * 100}%` : "0%" }} />
                      <i style={{ width: answered ? `${(cur.counts.X / answered) * 100}%` : "0%" }} />
                    </div>
                  </div>
                  {pendingCur && (
                    <div className={styles.actions}>
                      {curOpen && (
                        <button type="button" className="btn" disabled={busy} onClick={() => act({ action: "ox-close", questionId: cur.id })}>
                          지금 마감
                        </button>
                      )}
                      <button type="button" className="btn" style={{ color: "var(--c-blue)" }} disabled={busy} onClick={() => act({ action: "ox-reveal", questionId: cur.id, answer: "O" })}>
                        정답 O 공개{cur.answer === "O" ? " ★" : ""}
                      </button>
                      <button type="button" className="btn" style={{ color: "var(--c-amber)" }} disabled={busy} onClick={() => act({ action: "ox-reveal", questionId: cur.id, answer: "X" })}>
                        정답 X 공개{cur.answer === "X" ? " ★" : ""}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={async () => {
                          if (await confirmDialog("이 문제를 취소할까요? 받은 응답은 지워지고 대기열로 돌아가요.", { danger: true, okText: "문제 취소" })) act({ action: "ox-cancel", questionId: cur.id }, "취소했어요.");
                        }}
                      >
                        문제 취소
                      </button>
                    </div>
                  )}
                  {pendingCur && (cur.answer === "O" || cur.answer === "X") && <span className={`muted ${styles.fs12}`}>★ 미리 정해둔 정답</span>}
                </>
              ) : (
                <p className={`muted ${styles.m0}`}>
                  {isOpen ? "아직 낸 문제가 없어요. 오른쪽에서 첫 문제를 내요." : "진행을 시작하면 여기서 문제를 내요."}
                </p>
              )}
            </div>

            <div className={styles.panel}>
              <span className={styles.panelLabel}>다음 문제</span>
              {next ? (
                <b className={`${styles.fs16} ${styles.lh1_5}`}>
                  {next.prompt} <span className={`muted ${styles.fs12} ${styles.fw500}`}>정답 {next.answer || "나중에"}</span>
                </b>
              ) : (
                <span className="muted">대기열이 비었어요. 아래에서 바로 내거나 넣어두세요.</span>
              )}
              <div className={styles.actions}>
                <span className={`muted ${styles.fs13}`}>제한시간</span>
                <div className="segment" role="tablist" aria-label="제한시간">
                  {[5, 10, 20, 30, 60].map((s) => (
                    <button key={s} type="button" role="tab" aria-selected={seconds === s} onClick={() => setSeconds(s)}>
                      {s === 60 ? "1분" : `${s}초`}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" className="btn btn-primary btn-lg" disabled={busy || !next || !canAsk} onClick={() => next && ask(next.id)}>
                다음 문제 출제
              </button>
              {isOpen && pendingCur && <span className={`muted ${styles.fs12}`}>지금 문제의 정답을 공개해야 다음 문제를 낼 수 있어요.</span>}
              {!isOpen && <span className={`muted ${styles.fs12}`}>진행 시작을 눌러야 출제할 수 있어요.</span>}
              <span className={`muted ${styles.fs12}`}>방송 딜레이를 감안해 마감은 3초 늦게 돼요.</span>
            </div>
          </div>
        )}

        {quiz.status !== "revealed" && (
          <div className={`${styles.form} ${styles.mt16}`}>
            <div className={styles.actions}>
              <input
                className={`input ${styles.flex_1_1_320} ${styles.minW0}`}
                maxLength={200}
                aria-label="새 문제"
                placeholder="새 문제 적기 — 엔터를 누르면 바로 출제"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && prompt.trim() && canAsk) ask();
                }}
              />
              <div className="segment" role="tablist" aria-label="정답 미리 정하기">
                {(["", "O", "X"] as const).map((a) => (
                  <button key={a || "none"} type="button" role="tab" aria-selected={answer === a} onClick={() => setAnswer(a)}>
                    {a ? `정답 ${a}` : "정답 나중에"}
                  </button>
                ))}
              </div>
              <button type="button" className="btn" disabled={busy || !prompt.trim() || !canAsk} onClick={() => ask()}>
                바로 출제
              </button>
              <button type="button" className="btn" disabled={busy || !prompt.trim()} onClick={addQueue}>
                대기열에 추가
              </button>
            </div>
          </div>
        )}
      </Card>

      <div className={styles.twoCol}>
        {quiz.status !== "revealed" && (
          <Card className={styles.admin} title={`대기열 ${ox.queue.length}`}>
            {ox.queue.length === 0 ? (
              <EmptyState>미리 넣어둔 문제가 없어요.</EmptyState>
            ) : (
              <div>
                {ox.queue.map((q, i) => (
                  <div key={q.id} className={`${styles.queueRow} ${i === 0 ? styles.queueNext : ""}`}>
                    <span className={`muted num ${styles.w18}`}>
                      {i + 1}
                    </span>
                    <b>{q.prompt}</b>
                    <span className={`muted ${styles.fs12} ${styles.flexNone}`}>
                      {q.answer ? `정답 ${q.answer}` : "정답 나중에"}
                    </span>
                    <button type="button" className="btn btn-sm" disabled={busy || !canAsk} onClick={() => ask(q.id)}>
                      출제
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" aria-label="대기열에서 삭제" disabled={busy} onClick={() => act({ action: "delete-question", questionId: q.id })}>
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        <Card
          className={styles.admin}
          title={deathmatch ? "생존자" : "순위"}
          extra={
            <span className={`muted num ${styles.mlAuto}`}>
              {deathmatch && ox.started ? `${alive} / ${ox.players.length}명` : `${ox.players.length}명`}
            </span>
          }
        >
          {ox.players.length === 0 ? (
            <EmptyState>아직 응답한 사람이 없어요.</EmptyState>
          ) : (
            <div className={styles.players}>
              {ox.players.map((p, i) => (
                <div key={i} className={`${styles.player} ${deathmatch && ox.started && !p.alive ? styles.dead : ""}`}>
                  <span className={styles.dot} />
                  <span className={`${styles.flex1} ${styles.minW0}`}>{p.name}</span>
                  <span className={`muted num ${styles.fs12}`}>
                    {deathmatch && ox.started && !p.alive ? (p.outAt ? `Q${p.outAt} 탈락` : "미참여") : `${p.correct}개`}
                    {pendingCur && p.answeredCurrent ? ` · ${p.answeredCurrent}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
          {isOpen && (
            <div className={`${styles.actions} ${styles.mt12}`}>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={async () => {
                  if (await confirmDialog(`OX 퀴즈를 종료할까요? ${deathmatch ? `지금 생존자 ${ox.started ? alive : 0}명` : "지금 순위"}로 결과가 확정돼요.`, { okText: "종료" })) act({ action: "reveal", quizId: quiz.id }, "종료했어요.");
                }}
              >
                종료하고 결과 확정
              </button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

// ── 방송 화면(OX) — 방송에 띄우는 창. 정답은 공개한 뒤에만, 대기열·미리 정한 정답은 절대 안 보임 ──
const RING_R = 54;
const RING_C = 2 * Math.PI * RING_R;

export function OxStream({ quizId }: { quizId: number }) {
  useStreamTitle("OX 퀴즈 방송화면 · 유진 팬보드");
  const now = useNow(100);
  const q = useQuery({ queryKey: ["quiz-admin", quizId], refetchInterval: 10_000, queryFn: () => adminCall<Detail>({ action: "get", quizId }) });
  useQuizAdminLive(quizId, 400);
  const d = q.data;
  const ox = d?.ox;
  const cur = ox?.current ?? null;
  const ph = cur ? oxPhase(cur.askedAt, cur.closesAt, cur.revealed, now) : null;
  const open = !!ph && ph.phase !== "closed";
  const closed = !!cur && !open;
  const deathmatch = d?.quiz.ox_mode === "deathmatch";
  const players = ox?.players ?? [];
  const alive = players.filter((p) => p.alive);
  const total = cur ? cur.counts.O + cur.counts.X : 0;
  const ended = d?.quiz.status === "revealed";
  const urgent = ph?.phase === "counting" && ph.left < 3000;
  const frac = ph ? Math.max(0, Math.min(1, ph.left / ph.total)) : 0;


  if (!d) {
    return (
      <div className={`${styles.stream} ${styles.oxStream}`}>
        <span className={styles.streamHint}>불러오는 중…</span>
      </div>
    );
  }

  return (
    <div className={`${styles.stream} ${styles.oxStream}`}>
      <div className={styles.streamTop}>
        <span className={styles.streamBrand}>OX 퀴즈</span>
        <span className={`${styles.streamTag} ${deathmatch ? styles.streamTagHot : ""}`}>{deathmatch ? "데스매치" : "점수전"}</span>
        <span className={styles.streamCount}>
          <Users size={22} aria-hidden="true" />
          {deathmatch && ox?.started ? (
            <>
              생존 <b className="num">{alive.length}</b>
              <span className={styles.streamCountSub}>/ {players.length}</span>
            </>
          ) : (
            <>
              참여 <b className="num">{players.length}</b>
            </>
          )}
        </span>
      </div>

      {ended ? (
        <div className={styles.streamMain}>
          <Crown className={styles.streamCrown} aria-hidden="true" />
          <b className={styles.streamPrompt}>{deathmatch ? "최후의 생존자" : "OX 퀴즈 끝!"}</b>
          <div className={styles.streamNames}>
            {(deathmatch ? alive : [...players].sort((a, b) => b.correct - a.correct).slice(0, 10)).map((p, i) => (
              <span key={i} className={`${styles.streamName} ${styles.streamNameBig}`}>
                {!deathmatch && <b className="num">{i + 1}</b>}
                {p.name}
                {!deathmatch && <small className="num">{p.correct}개</small>}
              </span>
            ))}
            {deathmatch && alive.length === 0 && <span className={styles.streamHint}>살아남은 사람이 없어요</span>}
          </div>
        </div>
      ) : !cur ? (
        <div className={styles.streamMain}>
          <span className={styles.streamPulse} aria-hidden="true" />
          <b className={styles.streamPrompt}>곧 첫 문제가 나와요</b>
          <span className={styles.streamHint}>팬보드 → 퀴즈 메뉴에서 O / X를 골라주세요</span>
        </div>
      ) : (
        <div className={styles.streamMain}>
          <div className={styles.streamQ}>
            <span className={styles.streamQNo}>
              Q<b className="num">{cur.number}</b>
            </span>
            <b className={styles.streamPrompt}>{cur.prompt.replace(/__/g, "")}</b>
          </div>

          <div className={styles.streamState}>
            {ph?.phase === "ready" ? (
              <span className={styles.streamReady}>곧 카운트다운이 시작됩니다</span>
            ) : ph?.phase === "counting" ? (
              <div className={`${styles.streamRing} ${urgent ? styles.streamRingUrgent : ""}`}>
                <svg viewBox="0 0 120 120" aria-hidden="true">
                  <circle cx="60" cy="60" r={RING_R} className={styles.streamRingBg} />
                  <circle cx="60" cy="60" r={RING_R} className={styles.streamRingFg} strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - frac)} />
                </svg>
                <b className="num">{Math.ceil(ph.left / 1000)}</b>
              </div>
            ) : (
              <span className={`${styles.streamReady} ${cur.revealed ? styles.streamReveal : ""}`}>{cur.revealed ? `정답은 ${cur.answer}!` : "마감! 정답은…?"}</span>
            )}
          </div>

          <div className={styles.streamOX}>
            {(["O", "X"] as const).map((c) => {
              const win = cur.revealed && cur.answer === c;
              const lose = cur.revealed && cur.answer !== c;
              const share = closed && total > 0 ? cur.counts[c] / total : 0;
              return (
                <div key={c} className={`${styles.streamCard} ${c === "O" ? styles.streamO : styles.streamX} ${win ? styles.streamWin : ""} ${lose ? styles.streamLose : ""}`}>
                  <i className={styles.streamFill} style={{ height: `${share * 100}%` }} aria-hidden="true" />
                  {c === "O" ? <OIcon /> : <XIcon />}
                  <b className="num">{closed ? `${cur.counts[c]}명` : "?"}</b>
                  <span className="num">{closed && total > 0 ? `${Math.round(share * 100)}%` : c === "O" ? "맞다" : "아니다"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
