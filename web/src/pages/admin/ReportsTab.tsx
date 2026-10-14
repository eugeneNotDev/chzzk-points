// 게시판 신고 — 대상(글/댓글)별로 묶어서. 서로 다른 5명이 신고하면 자동 숨김.
// 처리: 숨김 해제(복구) / 문제없음 / 삭제(보상 받은 후기면 100P 회수).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { apiFetch } from "../../lib/auth";
import { API } from "../../lib/config";
import { fmtDateTime } from "../../lib/admin";
import styles from "./Admin.module.css";

type ReportItem = {
  targetType: "post" | "comment";
  targetId: number;
  postId: number;
  board: "free" | "review";
  title: string;
  body: string;
  authorName: string;
  count: number;
  reasons: Record<string, number>;
  memos: { memo: string; reporterName: string }[];
  hidden: boolean;
  exists: boolean;
  resolution?: string;
  resolvedAt?: string;
};
export type ReportData = { items: ReportItem[]; openCount: number };

const REASON: Record<string, string> = { abuse: "욕설·비방", spam: "도배·광고", obscene: "음란·불쾌한 내용", privacy: "개인정보 노출", etc: "기타" };
const RESOLUTION: Record<string, string> = { restored: "숨김 해제", dismissed: "문제없음", deleted: "삭제함", author_deleted: "작성자가 삭제" };

export function ReportsTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"open" | "done">("open");
  const q = useQuery({
    queryKey: ["admin", "reports", status],
    queryFn: () => apiFetch<ReportData>(API.board, { body: { action: "admin-reports", status } }),
  });
  const [err, setErr] = useState("");

  const resolve = async (it: ReportItem, action: "restore" | "dismiss" | "delete") => {
    const what = it.targetType === "post" ? "글" : "댓글";
    const ask = action === "delete" ? `이 ${what}을 삭제할까요? (보상 받은 후기면 100P가 회수돼요)` : action === "restore" ? "숨김을 해제하고 다시 보이게 할까요?" : "문제없음으로 처리할까요?";
    if (!confirm(ask)) return;
    setErr("");
    try {
      await apiFetch(API.board, { body: { action: "admin-resolve", targetType: it.targetType, targetId: it.targetId, resolve: action } });
      qc.invalidateQueries({ queryKey: ["admin", "reports"] });
      qc.invalidateQueries({ queryKey: ["board"] });
    } catch {
      setErr("처리하지 못했어요.");
    }
  };

  return (
    <>
      <div className="segment" role="tablist">
        <button type="button" role="tab" aria-selected={status === "open"} onClick={() => setStatus("open")}>
          처리 대기
        </button>
        <button type="button" role="tab" aria-selected={status === "done"} onClick={() => setStatus("done")}>
          처리 완료
        </button>
      </div>
      {err && <p className="status error">{err}</p>}
      {q.isLoading && <p className="muted">불러오는 중...</p>}
      {q.isError && <p className="status error">신고 목록을 불러오지 못했어요.</p>}
      {q.data && q.data.items.length === 0 && (
        <Card>
          <EmptyState>{status === "open" ? "처리할 신고가 없어요." : "처리한 신고가 없어요."}</EmptyState>
        </Card>
      )}
      {q.data?.items.map((it) => {
        const page = it.board === "review" ? "board-review.html" : "board-free.html";
        return (
          <Card key={`${it.targetType}-${it.targetId}`}>
            <div className={styles.rqHead}>
              <span className="tag tag-blue">{it.targetType === "post" ? "글" : "댓글"}</span>
              <span>{it.board === "review" ? "방송 후기" : "자유게시판"}</span>
              <span className={styles.muted}>·</span>
              <span>
                작성자 <b>{it.authorName}</b>
              </span>
              <span className={styles.muted}>·</span>
              <span className={styles.rqCount}>신고 {it.count}명</span>
              <span className={styles.rqState}>
                {status === "done" ? (
                  <span className="tag">
                    {RESOLUTION[it.resolution ?? ""] || "처리됨"} · {fmtDateTime(it.resolvedAt)}
                  </span>
                ) : it.hidden ? (
                  <span className="tag tag-live">자동 숨김 중</span>
                ) : (
                  <span className="tag tag-gold">확인 필요</span>
                )}
              </span>
            </div>
            <div className={styles.rqText}>
              {it.targetType === "post" ? (
                <>
                  <b>{it.title}</b>
                  {it.body}
                </>
              ) : (
                <>
                  {it.body}
                  <span className={styles.rqSub}>글: {it.title}</span>
                </>
              )}
            </div>
            <div className={styles.rqReasons}>
              {Object.entries(it.reasons).map(([k, n]) => (
                <span key={k} className="tag">
                  {REASON[k] || k} {n}
                </span>
              ))}
            </div>
            {it.memos.map((m, i) => (
              <p key={i} className={styles.rqMemo}>
                “{m.memo}” — {m.reporterName}
              </p>
            ))}
            {(it.exists || status === "open") && (
              <div className={styles.rqActions}>
                {it.exists && (
                  <a className="btn btn-ghost btn-sm" href={`${import.meta.env.BASE_URL}${page}?post=${it.postId}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={14} aria-hidden="true" />
                    원문 보기
                  </a>
                )}
                {status === "open" && (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => resolve(it, it.hidden ? "restore" : "dismiss")}>
                      {it.hidden ? "숨김 해제(복구)" : "문제없음"}
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => resolve(it, "delete")}>
                      삭제
                    </button>
                  </>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}
