// 유진 키우기 진행 화면의 옆 칸 카드들 — 방송 이력·기록·돈·사람·쇼핑.
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ShoppingBag, Radio, X, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { fmt } from "../../lib/format";
import { won, type Broadcast, type Lobby, type LogEntry, type Person, type Run } from "../../lib/life";
import styles from "./Life.module.css";
import { DeltaChips, ROLE_ICON, ROLE_LABEL, RollChip } from "./playParts";

export function BroadcastCard({ b }: { b: Broadcast }) {
  const next = b.ladder[b.rank + 1] ?? null;
  return (
    <section className={`${styles.card} ${styles.bcCard} ${b.active ? styles.bcLive : ""}`}>
      <div className={styles.cardHead}>
        <h3>
          <Radio size={15} aria-hidden="true" />
          방송
        </h3>
        <span className={b.active ? styles.bcOn : styles.muted}>{b.active ? "방송 중" : b.now ? "전향" : b.graduated ? "졸업" : "쉬는 중"}</span>
      </div>
      <p className={styles.bcTitle}>{b.now ?? b.title}</p>
      {b.now && <p className={styles.bcSub}>예전엔 {b.title}</p>}
      <div className={styles.bcFame}>
        <div className={styles.bcFameTop}>
          <span>인지도</span>
          <b className="num">{b.fame}</b>
        </div>
        <div className={styles.bcBar}>
          <i style={{ width: `${Math.max(2, b.fame)}%` }} />
          {b.ladder.slice(1).map((l) => (
            <em key={l.name} style={{ left: `${l.at}%` }} className={b.fame >= l.at ? styles.bcTickOn : ""} title={`${l.name} · 인지도 ${l.at}`} />
          ))}
        </div>
        <p className={styles.bcNext}>
          {next ? (
            <>
              다음 등급 <b>{next.name}</b> · 인지도 <span className="num">{next.at}</span>
            </>
          ) : (
            "최고 등급이에요"
          )}
        </p>
      </div>
      <div className={styles.bcChips}>
        {b.concept && <span>{b.concept}</span>}
        {b.show && <span>주력 · {b.show}</span>}
        {b.nick.map((n) => (
          <span key={n} className={styles.bcNick}>
            별명 · {n}
          </span>
        ))}
        {b.million && <span className={styles.bcGold}>100만 달성</span>}
      </div>
      <dl className={styles.bcRows}>
        <div>
          <dt>팬 이름</dt>
          <dd>{b.fandom ? "네루" : "아직 없어요"}</dd>
        </div>
        <div>
          <dt>내가 후원한 포인트</dt>
          <dd className="num">{fmt(b.donated)}P</dd>
        </div>
      </dl>
    </section>
  );
}

