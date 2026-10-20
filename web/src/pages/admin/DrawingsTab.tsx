// 관리자 "그림 후원" 탭 — 방송에 나간(나가는 중인) 그림 목록. 이상한 그림은 "화면에서 끄기"로 바로 내리고,
// 그린 사람은 "그림 후원 막기"로 다시 못 보내게. 방송 중에 폰으로도 보기 쉽게 15초마다 새로고침.
// 방송에 나간 그림 파일은 6개월 뒤 서버가 지워서 그 뒤엔 썸네일 대신 "지난 그림"으로 보임.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, EyeOff } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { SkeletonList } from "../../components/Skeleton";
import { apiFetch } from "../../lib/auth";
import { API } from "../../lib/config";
import { fmtDateTime } from "../../lib/admin";
import { confirmDialog, toast } from "../../lib/dialog";
import { fmt } from "../../lib/format";
import styles from "./Admin.module.css";

type Row = {
  id: number;
  code: string;
  status: "shown" | "hidden";
  url: string | null;
  shownAt: string | null;
  hiddenAt: string | null;
  channelId: string;
  drawer: string | null;
  drawerBlocked: boolean;
  donator: string | null;
  amount: number | null;
};
const call = <T,>(payload: Record<string, unknown>) => apiFetch<T>(API.drawings, { body: payload });

export function DrawingsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "drawings"], queryFn: () => call<{ items: Row[] }>({ action: "admin-list" }), refetchInterval: 15_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "drawings"] });

  async function hide(r: Row) {
    await call({ action: "admin-hide", id: r.id });
    toast("화면에서 내렸어요");
    refresh();
  }
  async function block(r: Row) {
    const on = !r.drawerBlocked;
    if (on && !(await confirmDialog(`${r.drawer ?? "이 사람"}님의 그림 후원을 막을까요? 앞으로 그림을 보낼 수 없어요.`, { okText: "막기", danger: true }))) return;
    await call({ action: "admin-block", channelId: r.channelId, blocked: on });
    toast(on ? "그림 후원을 막았어요" : "그림 후원 막기를 풀었어요");
    refresh();
  }

  return (
    <Card title="그림 후원" flush>
      <p className={`muted ${styles.fs13} ${styles.p_0_12_10}`}>
        후원 메시지에 그림 코드를 넣고 3,000치즈 이상 후원하면 오버레이에 10초 동안 떠요. 문제 있는 그림은 "화면에서 끄기"로 바로 내리세요.
      </p>
      {q.isLoading && <SkeletonList rows={3} variant="row" />}
      {q.isError && <EmptyState>목록을 불러오지 못했어요.</EmptyState>}
      {q.data?.items.length === 0 && <EmptyState>아직 방송에 나간 그림이 없어요.</EmptyState>}
      <ul className={styles.drawList}>
        {q.data?.items.map((r) => (
          <li key={r.id} className={r.status === "hidden" ? styles.drawOff : ""}>
            {r.url ? (
              <a href={r.url} target="_blank" rel="noopener" className={styles.drawThumb}>
                <img src={r.url} alt={`그림 ${r.code}`} loading="lazy" />
              </a>
            ) : (
              <span className={`${styles.drawThumb} ${styles.drawGone}`}>지난 그림</span>
            )}
            <div className={styles.drawInfo}>
              <b>
                {r.donator ?? "익명 후원"} · <span className="num">{fmt(r.amount ?? 0)}</span>치즈
              </b>
              <span className="muted">
                그린 사람 {r.drawer ?? "(이름 없음)"}
                {r.drawerBlocked && " · 막힘"} · {r.shownAt ? fmtDateTime(r.shownAt) : ""}
                {r.status === "hidden" && " · 내림"}
              </span>
            </div>
            <div className={styles.drawActions}>
              {r.status === "shown" && (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => hide(r)}>
                  <EyeOff size={14} aria-hidden="true" />
                  화면에서 끄기
                </button>
              )}
              <button type="button" className="btn btn-sm" onClick={() => block(r)}>
                <Ban size={14} aria-hidden="true" />
                {r.drawerBlocked ? "막기 풀기" : "그림 후원 막기"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
