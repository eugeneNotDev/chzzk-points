// 마이페이지 — 포인트 내역, 내 게시판 활동.
import { SkeletonList } from "../../components/Skeleton";
import { SkelInline } from "../../components/Skeleton";
import { LoadError } from "../../components/LoadError";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, EmptyState } from "../../components/Card";
import { Pagination } from "../../components/Pagination";
import { apiFetch, useAuth } from "../../lib/auth";
import { API } from "../../lib/config";
import { fmt, relTime } from "../../lib/format";
import { PillTabs } from "../../components/PillTabs";
import styles from "./MyPage.module.css";

type LogEntry = { id: number; amount: number; reason: string; createdAt: string; balanceAfter?: number };
type Activity = {
  posts: { id: number; board: "free" | "review"; title: string; commentCount: number; paid: boolean; hidden?: boolean; broadcast: string | null; createdAt: string }[];
  comments: { postId: number; board: "free" | "review" | null; body: string; hidden: boolean; postTitle: string | null; createdAt: string }[];
  postCount: number;
  commentCount: number;
  rewardTotal: number;
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export function PointsLog() {
  const { channelId } = useAuth();
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["points-log", channelId, page],
    placeholderData: (prev) => prev,
    queryFn: () => apiFetch<{ entries: LogEntry[]; page: number; totalPages: number }>(`${API.me}?action=points-log&page=${page}`),
  });
  return (
    <Card title="포인트 내역" flush>
      <p className={`muted ${styles.fs13} ${styles.p_0_12_8}`}>
        출석·상점·미니게임·관리자 지급/차감 내역을 최신순으로 보여줘요.
      </p>
      {q.isLoading && <SkeletonList rows={5} variant="log" />}
      {q.isError && <LoadError what="포인트 내역" onRetry={() => q.refetch()} />}
      {q.data?.entries.length === 0 && <EmptyState>아직 내역이 없어요.</EmptyState>}
      <ul className={styles.log}>
        {q.data?.entries.map((e) => (
          <li key={e.id}>
            <div className={styles.logMain}>
              <span className={styles.logReason}>{e.reason}</span>
              <span className={styles.logTime}>{fmtDateTime(e.createdAt)}</span>
            </div>
            <div className={styles.logAmt}>
              <b className={`num ${e.amount > 0 ? styles.plus : styles.minus}`}>
                {e.amount > 0 ? "+" : ""}
                {fmt(e.amount)}P
              </b>
              {typeof e.balanceAfter === "number" && <span className="num muted">잔액 {fmt(e.balanceAfter)}P</span>}
            </div>
          </li>
        ))}
      </ul>
      {q.data && <Pagination page={q.data.page} totalPages={q.data.totalPages} onChange={setPage} />}
    </Card>
  );
}

export function MyActivity() {
  const { channelId } = useAuth();
  const [tab, setTab] = useState<"posts" | "comments">("posts");
  const q = useQuery({
    queryKey: ["board", "my-activity", channelId],
    queryFn: () => apiFetch<Activity>(API.board, { body: { action: "my-activity" } }),
  });
  const d = q.data;
  const boardPath = (b: string | null) => (b === "review" ? "/board-review.html" : "/board-free.html");

  return (
    <Card
      title="내 활동"
      flush
      extra={
        <PillTabs
          size="sm"
          label="내 활동 종류"
          className={styles.maTabs}
          value={tab}
          onChange={setTab}
          options={[
            { value: "posts", label: `내 글 ${d?.postCount ?? ""}` },
            { value: "comments", label: `내 댓글 ${d?.commentCount ?? ""}` },
          ]}
        />
      }
    >
      <div className={styles.maStats}>
        <div>
          <span className="muted">쓴 글</span>
          <b className="num">{d ? fmt(d.postCount) : <SkelInline w={30} h={18} />}</b>
        </div>
        <div>
          <span className="muted">쓴 댓글</span>
          <b className="num">{d ? fmt(d.commentCount) : <SkelInline w={30} h={18} />}</b>
        </div>
        <div>
          <span className="muted">후기 보상</span>
          <b className="num">{d ? `+${fmt(d.rewardTotal)}P` : <SkelInline w={56} h={18} />}</b>
        </div>
      </div>
      {q.isError && <LoadError what="내 활동" onRetry={() => q.refetch()} />}
      {!d && !q.isError && <SkeletonList rows={3} variant="row" />}
      {d && tab === "posts" && d.posts.length === 0 && <EmptyState>아직 쓴 글이 없어요.</EmptyState>}
      {d && tab === "comments" && d.comments.length === 0 && <EmptyState>아직 쓴 댓글이 없어요.</EmptyState>}
      {d && tab === "posts" &&
        d.posts.map((p) => (
          <Link key={p.id} to={`${boardPath(p.board)}?post=${p.id}`} className={styles.maItem}>
            <span className={`tag ${p.board === "review" ? "tag-gold" : "tag-blue"}`}>{p.board === "review" ? "후기" : "자유"}</span>
            <span className={styles.maMain}>
              <span className={styles.maTitle}>
                {p.title}
                {p.commentCount > 0 && <span className={styles.cc}>[{p.commentCount}]</span>}
                {p.paid && <span className="tag tag-accent">+100P</span>}
                {p.board === "free" && <span className="tag">익명으로 올림</span>}
                {p.hidden && <span className="tag tag-live">신고로 가려짐</span>}
              </span>
              <span className={`muted ${styles.fs12}`}>
                {p.broadcast ? `${p.broadcast} 방송 · ` : ""}
                {relTime(p.createdAt)}
              </span>
            </span>
          </Link>
        ))}
      {d && tab === "comments" &&
        d.comments.map((c, i) => (
          <Link key={i} to={`${boardPath(c.board)}?post=${c.postId}`} className={styles.maItem}>
            {c.board && <span className={`tag ${c.board === "review" ? "tag-gold" : "tag-blue"}`}>{c.board === "review" ? "후기" : "자유"}</span>}
            <span className={styles.maMain}>
              <span className={styles.maTitle}>
                {c.body}
                {c.hidden && <span className="tag tag-live">신고로 가려짐</span>}
              </span>
              <span className={`muted ${styles.fs12}`}>
                {c.postTitle === null ? "삭제된 글" : c.postTitle === "" ? "가려진 글" : `글: ${c.postTitle}`} · {relTime(c.createdAt)}
              </span>
            </span>
          </Link>
        ))}
      <p className={`muted ${styles.fs12} ${styles.p_10_12_6}`}>
        익명으로 쓴 글도 여기선 나에게만 보여요. 누르면 그 글로 이동해요.
      </p>
    </Card>
  );
}
