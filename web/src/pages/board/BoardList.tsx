import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, EyeOff, Heart, Image as ImageIcon, MessageCircle, PenLine, Search, X } from "lucide-react";
import { Select, type SelectOption } from "../../components/Select";
import { Card, EmptyState } from "../../components/Card";
import { PageHead } from "../../components/ui";
import { startLogin, useAuth } from "../../lib/auth";
import { BOARD_CFG, boardCall, boardTime, isNewPost, loadSeen, type BoardKind, type ListPost } from "../../lib/board";
import { ReviewBanner } from "./ReviewBanner";
import styles from "./Board.module.css";
import { SkeletonList } from "../../components/Skeleton";

// 작성자 이름 — 게시판에선 칭호를 안 붙임(칭호는 랭킹에서만). badge는 서버가 주지만 일부러 안 씀.
export function Who({ name, mine }: { name: string; badge?: ListPost["badge"]; mine?: boolean }) {
  return <span className={`${styles.who} ${mine ? styles.me : ""}`}>{name}</span>;
}

export function AdminChip({ adminName, shown }: { adminName: string | null; shown: string | null }) {
  if (!adminName) return null;
  return <span className={styles.admChip}>일반 사용자에겐 {shown}</span>;
}

type Field = "title" | "all" | "author";

const narrowMq = typeof window !== "undefined" ? window.matchMedia("(max-width: 599px)") : null;
function useNarrow() {
  return useSyncExternalStore(
    (cb) => {
      narrowMq?.addEventListener("change", cb);
      return () => narrowMq?.removeEventListener("change", cb);
    },
    () => !!narrowMq?.matches,
  );
}
const PAGE_SIZE = 10;

export function BoardList({ board, page, q: search, field }: { board: BoardKind; page: number; q: string; field: Field }) {
  const cfg = BOARD_CFG[board];
  const { isLoggedIn, token } = useAuth();
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ["board", "list", board, page, search, field, token],
    placeholderData: (p) => p,
    queryFn: async () => {
      type R = { posts: ListPost[]; total: number; pageSize: number };
      const extra = search ? { q: search, field } : {};
      const r = await boardCall<R>({ action: "list", board, page, size: PAGE_SIZE, ...extra });
      if (r.pageSize === PAGE_SIZE) return r;
      // 서버 함수가 아직 예전 버전(한 페이지 20개 고정)이면, 그 안에서 10개씩 잘라서 보여줌 — 배포 전후 모두 10개씩.
      const ps = r.pageSize || 20;
      const serverPage = Math.floor((page * PAGE_SIZE) / ps);
      const r2 = serverPage === page ? r : await boardCall<R>({ action: "list", board, page: serverPage, ...extra });
      const offset = page * PAGE_SIZE - serverPage * ps;
      return { posts: r2.posts.slice(offset, offset + PAGE_SIZE), total: r2.total, pageSize: PAGE_SIZE };
    },
  });
  // 페이지 이동 주소 — 검색 중이면 검색어를 유지
  const pageUrl = (p: number) => {
    const sp = new URLSearchParams();
    if (search) {
      sp.set("q", search);
      if (field !== "title") sp.set("field", field);
    }
    if (p > 0) sp.set("page", String(p + 1));
    const qs = sp.toString();
    return qs ? `${cfg.path}?${qs}` : cfg.path;
  };
  const seen = loadSeen();
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  // 페이지 번호는 10개씩 묶음(1~10, 11~20 …) — 네이버 카페처럼. 폰에선 한 줄에 들어가게 5개씩.
  const group = useNarrow() ? 5 : 10;
  const start = Math.floor(page / group) * group;
  const end = Math.min(pages, start + group);

  return (
    <div className="page">
      <PageHead title={cfg.name} desc={cfg.sub} />
      {board === "review" && <ReviewBanner />}

      <Card flush>
        {q.isLoading && <SkeletonList rows={6} />}
        {q.isError && <EmptyState>글 목록을 불러오지 못했어요.</EmptyState>}
        {search && q.data && (
          <div className={styles.searchInfo}>
            <span>
              <b>"{search}"</b> 검색 결과 <span className="num">{q.data.total}</span>건
            </span>
            <Link to={cfg.path} className={styles.clearSearch}>
              <X size={14} aria-hidden="true" /> 검색 해제
            </Link>
          </div>
        )}
        {q.data?.posts.length === 0 && <EmptyState>{search ? "검색 결과가 없어요." : "아직 글이 없어요. 첫 글을 남겨보세요!"}</EmptyState>}
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
      </Card>

      {/* 목록 바로 아래 오른쪽: 글 수 · 글쓰기 */}
      <div className={styles.listBar}>
        {q.data && (
          <span className={styles.totalText}>
            {search ? "검색 결과" : "전체"} <b className="num">{q.data.total.toLocaleString("ko-KR")}</b>개의 글
          </span>
        )}
        <button type="button" className="btn btn-primary" onClick={() => (isLoggedIn ? nav(`${cfg.path}?write=1`) : startLogin())}>
          <PenLine size={17} aria-hidden="true" />
          {cfg.write}
        </button>
      </div>

      {/* 따로 떨어진 칸: 페이지 번호 + 검색 */}
      <section className={styles.bottomBox} aria-label="페이지 이동·검색">
        <nav className={styles.pager} aria-label="페이지">
          <button type="button" className={styles.pgArrow} disabled={start === 0} onClick={() => nav(pageUrl(start - 1))} aria-label="이전 페이지 묶음">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          {Array.from({ length: Math.max(1, end - start) }, (_, i) => start + i).map((i) => (
            <button key={i} type="button" className={`${styles.pg} num`} aria-current={i === page ? "page" : undefined} onClick={() => nav(pageUrl(i))}>
              {i + 1}
            </button>
          ))}
          <button type="button" className={styles.pgArrow} disabled={end >= pages} onClick={() => nav(pageUrl(end))} aria-label="다음 페이지 묶음">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
        <BoardSearch
          board={board}
          search={search}
          field={field}
          onSearch={(text, f) => {
            const sp = new URLSearchParams();
            if (text) {
              sp.set("q", text);
              if (f !== "title") sp.set("field", f);
            }
            const qs = sp.toString();
            nav(qs ? `${cfg.path}?${qs}` : cfg.path);
          }}
        />
      </section>
    </div>
  );
}

// 검색 — [검색 범위 ▾][검색어 🔍] (가운데 정렬)
function BoardSearch({ board, search, field, onSearch }: { board: BoardKind; search: string; field: Field; onSearch: (q: string, field: Field) => void }) {
  const [text, setText] = useState(search);
  const [f, setF] = useState<Field>(field);
  useEffect(() => {
    setText(search);
    setF(field);
  }, [search, field]);
  const options: SelectOption<Field>[] = [
    { value: "title", label: "제목" },
    { value: "all", label: "제목+내용" },
    ...(board === "review" ? [{ value: "author" as Field, label: "작성자" }] : []),
  ];
  return (
    <form
      className={styles.searchForm}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(text.trim(), f);
      }}
    >
      <Select value={f} options={options} onChange={setF} label="검색 범위" className={styles.searchField} up />
      <div className={styles.searchBox}>
        <input className={styles.searchInput} maxLength={40} placeholder="검색어를 입력하세요" value={text} onChange={(e) => setText(e.target.value)} aria-label="검색어" />
        <button type="submit" className={styles.searchBtn} aria-label="검색">
          <Search size={18} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
