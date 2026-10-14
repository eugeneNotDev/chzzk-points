// 포인트 랭킹 — 명예의 전당(매달 1위) + 상위 50명. 포인트가 움직이면 실시간으로 다시 불러옴.
import { useQuery } from "@tanstack/react-query";
import { Crown } from "lucide-react";
import { Card, EmptyState } from "../components/Card";
import { PageHead } from "../components/ui";
import { RankingList } from "../components/RankingList";
import { useRanking } from "../lib/homeData";
import { useTableRefetch } from "../lib/realtime";
import { supabase } from "../lib/supabase";
import { fmt } from "../lib/format";
import { useAdminUserModal } from "./admin/useAdminUserModal";
import styles from "./Ranking.module.css";

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
    <Card title="명예의 전당" extra={<span className="muted" style={{ fontSize: 13 }}>매달 1위 기록</span>}>
      {q.isError && <EmptyState>명예의 전당을 불러오지 못했어요.</EmptyState>}
      {q.data?.length === 0 && <EmptyState>11월 1일부터 매달 1위가 여기에 기록돼요</EmptyState>}
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

export default function Ranking() {
  const q = useRanking(50);
  const adminModal = useAdminUserModal();
  useTableRefetch("ranking_pings", [["ranking"]], { event: "INSERT", minIntervalMs: 8000, settleMs: 800 });

  return (
    <div className="page">
      <PageHead title="포인트 랭킹" desc="보유 포인트 상위 50명이에요. 마이페이지에서 랭킹 공개 여부를 바꿀 수 있어요." />
      <HallOfFame />
      <Card flush>
        {q.isLoading && <p className="muted" style={{ padding: 16 }}>불러오는 중...</p>}
        {q.isError && <EmptyState>랭킹을 불러오지 못했어요.</EmptyState>}
        {q.data?.length === 0 && <EmptyState>아직 랭킹에 등록된 유저가 없어요.</EmptyState>}
        {q.data && <RankingList rows={q.data} onAdminClick={adminModal.open} />}
      </Card>
      {adminModal.element}
    </div>
  );
}
