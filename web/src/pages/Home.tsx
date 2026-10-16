import { LoadError } from "../components/LoadError";
import { useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, CircleCheck, Gift, Image as ImageIcon, Play, Store, Ticket, type LucideIcon } from "lucide-react";
import { Card, EmptyState } from "../components/Card";
import { RankingList } from "../components/RankingList";
import { useAuth } from "../lib/auth";
import { BRAND_MARK_URL, CHZZK_CHANNEL_URL } from "../lib/config";
import { fmt, relTime, shortDate, WEEK_KO } from "../lib/format";
import { useFreeBox } from "../lib/freeBox";
import { isBoardPostNew, useBoardPreview, useNoticePreview, useRanking, useUpcomingSchedule } from "../lib/homeData";
import { isNoticeNew, useNoticeReadVersion } from "../lib/notices";
import { useBroadcastStatus } from "../lib/queries";
import { useTableRefetch } from "../lib/realtime";
import { PillPanel, PillTabs } from "../components/PillTabs";
import { useBloom } from "../components/Skeleton";
import { SkeletonList } from "../components/Skeleton";
import styles from "./Home.module.css";

// 넓은 모니터(3단 배치)에선 목록을 더 길게 보여줘서 아래쪽 빈 공간을 채움
const wideMq = typeof window !== "undefined" ? window.matchMedia("(min-width: 1440px)") : null;
function useWide() {
  return useSyncExternalStore(
    (cb) => {
      wideMq?.addEventListener("change", cb);
      return () => wideMq?.removeEventListener("change", cb);
    },
    () => !!wideMq?.matches,
  );
}

function dayLabel(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return `${m}/${d} (${WEEK_KO[new Date(y, m - 1, d).getDay()]})`;
}

function LiveHero() {
  const status = useBroadcastStatus();
  const sched = useUpcomingSchedule();
  const live = status.data?.isLive === true;
  const today = sched.data?.today;
  const next = sched.data?.next;

  let kicker: string;
  let headline: string;
  let sub: string | null = null;
  // 스케줄의 방송 내용(memo) — 예: 방제 "양치기 소년의 이야기" + 내용 "저스트 채팅 & 카페 탐방"
  let memo: string | null = null;
  if (status.isLoading) {
    kicker = "방송 상태 확인 중";
    headline = "";
  } else if (live) {
    kicker = "지금 방송 중";
    headline = status.data?.liveTitle || "지금 방송 중이에요";
    sub = "출석체크랑 방송 코드는 방송 중에만 받을 수 있어요.";
  } else if (today && today.kind === "live") {
    kicker = "오늘 방송";
    headline = today.start_time ? `오늘 ${today.start_time}에 만나요` : "오늘 방송이 있어요";
    sub = today.title;
    memo = today.memo;
  } else if (today) {
    kicker = "오늘은 쉬는 날";
    headline = "오늘은 방송이 없어요";
    sub = next ? `다음 방송 · ${dayLabel(next.day)} ${next.start_time ?? ""} ${next.title ?? ""}` : null;
  } else if (next) {
    kicker = "다음 방송";
    headline = `${dayLabel(next.day)} ${next.start_time ?? ""}`.trim();
    sub = next.title;
    memo = next.memo;
  } else {
    kicker = "방송 준비 중";
    headline = "방송이 시작되면 알려드릴게요";
  }

  return (
    <section className={styles.hero}>
      <div className={styles.heroArt}>
        <img src={BRAND_MARK_URL} alt="" />
        {live && (
          <span className={`${styles.liveBadge} num`}>
            <span aria-hidden="true" />
            LIVE
          </span>
        )}
      </div>
      <div className={styles.heroBody}>
        <span className={`${styles.kicker} ${live ? styles.kickerLive : ""}`}>{kicker}</span>
        {status.isLoading ? <span className="skeleton" style={{ height: 32, width: "70%" }} /> : <h2 className={styles.headline}>{headline}</h2>}
        {sub && <p className={styles.sub}>{sub}</p>}
        {memo && <p className={styles.memo}>{memo}</p>}
        <div className={styles.heroActions}>
          <a href={CHZZK_CHANNEL_URL} target="_blank" rel="noopener" className={styles.btnPrimary}>
            <Play size={16} fill="currentColor" aria-hidden="true" />
            치지직에서 보기
          </a>
          <Link to="/schedule.html" className={styles.btnSecondary}>
            <CalendarDays size={16} aria-hidden="true" />
            방송 스케줄
          </Link>
        </div>
      </div>
    </section>
  );
}

function QuickTile({ to, icon: Icon, tone, title, desc }: { to: string; icon: LucideIcon; tone: string; title: string; desc: React.ReactNode }) {
  return (
    <Link to={to} className={styles.tile}>
      <span className={`${styles.tileIcon} ${styles[tone]}`}>
        <Icon size={20} aria-hidden="true" />
      </span>
      <span className={styles.tileText}>
        <span className={styles.tileTitle}>{title}</span>
        <span className={styles.tileDesc}>{desc}</span>
      </span>
    </Link>
  );
}

