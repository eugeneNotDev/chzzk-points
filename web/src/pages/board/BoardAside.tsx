// 넓은 화면 게시판 옆 칸 — 글쓰기 · 다른 글 · 공지. (좁은 화면에선 안 보임)
import { Link, useNavigate } from "react-router-dom";
import { PenLine } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { startLogin, useAuth } from "../../lib/auth";
import { BOARD_CFG, type BoardKind } from "../../lib/board";
import { isBoardPostNew, useBoardPreview, useNoticePreview } from "../../lib/homeData";
import { relTime } from "../../lib/format";
import styles from "./Board.module.css";

export function BoardAside({ board, currentId }: { board: BoardKind; currentId?: number }) {
  const cfg = BOARD_CFG[board];
  const other: BoardKind = board === "free" ? "review" : "free";
  // 글 보기 중이면 같은 게시판의 다른 글, 목록이면 다른 게시판 새 글
  const listBoard = currentId ? board : other;
  const posts = useBoardPreview(listBoard, 6);
  const notices = useNoticePreview(3);
  const { isLoggedIn } = useAuth();
  const nav = useNavigate();
  const listCfg = BOARD_CFG[listBoard];
  return (
    <aside className="split-aside">
      <section className={styles.writeCard}>
        <b className={styles.writeTitle}>{cfg.name}</b>
        <p className={styles.writeDesc}>{cfg.sub}</p>
        <button type="button" className="btn btn-primary btn-block" onClick={() => (isLoggedIn ? nav(`${cfg.path}?write=1`) : startLogin())}>
          <PenLine size={17} aria-hidden="true" />
          {cfg.write}
        </button>
      </section>

      <Card title={currentId ? "이 게시판 다른 글" : `${listCfg.name} 새 글`} moreTo={listCfg.path} flush>
        {posts.isLoading && <p className={styles.asideEmpty}>불러오는 중…</p>}
        {posts.data?.length === 0 && <EmptyState>아직 글이 없어요.</EmptyState>}
        <ul className={styles.asideList}>
          {posts.data?.map((p) => (
            <li key={p.id}>
              <Link to={`${listCfg.path}?post=${p.id}`} className={`${styles.asideRow} ${p.id === currentId ? styles.asideOn : ""}`}>
                <span className={styles.asideTitle}>
                  {p.title}
                  {isBoardPostNew(p) && <span className={styles.newMark}>N</span>}
                </span>
                <span className={styles.asideMeta}>
                  {p.author} · {relTime(p.createdAt)}
                  {p.commentCount > 0 && <span className="num"> · 댓글 {p.commentCount}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="공지사항" moreTo="/notice.html" flush>
        <ul className={styles.asideList}>
          {notices.data?.map((n) => (
            <li key={n.id}>
              <Link to={`/notice.html?id=${n.id}`} className={styles.asideRow}>
                <span className={styles.asideTitle}>{n.title || "(제목 없음)"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </aside>
  );
}
