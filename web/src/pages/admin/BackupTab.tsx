// 데이터 백업 — 매주 자동 + 수동 "지금 백업". 다운로드는 60초짜리 링크.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, Download } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { apiFetch } from "../../lib/auth";
import { API } from "../../lib/config";
import { fmtDateTime } from "../../lib/admin";
import styles from "./Admin.module.css";
import { SkeletonList } from "../../components/Skeleton";

type Backup = { path: string; kind: "auto" | "manual"; createdAt: string; sizeBytes: number | null };
const fmtBytes = (n: number | null) => (n == null ? "-" : n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const call = <T,>(body: Record<string, unknown>) => apiFetch<T>(API.adminBackup, { body });

export function BackupTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "backups"], queryFn: () => call<{ items: Backup[] }>({ action: "list" }) });
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  const [dl, setDl] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setMsg({ text: "백업하는 중... (몇 초 걸려요)", ok: true });
    try {
      const r = await call<{ sizeBytes: number }>({ action: "run" });
      setMsg({ text: `백업했어요. (${fmtBytes(r.sizeBytes)})`, ok: true });
      qc.invalidateQueries({ queryKey: ["admin", "backups"] });
    } catch {
      setMsg({ text: "백업하지 못했어요." });
    } finally {
      setRunning(false);
    }
  };
  const download = async (path: string) => {
    setDl(path);
    try {
      const { url } = await call<{ url: string }>({ action: "download", path });
      window.location.href = url;
    } catch {
      setMsg({ text: "다운로드 링크를 만들지 못했어요." });
    } finally {
      setDl(null);
    }
  };

  return (
    <Card
      title="데이터 백업"
      extra={
        <button type="button" className="btn btn-primary btn-sm" disabled={running} onClick={run}>
          <DatabaseBackup size={15} aria-hidden="true" />
          지금 백업
        </button>
      }
    >
      <p className={styles.muted} style={{ marginTop: 0 }}>
        매주 월요일 새벽 5시(한국 시간)에 자동으로 백업돼요. 자동 백업은 최근 8개, 수동 백업은 최근 10개까지 보관해요.
        <br />
        가끔 하나씩 내려받아 PC에 따로 보관해 두면 더 안전해요. (사이트 저장소 폴더에는 넣지 마세요.)
      </p>
      {msg && <p className={`status ${msg.ok ? "ok" : "error"}`}>{msg.text}</p>}
      {q.isLoading && <SkeletonList rows={3} variant="row" />}
      {q.isError && <p className="status error">백업 목록을 불러오지 못했어요.</p>}
      {q.data && q.data.items.length === 0 && <EmptyState>아직 백업이 없어요.</EmptyState>}
      <div className={styles.bkList}>
        {q.data?.items.map((b) => (
          <div key={b.path} className={styles.bkRow}>
            <span className={`tag ${b.kind === "auto" ? "" : "tag-accent"}`}>{b.kind === "auto" ? "자동" : "수동"}</span>
            <span className={styles.bkDate}>{fmtDateTime(b.createdAt)}</span>
            <span className={`${styles.muted} num`}>{fmtBytes(b.sizeBytes)}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={dl === b.path} onClick={() => download(b.path)}>
              <Download size={14} aria-hidden="true" />
              다운로드
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}