export function Feed({ items, className }: { items: LogEntry[]; className: string }) {
  if (items.length === 0) return null;
  return (
    <section className={`${styles.card} ${className}`}>
      <h3 className={styles.cardTitle}>지난 이야기</h3>
      <ol className={styles.feed}>
        {items.map((e, i) => (
          <li key={i} className={`${styles.entry} ${e.k === "rare" ? styles.entryRare : ""} ${e.hl ? styles.entryHl : ""}`}>
            <span className={`num ${styles.entryAge}`}>{e.age}</span>
            <div>
              <p>{e.t}</p>
              {(e.roll || e.d || e.m) && (
                <span className={styles.metaRow}>
                  {e.roll && <RollChip r={e.roll} />}
                  <DeltaChips d={e.d} m={e.m} />
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function MoneyCard({ run, net, rows }: { run: Run; net: number; rows: number[][] }) {
  const m = run.money;
  const assets = m.assets.reduce((a, x) => a + x.value, 0);
  const pts = rows.map((r) => r[6] ?? 0);
  const minV = Math.min(0, ...pts);
  const maxV = Math.max(1, ...pts);
  const W = 240;
  const H = 44;
  const line = pts.length > 1 ? pts.map((v, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - ((v - minV) / (maxV - minV)) * H).toFixed(1)}`).join(" ") : "";
  const kid = run.age < 15;
  return (
    <section className={styles.card}>
      <div className={styles.moneyHead}>
        <span>
          <Wallet size={14} aria-hidden="true" />
          순자산
        </span>
        <b className={`num ${net < 0 ? styles.down : ""}`}>{won(net)}</b>
      </div>
      {line && (
        <svg className={styles.spark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <polyline points={line} fill="none" stroke="var(--c-gold)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      )}
      {kid ? (
        <p className={styles.moneyNote}>아직 어려서 용돈만 모아요. 15세부터 돈쓰기와 투자가 열려요.</p>
      ) : (
        <dl className={styles.moneyRows}>
          <div>
            <dt>현금</dt>
            <dd className="num">{won(m.cash)}</dd>
          </div>
          <div>
            <dt>투자</dt>
            <dd className="num">
              {won(m.invest)}
              {m.ret !== 0 && (
                <small className={m.ret > 0 ? styles.up : styles.down}>
                  {m.ret > 0 ? <TrendingUp size={11} aria-hidden="true" /> : <TrendingDown size={11} aria-hidden="true" />}
                  {won(Math.abs(m.ret), true)}
                </small>
              )}
            </dd>
          </div>
          {assets > 0 && (
            <div>
              <dt>{m.assets.map((a) => a.name).join("·")}</dt>
              <dd className="num">{won(assets)}</dd>
            </div>
          )}
          {m.debt > 0 && (
            <div>
              <dt>빚</dt>
              <dd className={`num ${styles.down}`}>−{won(m.debt)}</dd>
            </div>
          )}
          <div className={styles.moneySep} />
          <div>
            <dt>지난해 수입</dt>
            <dd className="num">{won(m.income)}</dd>
          </div>
          <div>
            <dt>지난해 지출</dt>
            <dd className="num">{won(m.expense)}</dd>
          </div>
          <div>
            <dt>평생 번 돈</dt>
            <dd className="num">{won(m.earned)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

export function PeopleCard({ people }: { people: Person[] }) {
  const order: Person["role"][] = ["spouse", "partner", "child", "mom", "dad", "friend", "pet"];
  const list = [...people].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.id - b.id);
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h3>사람들</h3>
        <span className={styles.muted}>{list.filter((p) => p.alive).length}명</span>
      </div>
      <ul className={styles.people}>
        {list.map((p) => {
          const Icon = ROLE_ICON[p.role];
          return (
            <li key={p.id} className={p.alive ? "" : styles.gone}>
              <span className={`${styles.personIcon} ${styles[`r_${p.role}`] ?? ""}`} aria-hidden="true">
                <Icon size={15} />
              </span>
              <div className={styles.personBody}>
                <span className={styles.personTop}>
                  <b>{p.role === "mom" || p.role === "dad" ? ROLE_LABEL[p.role] : p.name}</b>
                  <span>
                    {p.role === "mom" || p.role === "dad" ? "" : `${ROLE_LABEL[p.role]} · `}
                    {p.alive ? `${p.age}세` : "곁을 떠남"}
                  </span>
                </span>
                {p.alive && (
                  <span className={styles.bond} title={`사이 ${p.bond}`}>
                    <span style={{ width: `${p.bond}%` }} />
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ShopCard({ run, lobby, busy, onOpen, onFund }: {
  run: Run; lobby: Lobby; busy: boolean; onOpen: () => void; onFund: (id: string) => void;
}) {
  const ptsLeft = run.pointsLimit - run.pointsUsed;
  const kid = run.age < 15;
  const ready = run.shop.filter((s) => !s.off).length;
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h3>{kid ? "보호자 지원" : "돈쓰기"}</h3>
        <span className={styles.muted}>
          포인트 <b className="num">{ptsLeft}</b>/{run.pointsLimit}번
        </span>
      </div>
      <button type="button" className={styles.shopOpen} onClick={onOpen}>
        <ShoppingBag size={18} aria-hidden="true" />
        <span>
          <b>{kid ? "보호자가 사주기" : "상점 열기"}</b>
          <small>
            {kid ? "포인트로만 살 수 있어요" : `보유 ${won(run.money.cash + run.money.invest)}`} · 살 수 있는 것 {ready}개
          </small>
        </span>
        <ArrowRight size={16} aria-hidden="true" />
      </button>
      {!kid && (
        <div className={styles.fund}>
          <span className={styles.fundLabel}>여유자금 굴리기</span>
          <div className={styles.fundBtns}>
            {lobby.funds.map((f) => (
              <button key={f.id} type="button" className={run.money.fund === f.id ? styles.fundOn : ""} onClick={() => onFund(f.id)} disabled={busy} title={f.hint}>
                {f.name}
              </button>
            ))}
          </div>
          <span className={styles.fundHint}>{lobby.funds.find((f) => f.id === run.money.fund)?.hint}</span>
        </div>
      )}
    </section>
  );
}

export function ShopModal({ run, balance, canShop, busy, onBuy, onClose }: {
  run: Run; balance: number; canShop: boolean; busy: boolean;
  onBuy: (id: string, pay: "cash" | "points", name: string, price: number) => void; onClose: () => void;
}) {
  const cats = useMemo(() => [...new Set(run.shop.map((s) => s.cat))], [run.shop]);
  const [cat, setCat] = useState<string | null>(null);
  const curCat = cat && cats.includes(cat) ? cat : cats[0];
  const items = run.shop.filter((s) => s.cat === curCat);
  const ptsLeft = run.pointsLimit - run.pointsUsed;
  const cash = run.money.cash + run.money.invest;
  const kid = run.age < 15;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className={styles.modalBack} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="돈쓰기" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <div>
            <h3>{kid ? "보호자 지원" : "돈쓰기"}</h3>
            <span className={styles.muted}>
              {run.age}세 · {kid ? "포인트로만" : <>보유 <b className="num">{won(cash)}</b></>} · 포인트 <b className="num">{ptsLeft}</b>/{run.pointsLimit}번
              {!run.isTest && <> · 내 포인트 <b className="num">{fmt(balance)}P</b></>}
            </span>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="닫기">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className={styles.catTabs}>
          {cats.map((c) => (
            <button key={c} type="button" className={c === curCat ? styles.catOn : ""} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        <ul className={styles.shopGrid}>
          {items.map((it) => (
            <li key={it.id} className={it.off ? styles.shopDim : ""}>
              <div className={styles.shopInfo}>
                {it.maxLv !== null && (
                  <span className={styles.tierRow}>
                    <span className={styles.tierDots} aria-label={`${it.lv}/${it.maxLv}단계`}>
                      {Array.from({ length: it.maxLv }, (_, i) => (
                        <i key={i} className={i < (it.lv ?? 0) ? styles.tierOn : ""} />
                      ))}
                    </span>
                    {it.cur ? `지금: ${it.cur}` : "아직 없음"}
                  </span>
                )}
                <b>
                  {it.maxLv !== null && it.cur && !it.off?.startsWith("최고") && <em className={styles.upTag}>업그레이드</em>}
                  {it.name}
                </b>
                <span>{it.hint}</span>
                {it.off && <span className={styles.shopOff}>{it.off}</span>}
              </div>
              <div className={styles.shopBtns}>
                {!it.child && !kid && (
                  <button type="button" className={styles.buyBtn} disabled={!canShop || busy || !!it.off || cash < it.price} onClick={() => onBuy(it.id, "cash", it.name, it.price)}>
                    {won(it.price)}
                  </button>
                )}
                <button type="button" className={`${styles.buyBtn} ${styles.buyPts}`} disabled={!canShop || busy || !!it.off || ptsLeft <= 0 || (!run.isTest && balance < it.price)} onClick={() => onBuy(it.id, "points", it.name, it.price)}>
                  {run.isTest ? "0" : fmt(it.price)}P
                </button>
              </div>
            </li>
          ))}
        </ul>
        <p className={styles.fine}>상점이 열려 있는 동안은 시간이 멈춰요 · 1만원 = 1P</p>
      </div>
    </div>
  );
}

// points: 포인트 잔액(테스트 판이면 null — 포인트가 안 빠짐)
