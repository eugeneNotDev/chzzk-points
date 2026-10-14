// 유저 관리 — 검색 · 개별 지급/차감/밴 · 체크해서 일괄 지급/차감(검색·페이지를 넘나들어도 선택 유지) · 이름 누르면 상세 팝업.
import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Search } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { Pagination } from "../../components/Pagination";
import { adminCall, num, type AdminUser, type Paged } from "../../lib/admin";
import { useAdminUserModal } from "./useAdminUserModal";
import styles from "./Admin.module.css";

const askAmount = (raw: string) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    alert("지급/차감할 수량을 1 이상 숫자로 입력해주세요.");
    return null;
  }
  return Math.trunc(n);
};

export function UsersTab() {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const key = ["admin", "users"];
  const q = useQuery({
    queryKey: [...key, query, page],
    placeholderData: keepPreviousData,
    queryFn: () => adminCall<Paged & { users: AdminUser[] }>({ action: "search-users", q: query, page }),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["admin", "stats"] });
  };
  const modal = useAdminUserModal(refresh);
  const users = q.data?.users ?? [];

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const checkedOnPage = users.filter((u) => selected.has(u.channelId)).length;

  return (
    <>
      <Card title="유저 검색">
        <form
          className={styles.searchRow}
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(input.trim());
            setPage(1);
          }}
        >
          <input className="input" placeholder="채널명 검색 (비우면 전체)" value={input} onChange={(e) => setInput(e.target.value)} />
          <button type="submit" className="btn btn-primary">
            <Search size={16} aria-hidden="true" />
            검색
          </button>
        </form>
      </Card>

      <BulkCard selected={selected} onDone={(clearSel) => (clearSel && setSelected(new Set()), refresh())} />

      <Card flush>
        <div className={styles.listHead}>
          <label className="check">
            <input
              type="checkbox"
              checked={users.length > 0 && checkedOnPage === users.length}
              ref={(el) => {
                if (el) el.indeterminate = checkedOnPage > 0 && checkedOnPage < users.length;
              }}
              onChange={(e) => users.forEach((u) => toggle(u.channelId, e.target.checked))}
            />
            이 페이지 전체 선택
          </label>
          {q.data && <span className={styles.muted}>총 {num(q.data.totalCount)}명</span>}
        </div>
        {q.isError && <EmptyState>검색에 실패했어요.</EmptyState>}
        {q.data && users.length === 0 && <EmptyState>검색 결과가 없어요.</EmptyState>}
        {users.map((u) => (
          <UserRow key={u.channelId} u={u} checked={selected.has(u.channelId)} onCheck={(on) => toggle(u.channelId, on)} onOpen={() => modal.open?.(u.channelId)} onChanged={refresh} />
        ))}
        {q.data && <Pagination page={q.data.page} totalPages={q.data.totalPages} onChange={setPage} />}
      </Card>
      {modal.element}
    </>
  );
}

