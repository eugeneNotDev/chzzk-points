// 후원 적립 — 방송 PC 프로그램이 넘겨준 후원 기록. 1만 치즈 이상은 10% 자동 적립,
// 익명 후원은 여기서 리모컨에 뜬 닉네임을 검색해 유저를 골라 적립(또는 적립 안 함).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { ApiError, apiFetch } from "../../lib/auth";
import { API } from "../../lib/config";
import { adminCall, fmtDateTime, num, type AdminUser } from "../../lib/admin";
import styles from "./Admin.module.css";
import { alertDialog, confirmDialog } from "../../lib/dialog";

type Pending = { id: number; amount: number; points: number; donationType: string | null; message: string | null; createdAt: string };
type Recent = { id: number; status: string; nickname: string | null; channelId: string | null; channelName: string | null; amount: number; points: number; donationType: string | null; createdAt: string };
export type DonationData = { pending: Pending[]; recent: Recent[]; link: { tokenSaved?: boolean; tokenUpdatedAt?: string | null; lastDonationAt?: string | null } };

const STATUS_LABEL: Record<string, string> = {
  credited: "자동 적립",
  anonymous_credited: "익명 → 적립",
  dismissed: "익명 · 적립 안 함",
  below_min: "1만 치즈 미만",
  not_member: "미가입자",
  mission_pending: "미션 진행 중",
  mission_failed: "미션 실패 · 적립 없음",
};
const TYPE_LABEL: Record<string, string> = { VIDEO: "영상 후원", MISSION: "미션 후원", MISSION_JOIN: "미션 참여", SUB_GIFT: "구독권 선물" };
const typePrefix = (t: string | null) => (t && TYPE_LABEL[t] ? `${TYPE_LABEL[t]} · ` : "");
const unit = (t: string | null) => (t === "SUB_GIFT" ? "원 상당" : "치즈");

export function DonationsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "donations"], queryFn: () => apiFetch<DonationData>(API.adminDonations) });
  const reload = () => qc.invalidateQueries({ queryKey: ["admin", "donations"] });
  const d = q.data;

  let link: { text: string; ok: boolean } | null = null;
  if (d) {
    const l = d.link || {};
    if (!l.tokenSaved) link = { text: "후원 연동 준비가 안 됐어요 — 사이트에서 로그아웃했다가 유진 알파 계정으로 다시 로그인해 주세요.", ok: false };
    else if (l.tokenUpdatedAt && Date.now() - new Date(l.tokenUpdatedAt).getTime() > 25 * 86_400_000)
      link = { text: "치지직 로그인 정보가 곧 만료돼요(30일) — 사이트에 한 번 다시 로그인해 주세요.", ok: false };
    else link = { text: `후원 연동 준비됨 — 방송할 때 PC에서 후원 연동 프로그램을 켜두세요${l.lastDonationAt ? ` · 마지막 후원 기록 ${fmtDateTime(l.lastDonationAt)}` : ""}`, ok: true };
  }

  return (
    <>
      <Card
        title="후원 적립"
        extra={
          <button type="button" className="btn btn-ghost btn-sm" onClick={reload} disabled={q.isFetching}>
            <RefreshCw size={14} aria-hidden="true" />
            새로고침
          </button>
        }
      >
        <p className={styles.muted} style={{ marginTop: 0 }}>
          1만 치즈 이상 후원은 금액의 10%가 자동으로 적립돼요. 익명 후원은 아래 목록에서 리모컨을 보고 누군지 골라 적립해 주세요.
        </p>
        {q.isError && <p className="status error">후원 기록을 불러오지 못했어요.</p>}
        {link && <p className={`status ${link.ok ? "ok" : "error"}`}>{link.text}</p>}
      </Card>

      <Card title="익명 후원 확인 대기">
        {d && d.pending.length === 0 && <EmptyState>확인할 익명 후원이 없어요.</EmptyState>}
        <div className={styles.donList}>
          {d?.pending.map((p) => <PendingRow key={p.id} p={p} onDone={reload} />)}
        </div>
      </Card>

      <Card title="최근 처리 기록" flush>
        {d && d.recent.length === 0 && <EmptyState>아직 후원 기록이 없어요.</EmptyState>}
        <div className={styles.logList}>
          {d?.recent.map((r) => (
            <div key={r.id} className={`${styles.logRow} ${r.points > 0 ? "" : styles.done}`}>
              <div className={styles.logWho}>
                <strong>{r.channelName || r.nickname || "익명"}</strong>
                <span>
                  {typePrefix(r.donationType)}
                  {STATUS_LABEL[r.status] || r.status} · {num(r.amount)}
                  {unit(r.donationType)}
                </span>
              </div>
              <span className={`${styles.amt} ${styles.plus} num`}>{r.points > 0 ? `+${num(r.points)}P` : ""}</span>
              <span className={styles.time}>{fmtDateTime(r.createdAt)}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function PendingRow({ p, onDone }: { p: Pending; onDone: () => void }) {
  const [input, setInput] = useState("");
  const [found, setFound] = useState<AdminUser[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const find = async () => {
    const q = input.trim();
    if (!q) return setNote("닉네임을 입력해 주세요.");
    setNote("찾는 중...");
    setFound(null);
    try {
      const r = await adminCall<{ users: AdminUser[] }>({ action: "search-users", q, page: 1 });
      const users = (r.users || []).filter((u) => !u.banned).slice(0, 6);
      setFound(users);
      setNote(users.length ? "" : "일치하는 가입자가 없어요.");
    } catch {
      setNote("검색에 실패했어요.");
    }
  };
  const assign = async (u: AdminUser) => {
    if (!(await confirmDialog(`${u.channelName}님에게 ${num(p.points)}P를 적립할까요?`))) return;
    setBusy(true);
    try {
      await apiFetch(API.adminDonations, { body: { action: "assign", id: p.id, channelId: u.channelId } });
    } catch (e) {
      alertDialog(e instanceof ApiError && e.body.error === "not_pending" ? "이미 처리된 후원이에요." : "적립에 실패했어요.");
    }
    setBusy(false);
    onDone();
  };
  const dismiss = async () => {
    if (!(await confirmDialog("이 익명 후원은 적립하지 않고 목록에서 뺄까요?"))) return;
    try {
      await apiFetch(API.adminDonations, { body: { action: "dismiss", id: p.id } });
    } catch {
      alertDialog("처리에 실패했어요.");
    }
    onDone();
  };
  return (
    <div className={styles.donRow}>
      <div className={styles.donHead}>
        <strong className="num">
          {num(p.amount)}
          {unit(p.donationType)} → {num(p.points)}P
        </strong>
        <span className={styles.muted}>
          {typePrefix(p.donationType)}
          {fmtDateTime(p.createdAt)}
        </span>
      </div>
      {p.message && <p className={styles.donMsg}>"{p.message}"</p>}
      <form
        className={styles.searchRow}
        onSubmit={(e) => {
          e.preventDefault();
          find();
        }}
      >
        <input className="input" placeholder="리모컨에 뜬 닉네임 검색" value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" className="btn btn-ghost">
          <Search size={16} aria-hidden="true" />
          찾기
        </button>
        <button type="button" className={styles.linkBtn} onClick={dismiss}>
          적립 안 함
        </button>
      </form>
      {note && <p className={styles.muted}>{note}</p>}
      {found && found.length > 0 && (
        <div className={styles.pickRow}>
          {found.map((u) => (
            <button key={u.channelId} type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => assign(u)}>
              {u.channelName || "(이름 없음)"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
