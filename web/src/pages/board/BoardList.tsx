import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { EyeOff, Heart, Image as ImageIcon, MessageCircle, PenLine } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { PageHead } from "../../components/ui";
import { TitleBadge } from "../../components/TitleBadge";
import { startLogin, useAuth } from "../../lib/auth";
import { BOARD_CFG, boardCall, boardTime, isNewPost, loadSeen, type BoardKind, type ListPost } from "../../lib/board";
import { ReviewBanner } from "./ReviewBanner";
import styles from "./Board.module.css";

export function Who({ name, badge, mine }: { name: string; badge: ListPost["badge"]; mine?: boolean }) {
  return (
    <span className={`${styles.who} ${mine ? styles.me : ""}`}>
      {badge && <TitleBadge name={badge.name} value={badge.color} />}
      {name}
    </span>
  );
}

export function AdminChip({ adminName, shown }: { adminName: string | null; shown: string | null }) {
  if (!adminName) return null;
  return <span className={styles.admChip}>일반 사용자에겐 {shown}</span>;
}

export function BoardList({ board, page }: { board: BoardKind; page: number }) {
  const cfg = BOARD_CFG[board];
  const { isLoggedIn, token } = useAuth();
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ["board", "list", board, page, token],
    placeholderData: (p) => p,
    queryFn: () => boardCall<{ posts: ListPost[]; total: number; pageSize: number }>({ action: "list", board, page }),
  });
  const seen = loadSeen();
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const start = Math.max(0, Math.min(page - 2, pages - 5));
  const end = Math.min(pages, start + 5);

  return (
    <div className="page">
      <PageHead
        title={cfg.name}
        desc={cfg.sub}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => (isLoggedIn ? nav(`${cfg.path}?write=1`) : startLogin())}>
            <PenLine size={18} aria-hidden="true" />
            {cfg.write}
          </button>
        }
      />
      {board === "review" && <ReviewBanner />}

      <Card flush>
        {q.isLoading && <p className="muted" style={{ padding: 16 }}>불러오는 중...</p>}
        {q.isError && <EmptyState>글 목록을 불러오지 못했어요.</EmptyState>}
        {q.data?.posts.length === 0 && <EmptyState>아직 글이 없어요. 첫 글을 남겨보세요!</EmptyState>}
        <ul className={styles.list}>
          {q.data?.posts.map((p) => {
            const veiled = p.hidden && !p.title;
            const preview = String(p.preview || "")
              .replace(/\[\[사진:\d*\]?\]?/g, " ")
              .replace(/\[\[[^\]]*$/, "")
              .replace(/\s+/g, " ")
              .trim();
            return (
              <li key={p.id}>
                <Link to={`${cfg.path}?post=${p.id}`} className={styles.item}>
                  <span className={styles.itemTitle}>
                    {veiled ? (
                      <span className={styles.veil}>
                        <EyeOff size={14} aria-hidden="true" /> 신고가 누적되어 가려진 글이에요
                      </span>
                    ) : (
                      <>
                        <span className={styles.tt}>{p.title}</span>
                        {p.hasImages && <ImageIcon size={14} className={styles.ico} aria-label="사진 있음" />}
                        {isNewPost(p.createdAt, p.id, seen, p.mine) && <span className={styles.newMark}>N</span>}
                        {p.broadcast && <span className="tag">{p.broadcast} 방송</span>}
                        {p.paid && <span className="tag tag-accent">+100P</span>}
                        {p.hidden && <span className="tag tag-live">자동 숨김 중</span>}
                      </>
                    )}
                  </span>
                  <span className={styles.preview}>{veiled ? "운영자가 확인 중이에요." : preview}</span>
                  <span className={styles.meta}>
                    <Who name={p.adminName || p.author} badge={p.badge} mine={p.mine} />
                    <span className={styles.dot}>·</span>
                    <span>{boardTime(p.createdAt)}</span>
                    <AdminChip adminName={p.adminName} shown={p.author} />
                    <span className={styles.counts}>
                      {p.likeCount > 0 && (
                        <span>
                          <Heart size={13} aria-hidden="true" /> {p.likeCount}
                        </span>
                      )}
                      <span>
                        <MessageCircle size={13} aria-hidden="true" /> {p.commentCount}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        {pages > 1 && (
          <nav className="pagination" aria-label="페이지">
            <button type="button" disabled={page === 0} onClick={() => nav(page - 1 > 0 ? `${cfg.path}?page=${page}` : cfg.path)}>
              이전
            </button>
            {Array.from({ length: end - start }, (_, i) => start + i).map((i) => (
              <button key={i} type="button" aria-current={i === page ? "page" : undefined} onClick={() => nav(i > 0 ? `${cfg.path}?page=${i + 1}` : cfg.path)}>
                {i + 1}
              </button>
            ))}
            <button type="button" disabled={page >= pages - 1} onClick={() => nav(`${cfg.path}?page=${page + 2}`)}>
              다음
            </button>
          </nav>
        )}
      </Card>
    </div>
  );
}