function UserRow({ u, checked, onCheck, onOpen, onChanged }: { u: AdminUser; checked: boolean; onCheck: (on: boolean) => void; onOpen: () => void; onChanged: () => void }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const adjust = async (sign: 1 | -1) => {
    const n = askAmount(amount);
    if (!n) return;
    setBusy(true);
    try {
      await adminCall({ action: "adjust-points", channelId: u.channelId, amount: n * sign });
      setAmount("");
      onChanged();
    } catch {
      alert("포인트 지급/차감에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };
  // 밴: 재로그인이 막히고 랭킹에서도 빠지며, 보유 포인트·칭호가 전부 초기화(밴을 풀어도 안 돌아옴).
  const ban = async () => {
    const next = !u.banned;
    const msg = next
      ? "이 유저를 밴할까요?\n재로그인이 막히고 랭킹에서도 빠지며, 보유 포인트와 칭호가 전부 초기화돼요.\n(나중에 밴을 풀어도 초기화된 내용은 되돌아오지 않아요)"
      : "밴을 해제할까요? (포인트·칭호는 초기화된 상태 그대로 유지돼요)";
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      await adminCall({ action: "set-ban", channelId: u.channelId, banned: next });
      onChanged();
    } catch {
      alert("밴 처리에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`${styles.userRow} ${u.banned ? styles.banned : ""}`}>
      <input type="checkbox" className={styles.cb} checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`${u.channelName} 선택`} />
      <div className={styles.userInfo}>
        <button type="button" className={styles.nameBtn} onClick={onOpen} title="상세 내역 보기">
          {u.channelName || "(이름 없음)"}
        </button>
        <span className={styles.muted}>
          <span className="num">{num(u.balance)}P</span> · {u.isPublic ? "공개" : "비공개"}
          {u.banned && <span className="tag tag-live">밴됨</span>}
        </span>
      </div>
      <div className={styles.userActions}>
        <input type="number" className={`input ${styles.amtInput}`} placeholder="수량" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => adjust(1)}>
          지급
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => adjust(-1)}>
          차감
        </button>
        <button type="button" className={`btn btn-sm ${u.banned ? "btn-ghost" : "btn-danger"}`} disabled={busy} onClick={ban}>
          {u.banned ? "밴 해제" : "밴"}
        </button>
      </div>
    </div>
  );
}

// 일괄 지급/차감 — 체크한 유저들 또는 전체 유저(밴된 유저·관리자 계정 제외, 서버가 계산). 기본 접힘.
function BulkCard({ selected, onDone }: { selected: Set<string>; onDone: (clearSel: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (target: "selected" | "all", sign: 1 | -1) => {
    const n = askAmount(amount);
    if (!n) return;
    const verb = sign > 0 ? "지급" : "차감";
    const ids = [...selected];
    if (target === "selected") {
      if (!ids.length) return alert("선택된 유저가 없어요.");
      if (!confirm(`선택한 ${ids.length}명에게 ${num(n)}P를 ${verb}할까요?`)) return;
    } else if (!confirm(`전체 유저에게 ${num(n)}P를 ${verb}할까요?\n(밴 처리된 유저와 관리자 계정은 제외돼요)`)) return;
    setBusy(true);
    setMsg({ text: "처리 중...", ok: true });
    try {
      const r = await adminCall<{ affected: number }>(
        target === "selected" ? { action: "bulk-adjust-points", target, channelIds: ids, amount: n * sign } : { action: "bulk-adjust-points", target, amount: n * sign },
      );
      setMsg({ text: `${num(r.affected ?? 0)}명에게 ${verb} 완료했어요.`, ok: true });
      setAmount("");
      onDone(target === "selected");
    } catch {
      setMsg({ text: `${verb}에 실패했어요.` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title={
        <button type="button" className={styles.collapseBtn} aria-expanded={open} onClick={() => setOpen(!open)}>
          일괄 포인트 지급/차감 <ChevronDown size={18} className={open ? styles.rot : ""} aria-hidden="true" />
        </button>
      }
      extra={selected.size > 0 ? <span className="tag tag-accent">{selected.size}명 선택됨</span> : undefined}
    >
      {open && (
        <div className={styles.bulk}>
          <input type="number" className={`input ${styles.amtInput}`} placeholder="수량" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <div className={styles.bulkBtns}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy || selected.size === 0} onClick={() => run("selected", 1)}>
              선택한 유저에게 지급
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy || selected.size === 0} onClick={() => run("selected", -1)}>
              선택한 유저에게 차감
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run("all", 1)}>
              전체 유저에게 지급
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run("all", -1)}>
              전체 유저에게 차감
            </button>
          </div>
          <p className={styles.muted}>선택된 유저: {selected.size}명 (검색·페이지를 바꿔도 선택이 유지돼요)</p>
          {msg && <p className={`status ${msg.ok ? "ok" : "error"}`}>{msg.text}</p>}
        </div>
      )}
    </Card>
  );
}
