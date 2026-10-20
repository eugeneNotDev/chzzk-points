// 포인트 랭킹 — 명예의 전당(매달 1위) + 상위 50명. 포인트가 움직이면 실시간으로 다시 불러옴.
import { SkelInline } from "../components/Skeleton";
import { LoadError } from "../components/LoadError";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Medal, TrendingUp } from "lucide-react";
import { Card, EmptyState } from "../components/Card";
import { PageHead } from "../components/ui";
import { RankingList } from "../components/RankingList";
import { SpecialTitleLine } from "../components/TitleBadge";
import { PlateStars, TitleTag, useTitlePlate } from "../components/TitlePlate";
import { Laurel } from "../components/Laurel";
import { useAuth } from "../lib/auth";
import { isMyRankingRow, useRanking, type RankingRow } from "../lib/homeData";
import { useMe } from "../lib/queries";
import { SPLIT_QUERY, useMedia } from "../lib/useMedia";
import { useTableRefetch } from "../lib/realtime";
import { supabase } from "../lib/supabase";
import { fmt } from "../lib/format";
import { useAdminUserModal } from "./admin/useAdminUserModal";
import styles from "./Ranking.module.css";
import { SkeletonList, useBloom } from "../components/Skeleton";

type Hof = { month: string; channel_name: string | null; points: number; is_public: boolean };

function HallOfFame() {
  const q = useQuery({
    queryKey: ["hall-of-fame"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("hall_of_fame");
      if (error) throw error;
      return (data ?? []) as Hof[];
    },
  });
  return (
    <Card title="명예의 전당" extra={<span className={`muted ${styles.fs13}`}>매달 1위 기록</span>} className={styles.hofWrap}>
      {q.isError && <LoadError what="명예의 전당" onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <EmptyState>매달 1위가 여기에 기록돼요</EmptyState>}
      {!!q.data?.length && (
        <div className={styles.hof}>
          {q.data.map((r, i) => {
            const [y, m] = String(r.month).split("-").map(Number);
            return (
              <div key={r.month} className={`${styles.hofCard} ${i === 0 ? styles.latest : ""}`}>
                <Crown size={22} className={styles.crown} aria-hidden="true" />
                <span className={styles.hofMonth}>
                  {y}년 {m}월
                </span>
                <span className={styles.hofName}>{r.is_public && r.channel_name ? r.channel_name : <span className="muted">비공개</span>}</span>
                <span className={`${styles.hofPts} num`}>{fmt(Number(r.points))}P</span>
              </div>
            );
          })}
        </div>
      )}
      <p className={styles.note}>매달 1일 0시에 지난달 말 보유 포인트 1위가 기록돼요. 랭킹 비공개 상태면 이름이 가려져요.</p>
    </Card>
  );
}

// 1~3위 시상대 — 가운데가 1위(제일 높음), 왼쪽 2위, 오른쪽 3위.
// 칸이 둘로 나뉨: 윗칸(닉네임) = 장착 칭호 색·테두리(없으면 금·은·동), 아랫칸(N위 단상) = 언제나 순위 색.
// 왕관·메달·1위 점수도 순위 색.
function Podium({ rows, onAdminClick }: { rows: RankingRow[]; onAdminClick?: (channelId: string) => void }) {
  const order = [1, 0, 2].filter((i) => rows[i]);
  return (
    <section className={styles.podium} aria-label="1~3위">
      {order.map((i) => (
        <PodiumStep key={rows[i].channel_id + i} r={rows[i]} i={i} onAdminClick={onAdminClick} />
      ))}
    </section>
  );
}

const STAR_PATH = "M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6z";

