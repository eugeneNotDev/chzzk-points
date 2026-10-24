// 유진 키우기 — 도감(직업·수식어·희귀 사건·특수 엔딩).
import { useMemo, useState } from "react";
import { Check, Lock, Trophy } from "lucide-react";
import { LoadError } from "../../components/LoadError";
import { useLifeDex, type DexEntry } from "../../lib/life";
import styles from "./Life.module.css";
import { Ring, TopBar } from "./parts";

/* ── 도감 ── */
type DexTab = "jobs" | "modifiers" | "events" | "specials";
const TABS: { key: DexTab; label: string }[] = [
  { key: "jobs", label: "직업" },
  { key: "modifiers", label: "수식어" },
  { key: "events", label: "희귀 이벤트" },
  { key: "specials", label: "특수 엔딩" },
];

export function DexView({ onBack }: { onBack: () => void }) {
  const q = useLifeDex(true);
  const [tab, setTab] = useState<DexTab>("jobs");
  const d = q.data;
  const counts = useMemo(() => {
    const c = (a: DexEntry[] = []) => ({ got: a.filter((x) => x.gotAt).length, total: a.length });
    return { jobs: c(d?.jobs), modifiers: c(d?.modifiers), events: c(d?.events), specials: c(d?.specials) };
  }, [d]);
  const total = Object.values(counts).reduce((s, c) => s + c.total, 0);
  const got = Object.values(counts).reduce((s, c) => s + c.got, 0);
  const pct = total ? Math.round((got / total) * 100) : 0;

  const groups = useMemo(() => {
    const list = d?.[tab] ?? [];
    if (tab !== "jobs") return [{ name: null as string | null, items: list }];
    const m = new Map<string, DexEntry[]>();
    for (const j of list) m.set(j.category ?? "기타", [...(m.get(j.category ?? "기타") ?? []), j]);
    return [...m.entries()].map(([name, items]) => ({ name, items }));
  }, [d, tab]);

  if (q.isError && !d) return <LoadError what="도감" onRetry={() => q.refetch()} />;

  return (
    <div className={styles.dex}>
      <TopBar title="유진 도감" onBack={onBack} />
      <section className={styles.dexHero}>
        <Ring pct={pct} size={76} stroke={7} />
        <div className={styles.dexCounts}>
          {TABS.map((t) => (
            <div key={t.key}>
              <span>{t.label}</span>
              <b className="num">
                {counts[t.key].got}
                <small>/{counts[t.key].total}</small>
              </b>
            </div>
          ))}
        </div>
      </section>
      <div className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? styles.tabOn : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {!d && <div className={`skeleton ${styles.heroSkel}`} />}
      {groups.map((g) => (
        <section key={g.name ?? "all"} className={styles.dexGroup}>
          {g.name && (
            <div className={styles.dexGroupHead}>
              <h3>{g.name}</h3>
              <span className="num">
                {g.items.filter((x) => x.gotAt).length} / {g.items.length}
              </span>
            </div>
          )}
          <div className={tab === "jobs" ? styles.dexGrid3 : styles.dexGrid2}>
            {g.items.map((x) => (
              <div key={x.id} className={`${styles.dexItem} ${x.gotAt ? "" : styles.dexLocked}`}>
                <span className={styles.dexIcon} aria-hidden="true">
                  {x.gotAt ? tab === "specials" ? <Trophy size={16} /> : <Check size={16} /> : <Lock size={15} />}
                </span>
                <b>{x.gotAt ? x.name : "???"}</b>
                {!x.gotAt && x.hint && <span className={styles.dexHint}>{x.hint}</span>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
