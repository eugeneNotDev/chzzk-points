import { LoadError } from "../../components/LoadError";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, EyeOff, Heart, Image as ImageIcon, MessageCircle, PenLine, Search, X } from "lucide-react";
import { Select, type SelectOption } from "../../components/Select";
import { Card, EmptyState } from "../../components/Card";
import { PageHead } from "../../components/ui";
import { startLogin, useAuth } from "../../lib/auth";
import { BOARD_CFG, fetchBoardPage, boardTime, isNewPost, loadSeen, type BoardKind, type ListPost } from "../../lib/board";
import { ReviewBanner } from "./ReviewBanner";
import { EmptySearch } from "./EmptySearch";
import { ActivityChip } from "./ActivityChip";
import styles from "./Board.module.css";
import { SkeletonList, useBloom } from "../../components/Skeleton";

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
    queryFn: async () => ({ ...(await fetchBoardPage(board, page, search, field)), pageSize: PAGE_SIZE }),
  });
  const goSearch = (text: string, f: Field) => {
    const sp = new URLSearchParams();
    if (text) {
      sp.set("q", text);
      if (f !== "title") sp.set("field", f);
    }
    const qs = sp.toString();
    nav(qs ? `${cfg.path}?${qs}` : cfg.path);
  };
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
  const bloom = useBloom(q.isLoading);
  const seen = loadSeen();
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  // 페이지 번호는 10개씩 묶음(1~10, 11~20 …) — 네이버 카페처럼. 폰에선 한 줄에 들어가게 5개씩.
  const group = useNarrow() ? 5 : 10;
  const start = Math.floor(page / group) * group;
  const end = Math.min(pages, start + group);

  return (
    <div className="page">
      <PageHead title={cfg.name} desc={cfg.sub} actions={<ActivityChip />} />
      {board === "review" && <ReviewBanner />}

      <Card flush>
        {q.isLoading && <SkeletonList rows={10} />}
        {q.isError && <LoadError what="글 목록" onRetry={() => q.refetch()} />}
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
        {q.data?.posts.length === 0 &&
          (search ? (
            <EmptySearch board={board} q={search} field={field} onSearch={goSearch} onClear={() => nav(cfg.path)} />
          ) : (
            <EmptyState>아직 글이 없어요. 첫 글을 남겨보세요!</EmptyState>
          ))}
        <ul className={`${styles.list} ${bloom}`}>
          {q.data?.posts.map((p) => {
            const veiled = p.hidden && !p.title;
            const preview = String(p.preview || "")
              .replace(/\[\[사진:\d*\]?\]?/g, " ")
              .replace(/\[\[[^\]]*$/, "")
              .replace(/\s+/g, " ")
              .trim();
            return (
              <li key={p.id}>
                <Link to={`${cfg.path}?post=${p.id}`} state={{ fromList: true }} className={styles.item}>
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
        <Pager page={page} start={start} end={end} pages={pages} go={(p) => nav(pageUrl(p))} />
        <BoardSearch
          board={board}
          search={search}
          field={field}
          onSearch={goSearch}
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

// Lucian UX/UI Prompt #043 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#043
// 늘어나는 페이지 번호 — 강조 알약이 가는 쪽 끝부터 먼저 늘어나고(0.32s) 반대쪽 끝이 늦게 따라와(0.55s 스프링, 0.08s 뒤)
// 고무줄처럼 도착. 좌우 방향키로도 옮김.
function Pager({ page, start, end, pages, go }: { page: number; start: number; end: number; pages: number; go: (p: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const ind = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null>(null);
  // 같은 묶음 안에서 옮길 때만 늘어나는 움직임, 처음·묶음이 바뀔 땐 바로 그 자리에(렌더 중에 정해야 클래스가 위치보다 먼저 붙음)
  // (데이터가 늦게 와서 다시 그려져도 방향이 유지되게 ref에 둠 — 클래스가 빠지면 움직이던 알약이 툭 끊김)
  const dirRef = useRef(0);
  const p0 = prev.current;
  if (p0 !== page) dirRef.current = p0 != null && p0 >= start && p0 < end ? Math.sign(page - p0) : 0;
  const dir = dirRef.current;
  useLayoutEffect(() => {
    const place = () => {
      const t = track.current;
      const b = t?.querySelector<HTMLButtonElement>('[aria-current="page"]');
      if (!t || !b || !ind.current) return;
      ind.current.style.setProperty("--l", `${b.offsetLeft}px`);
      ind.current.style.setProperty("--r", `${t.clientWidth - b.offsetLeft - b.offsetWidth}px`);
    };
    prev.current = page;
    place();
    const ro = new ResizeObserver(place);
    if (track.current) ro.observe(track.current);
    return () => ro.disconnect();
  }, [page, start, end]);
  const keyNav = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    const n = page + d;
    if (n < 0 || n >= pages) return;
    e.preventDefault();
    go(n);
  };
  return (
    <nav className={styles.pager} aria-label="페이지" onKeyDown={keyNav}>
      <button type="button" className={styles.pgArrow} disabled={start === 0} onClick={() => go(start - 1)} aria-label="이전 페이지 묶음">
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <div ref={track} className={`${styles.pgTrack} ${dir > 0 ? styles.goR : dir < 0 ? styles.goL : ""}`}>
        <span ref={ind} className={styles.pgInd} aria-hidden="true" />
        {Array.from({ length: Math.max(1, end - start) }, (_, i) => start + i).map((i) => (
          <button key={i} type="button" className={`${styles.pg} num`} aria-current={i === page ? "page" : undefined} aria-label={`${i + 1}페이지`} onClick={() => go(i)}>
            {i + 1}
          </button>
        ))}
      </div>
      <button type="button" className={styles.pgArrow} disabled={end >= pages} onClick={() => go(end)} aria-label="다음 페이지 묶음">
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}