export function PodiumStep({ r, i, onAdminClick }: { r: RankingRow; i: number; onAdminClick?: (channelId: string) => void }) {
  const { channelId } = useAuth();
  const plate = useTitlePlate(r.shop_title_name ? r.shop_title_color : null);
  const hidden = r.is_public === false && !r.admin_view;
  const me = isMyRankingRow(r, channelId);
  return (
    <div
      className={`${styles.step} ${styles[`p${i + 1}`]} ${r.admin_view ? styles.stepClick : ""}`}
      onClick={r.admin_view && r.channel_id ? () => onAdminClick?.(r.channel_id) : undefined}
    >
      {/* 내 칸 초록 테두리는 칭호가 없을 때만(칭호 테두리를 가리지 않게 — 랭킹 목록과 같음, "(나)"로 구분) */}
      <div className={`${styles.stepTop} ${me && !plate ? styles.stepMe : ""} ${plate ? `${plate.className} tp-card` : ""}`} style={plate?.style}>
        {plate?.star && <PlateStars />}
        <span className={styles.medal}>{i === 0 ? <Crown size={22} aria-hidden="true" /> : <Medal size={18} aria-hidden="true" />}</span>
        <div className={styles.stepName}>
          {!hidden && <SpecialTitleLine list={r.special_titles} />}
          <b className={hidden ? "muted" : ""}>
            {r.channel_name || "(이름 없음)"}
            {me && " (나)"}
          </b>
          {plate && r.shop_title_name && <TitleTag name={r.shop_title_name} plate={plate} dot={false} />}
        </div>
        <span className={`${styles.stepPts} num`}>
          {fmt(r.total_points)}
          <small>P</small>
        </span>
      </div>
      <span className={styles.stepBase} aria-hidden="true">
        {i === 0 &&
          ["a", "b", "c"].map((k) => (
            <svg key={k} className={`${styles.twinkle} ${styles[`tw${k}`]}`} viewBox="0 0 24 24">
              <path fill="currentColor" d={STAR_PATH} />
            </svg>
          ))}
        <Laurel className={styles.laurel} />
        <span className={`${styles.baseNo} num`}>
          {i + 1}
          <small>위</small>
        </span>
        <Laurel flip className={styles.laurel} />
      </span>
    </div>
  );
}

// 내 순위 — 몇 위인지, 바로 윗사람까지 몇 포인트 남았는지
function MyRank({ rows }: { rows: RankingRow[] }) {
  const { isLoggedIn, channelId } = useAuth();
  const me = useMe();
  if (!isLoggedIn) return null;
  const idx = rows.findIndex((r) => isMyRankingRow(r, channelId));
  const balance = idx >= 0 ? rows[idx].total_points : me.data?.balance;
  const gap = idx > 0 ? rows[idx - 1].total_points - rows[idx].total_points : idx < 0 && rows.length ? rows[rows.length - 1].total_points - (balance ?? 0) : 0;
  return (
    <Card title="내 순위" className={styles.myCard} tone="feature">
      <div className={styles.myRow}>
        <span className={`${styles.myRank} num`}>{idx >= 0 ? <>{idx + 1}<small>위</small></> : <small>{rows.length}위 밖</small>}</span>
        <span className={`${styles.myPts} num`}>
          {balance != null ? fmt(balance) : <SkelInline w={90} h={20} />}
          <small>P</small>
        </span>
      </div>
      {idx === 0 ? (
        <p className={styles.myHint}>지금 1위예요!</p>
      ) : (
        gap > 0 && (
          <p className={styles.myHint}>
            <TrendingUp size={15} aria-hidden="true" />
            {idx > 0 ? `${idx}위까지` : `${rows.length}위 안까지`} <b className="num">{fmt(gap + 1)}P</b> 남았어요
          </p>
        )
      )}
    </Card>
  );
}

export default function Ranking() {
  const q = useRanking(50);
  const qc = useQueryClient();
  const adminModal = useAdminUserModal(() => qc.invalidateQueries({ queryKey: ["ranking"] }));
  useTableRefetch("ranking_pings", [["ranking"]], { event: "INSERT", minIntervalMs: 8000, settleMs: 800 });
  const rows = q.data ?? [];
  const bloom = useBloom(q.isLoading);
  const wide = useMedia(SPLIT_QUERY); // 좁은 화면에선 내 순위를 목록 위로

  return (
    <div className="page">
      <PageHead title="포인트 랭킹" desc="보유 포인트 상위 50명이에요. 마이페이지에서 랭킹 공개 여부를 바꿀 수 있어요." />
      {q.isLoading && <SkeletonList rows={10} variant="rank" />}
      {q.isError && (
        <Card>
          <LoadError what="랭킹" onRetry={() => q.refetch()} />
        </Card>
      )}
      {q.data?.length === 0 && (
        <Card>
          <EmptyState>아직 랭킹에 등록된 유저가 없어요.</EmptyState>
        </Card>
      )}
      {rows.length > 0 && (
        <>
          <div className={bloom}>
            <Podium rows={rows} onAdminClick={adminModal.open} />
          </div>
          <div className="split">
            <div className="split-main">
              {!wide && <MyRank rows={rows} />}
              {rows.length > 3 && (
                <Card flush title="4위부터">
                  <RankingList rows={rows.slice(3)} start={3} onAdminClick={adminModal.open} className={bloom} />
                </Card>
              )}
            </div>
            <aside className="split-aside">
              {wide && <MyRank rows={rows} />}
              <HallOfFame />
            </aside>
          </div>
        </>
      )}
      {adminModal.element}
    </div>
  );
}
