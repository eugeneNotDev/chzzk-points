// 포인트 로그(최근 24시간, 전체 종류) · 상점 내역(상점 사용만, 전체 기간 — 처리 완료 표시용).
import { useState, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { Pagination } from "../../components/Pagination";
import { adminCall, fmtDateTime, num, type LogEntry, type Paged } from "../../lib/admin";
import { LogRow } from "./LogRow";
import styles from "./Admin.module.css";

function SearchCard({ title, desc, onSearch }: { title: string; desc?: ReactNode; onSearch: (q: string) => void }) {
  const [input, setInput] = useState("");
  return (
    <Card title={title}>
      {desc && <p className={styles.muted} style={{ marginTop: 0 }}>{desc}</p>}
      <form
        className={styles.searchRow}
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(input.trim());
        }}
      >
        <input className="input" placeholder="채널명 검색 (비우면 전체)" value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" className="btn btn-primary">
          <Search size={16} aria-hidden="true" />
          검색
        </button>
      </form>
    </Card>
  );
}

export function LogTab() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["admin", "points-log", query, page],
    placeholderData: keepPreviousData,
    queryFn: () => adminCall<Paged & { entries: LogEntry[] }>({ action: "list-points-log", q: query, page }),
  });
  return (
    <>
      <SearchCard
        title="포인트 로그"
        desc="최근 24시간 기록이에요. 관리자가 직접 지급/차감한 줄은 실행취소할 수 있어요."
        onSearch={(s) => {
          setQuery(s);
          setPage(1);
        }}
      />
      <Card flush>
        {q.isError && <EmptyState>불러오기에 실패했어요.</EmptyState>}
        {q.data?.entries.length === 0 && <EmptyState>기록이 없어요.</EmptyState>}
        <div className={styles.logList}>
          {q.data?.entries.map((e) => (
            <LogRow
              key={e.id}
              e={e}
              onUndone={() => {
                qc.invalidateQueries({ queryKey: ["admin", "points-log"] });
                qc.invalidateQueries({ queryKey: ["admin", "users"] });
              }}
            />
          ))}
        </div>
        {q.data && <Pagination page={q.data.page} totalPages={q.data.totalPages} onChange={setPage} />}
      </Card>
    </>
  );
}

// 상점 내역 — 줄마다 "처리 완료" 버튼(되돌리기 가능), 체크해서 일괄 처리. 칭호 구매는 자동 지급이라 처리할 게 없음.
// 일괄 처리는 지금 보이는 페이지에서만 — 페이지/검색이 바뀌면 선택을 비움(안 보이는 항목까지 처리되지 않게).
export function SpendTab() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const key = ["admin", "spend-log", query, page];
  const q = useQuery({
    queryKey: key,
    placeholderData: keepPreviousData,
    queryFn: () => adminCall<Paged & { entries: LogEntry[] }>({ action: "list-spend-log", q: query, page }),
  });
  const go = (fn: () => void) => {
    setSelected(new Set());
    fn();
  };
  const entries = q.data?.entries ?? [];
  const selectable = entries.filter((e) => !e.titlePurchase);
  const checked = selectable.filter((e) => selected.has(e.id)).length;

  const setOne = async (e: LogEntry, processed: boolean) => {
    if (!processed && !confirm("처리완료를 취소할까요?")) return;
    try {
      await adminCall({ action: "set-processed", id: e.id, processed });
      qc.setQueryData<Paged & { entries: LogEntry[] }>(key, (d) => d && { ...d, entries: d.entries.map((x) => (x.id === e.id ? { ...x, processed } : x)) });
    } catch {
      alert(processed ? "처리완료 표시에 실패했어요." : "되돌리기에 실패했어요.");
    }
  };
  const bulk = async (processed: boolean) => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`선택한 ${ids.length}개 항목을 ${processed ? "처리완료로" : "처리안함으로"} 표시할까요?`)) return;
    try {
      await adminCall({ action: "bulk-set-processed", ids, processed });
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["admin", "spend-log"] });
    } catch {
      alert("일괄 처리에 실패했어요.");
    }
  };

  return (
    <>
      <SearchCard title="상점 내역" desc="상점에서 쓴 기록 전체예요. 방송에서 처리한 항목은 처리 완료로 표시해 두세요." onSearch={(s) => go(() => (setQuery(s), setPage(1)))} />
      <Card flush>
        <div className={styles.listHead}>
          <label className="check">
            <input
              type="checkbox"
              checked={selectable.length > 0 && checked === selectable.length}
              ref={(el) => {
                if (el) el.indeterminate = checked > 0 && checked < selectable.length;
              }}
              onChange={(ev) => setSelected(ev.target.checked ? new Set(selectable.map((e) => e.id)) : new Set())}
            />
            전체 선택
          </label>
          <span className={styles.muted}>선택 {selected.size}개</span>
          <span className={styles.headBtns}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!selected.size} onClick={() => bulk(true)}>
              선택 항목 처리완료
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!selected.size} onClick={() => bulk(false)}>
              선택 항목 처리안함
            </button>
          </span>
        </div>
        {q.isError && <EmptyState>불러오기에 실패했어요.</EmptyState>}
        {q.data && entries.length === 0 && <EmptyState>기록이 없어요.</EmptyState>}
        <div className={styles.logList}>
          {entries.map((e) => {
            const auto = !!e.titlePurchase;
            return (
              <div key={e.id} className={`${styles.logRow} ${styles.withCb} ${e.processed || auto ? styles.done : ""}`}>
                <input
                  type="checkbox"
                  className={styles.cb}
                  disabled={auto}
                  checked={selected.has(e.id)}
                  onChange={(ev) =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (ev.target.checked) n.add(e.id);
                      else n.delete(e.id);
                      return n;
                    })
                  }
                  aria-label="선택"
                />
                <div className={styles.logWho}>
                  <strong>{e.channelName || "(알 수 없음)"}</strong>
                  <span>{e.reason || ""}</span>
                </div>
                <span className={`${styles.amt} ${e.amount > 0 ? styles.plus : styles.minus} num`}>
                  {e.amount > 0 ? "+" : ""}
                  {num(e.amount)}P
                </span>
                <span className={styles.time}>{fmtDateTime(e.createdAt)}</span>
                <span className={styles.logSide}>
                  {auto ? (
                    <span className="tag">칭호 · 자동 지급</span>
                  ) : e.processed ? (
                    <>
                      <span className={styles.processed}>
                        <Check size={14} aria-hidden="true" /> 처리됨
                      </span>
                      <button type="button" className={styles.linkBtn} onClick={() => setOne(e, false)}>
                        되돌리기
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setOne(e, true)}>
                      처리 완료
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {q.data && <Pagination page={q.data.page} totalPages={q.data.totalPages} onChange={(p) => go(() => setPage(p))} />}
      </Card>
    </>
  );
}