function QuickTiles() {
  const { isLoggedIn } = useAuth();
  const box = useFreeBox();
  const boxDesc = !isLoggedIn ? "하루 한 번 공짜 상자" : box.data?.openedToday ? `오늘 +${fmt(box.data.todayPoints ?? 0)}P 받았어요` : "오늘 상자가 도착했어요";
  return (
    <section aria-label="바로가기" className={styles.tiles}>
      <QuickTile to="/attendance.html" icon={CircleCheck} tone="green" title="출석체크" desc={<>방송 중에 출석하고 <b className={styles.plus}>+100P</b></>} />
      <QuickTile to="/freebox.html" icon={Gift} tone="pink" title="무료 뽑기" desc={boxDesc} />
      <QuickTile to="/attendance.html" icon={Ticket} tone="blue" title="방송 코드" desc="방송 화면 코드 입력하기" />
      <QuickTile to="/shop.html" icon={Store} tone="gold" title="포인트 상점" desc="칭호랑 상품 둘러보기" />
    </section>
  );
}

function NoticePreview() {
  const q = useNoticePreview(useWide() ? 8 : 5);
  const bloomN = useBloom(q.isLoading);
  useNoticeReadVersion();
  useTableRefetch("notices", [["notices"]]);
  return (
    <Card title="공지사항" moreTo="/notice.html" flush className={styles.notices}>
      {q.isLoading && <SkeletonList rows={5} variant="row" />}
      {q.isError && <LoadError what="공지사항" onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <EmptyState>등록된 공지사항이 없어요.</EmptyState>}
      <div className={bloomN}>
      {q.data?.map((n) => (
        <Link key={n.id} to={`/notice.html?id=${n.id}`} className={styles.row}>
          {n.pinned_at && <span className={`${styles.tag} ${styles.tagAccent}`}>고정</span>}
          {!n.pinned_at && isNoticeNew(n) && <span className={`${styles.tag} ${styles.tagLive}`}>NEW</span>}
          <span className={styles.rowTitle}>{n.title || "(제목 없음)"}</span>
          <span className={`${styles.rowMeta} num`}>{shortDate(n.created_at)}</span>
        </Link>
      ))}
      </div>
    </Card>
  );
}

function RankingPreview() {
  const n = useWide() ? 8 : 5;
  const q = useRanking(n);
  const bloomR = useBloom(q.isLoading);
  useTableRefetch("ranking_pings", [["ranking"]], { event: "INSERT", minIntervalMs: 8000, settleMs: 800 });
  return (
    <Card title="포인트 랭킹" moreTo="/ranking.html" flush className={styles.ranking}>
      {q.isLoading && <SkeletonList rows={n} variant="rank" />}
      {q.isError && <LoadError what="랭킹" onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <EmptyState>아직 랭킹에 등록된 유저가 없어요.</EmptyState>}
      {q.data && <RankingList rows={q.data} className={bloomR} />}
    </Card>
  );
}

const BOARD_TABS = [
  { id: "all", label: "전체" },
  { id: "free", label: "자유" },
  { id: "review", label: "후기" },
] as const;

function BoardPreview() {
  const [tab, setTab] = useState<(typeof BOARD_TABS)[number]["id"]>("all");
  const q = useBoardPreview(tab, useWide() ? 8 : 5);
  return (
    <Card
      title="게시판 새 글"
      flush
      className={styles.board}
      moreTo={tab === "review" ? "/board-review.html" : "/board-free.html"}
      extra={
        <PillTabs size="sm" label="게시판 고르기" value={tab} onChange={setTab} options={BOARD_TABS.map((t) => ({ value: t.id, label: t.label }))} />
      }
    >
      {q.isLoading && <SkeletonList rows={5} variant="row" />}
      {q.isError && <LoadError what="게시판 글" onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <EmptyState>아직 게시판에 글이 없어요.</EmptyState>}
      <PillPanel index={BOARD_TABS.findIndex((t) => t.id === tab)}>
      {q.data?.map((p) => (
        <Link key={`${p.board}-${p.id}`} to={`/${p.board === "review" ? "board-review" : "board-free"}.html?post=${p.id}`} className={styles.row}>
          <span className={`${styles.boardChip} ${p.board === "review" ? styles.chipReview : styles.chipFree}`}>{p.board === "review" ? "후기" : "자유"}</span>
          <span className={styles.rowTitle}>
            {p.title}
            {p.hasImages && <ImageIcon size={14} className={styles.inlineIcon} aria-label="사진 있음" />}
            {isBoardPostNew(p) && <span className={styles.newDot}>N</span>}
            {p.commentCount > 0 && <span className={`${styles.cc} num`}>[{p.commentCount}]</span>}
          </span>
          <span className={styles.rowAuthor}>{p.author}</span>
          <span className={styles.rowMeta}>{relTime(p.createdAt)}</span>
        </Link>
      ))}
      </PillPanel>
    </Card>
  );
}

export default function Home() {
  return (
    // 화면 너비에 따라 배치가 바뀜(Home.module.css .dash) — 넓은 모니터에선 3단으로 빈 공간 없이
    <div className={styles.dash}>
      <LiveHero />
      <QuickTiles />
      <NoticePreview />
      <RankingPreview />
      <BoardPreview />
    </div>
  );
}

