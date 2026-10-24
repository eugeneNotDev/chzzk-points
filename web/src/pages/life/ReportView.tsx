// 유진 키우기 — 인생 리포트(엔딩·그래프·결정적 순간·공유 이미지).
import { useState } from "react";
import { BookOpen, Download } from "lucide-react";
import { fmt } from "../../lib/format";
import { josa, won, type Run } from "../../lib/life";
import styles from "./Life.module.css";
import { shareOrSave } from "./shareCard";
import { PeopleCard } from "./PlayCards";
import { Orbit, StatGrid, TopBar, worldLabel } from "./parts";
import { RollChip } from "./playParts";

/* ── 인생 리포트 ── */
function LifeGraph({ rows }: { rows: number[][] }) {
  if (rows.length < 2) return null;
  const W = 320;
  const H = 120;
  const maxAge = Math.max(1, rows[rows.length - 1][0]);
  const nets = rows.map((r) => r[6] ?? 0);
  const nMin = Math.min(0, ...nets);
  const nMax = Math.max(1, ...nets);
  const x = (a: number) => ((a / maxAge) * W).toFixed(1);
  const lines = [
    { label: "행복", color: "var(--c-amber)", pts: rows.map((r) => `${x(r[0])},${(H - (r[4] / 100) * H).toFixed(1)}`) },
    { label: "건강", color: "var(--c-accent)", pts: rows.map((r) => `${x(r[0])},${(H - (r[1] / 100) * H).toFixed(1)}`) },
    { label: "순자산", color: "var(--c-gold)", pts: rows.map((r) => `${x(r[0])},${(H - (((r[6] ?? 0) - nMin) / (nMax - nMin)) * H).toFixed(1)}`) },
  ];
  const ticks = [0, Math.round(maxAge / 4), Math.round(maxAge / 2), Math.round((maxAge * 3) / 4), maxAge];
  return (
    <section className={styles.card}>
      <div className={styles.graphHead}>
        <h3 className={styles.cardTitle}>인생 그래프</h3>
        {lines.map((l) => (
          <span key={l.label} className={styles.legend}>
            <i style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
      <svg className={styles.graph} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="나이에 따른 행복, 건강, 순자산 변화">
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} className={styles.gridLine} />
        {lines.map((l) => (
          <polyline key={l.label} points={l.pts.join(" ")} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className={styles.graphAxis}>
        {ticks.map((t, i) => (
          <span key={i} className="num">
            {t}세
          </span>
        ))}
      </div>
    </section>
  );
}

export function ReportView({ run, onAgain, onDex }: { run: Run; onAgain: () => void; onDex: () => void }) {
  const [saving, setSaving] = useState(false);
  const e = run.ending;
  if (!e) return <p className={styles.center}>아직 끝나지 않은 인생이에요.</p>;
  const special = !!e.specialId;
  // 결정적 순간: 너무 많으면 어릴 때 몇 개 + 나이 들어서 몇 개, 마지막엔 떠나는 장면(사인)까지
  const hls = run.log.filter((x) => x.hl && x.k !== "end");
  const death = run.log.find((x) => x.k === "end");
  const moments = [...(hls.length > 13 ? [...hls.slice(0, 5), ...hls.slice(-8)] : hls), ...(death ? [death] : [])];
  const family = run.people.filter((p) => p.role !== "mom" && p.role !== "dad");
  return (
    <div className={styles.report}>
      <div className={styles.reportMain}>
        <TopBar title="인생 리포트" right={<span className={`num ${styles.muted}`}>{worldLabel(run)}</span>} />
        <section className={`${styles.endCard} ${special ? styles.endSpecial : ""}`}>
          <Orbit className={styles.endOrbit} />
          <span className={styles.endPre}>
            {e.age}세, {e.cause === "old" ? "편안히" : josa(e.causeText, "로")} 생을 마친 유진은
          </span>
          {special && <span className={styles.chipGold}>특수 엔딩</span>}
          {!special && e.mod && e.modId !== "ordinary" && <span className={styles.endMod}>{e.mod}</span>}
          <b className={styles.endTitle}>{special ? e.title : `${e.job} 유진`}</b>
          {special && <span className={styles.endFinale}>{e.specialText}</span>}
          <span className={styles.endFinale}>장례식에 {fmt(e.mourners)}명이 찾아왔어요.</span>
        </section>

        <div className={styles.quad}>
          <div>
            <span>수명</span>
            <b className="num">
              {e.age}
              <small>세</small>
            </b>
          </div>
          <div>
            <span>남긴 재산</span>
            <b className={`num ${e.netWorth < 0 ? styles.down : ""}`}>{won(e.netWorth, true)}</b>
          </div>
          <div>
            <span>평생 번 돈</span>
            <b className="num">{won(e.earned, true)}</b>
          </div>
          <div>
            <span>태어난 집</span>
            <b>{run.houseName}</b>
          </div>
        </div>

        <LifeGraph rows={run.hist ?? []} />

        {moments.length > 0 && (
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>결정적 순간</h3>
            <ul className={styles.moments}>
              {moments.map((m, i) => (
                <li key={i}>
                  <span className="num">{m.age}세</span>
                  <div>
                    <p>{m.t}</p>
                    {m.roll && <RollChip r={m.roll} />}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className={styles.reportSide}>
        {run.jobs.length > 0 && (
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>직업 이력</h3>
            <ol className={styles.jobLine}>
              {run.jobs.map((j, i) => (
                <li key={`${j.id}-${i}`} className={i === run.jobs.length - 1 ? styles.jobNow : ""}>
                  <span className={styles.jobDot} aria-hidden="true" />
                  <b>{j.name}</b>
                  <span className="num">{j.age}세</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {family.length > 0 && <PeopleCard people={family} />}
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>마지막 능력치</h3>
          <StatGrid stats={run.stats} />
        </section>
        {run.thoughts.length > 0 && (
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>유진이 남긴 생각</h3>
            <ul className={styles.moments}>
              {run.thoughts.map((t, i) => (
                <li key={i}>
                  <span className="num">{t.age}세</span>
                  <div>
                    <span className={styles.thoughtQ}>{t.q}</span>
                    <p>“{t.a}”</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className={styles.letter}>
          <span className={styles.letterAvatar} aria-hidden="true">
            유
          </span>
          <div>
            <span>유진이 보호자님께</span>
            <p>{letterLine(run)}</p>
          </div>
        </div>
        <button
          type="button"
          className={`btn btn-lg btn-block ${styles.shareBtn}`}
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await shareOrSave(run);
            } finally {
              setSaving(false);
            }
          }}
        >
          <Download size={16} aria-hidden="true" />
          {saving ? "이미지 만드는 중…" : "엔딩 카드 이미지로 저장"}
        </button>
        <div className={styles.endBtns}>
          <button type="button" className="btn btn-lg" onClick={onDex}>
            <BookOpen size={16} aria-hidden="true" />
            도감 보기
          </button>
          <button type="button" className="btn btn-primary btn-lg" onClick={onAgain}>
            다시 키우기
          </button>
        </div>
      </div>
    </div>
  );
}

function letterLine(run: Run) {
  const s = run.stats;
  if (run.ending?.cause === "accident") return "너무 일찍 떠나서 미안해요. 그래도 보호자님 덕분에 행복했어요.";
  if (s.happy >= 75) return "보호자님 덕분에 정말 행복한 인생이었어요. 다음 평행세계에서도 잘 부탁해요.";
  if (s.happy <= 35) return "쉽지 않은 인생이었지만, 끝까지 곁에 있어줘서 고마워요.";
  return "보호자님 덕분에 꽤 괜찮은 인생이었어요. 다음 평행세계에서도 잘 부탁해요.";
}
