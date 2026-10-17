// 칭호 장착 미리보기 — 칭호 상점·마이페이지에서 칭호 무대를 누르면 뜸.
// 내 닉네임이 이 칭호를 달았을 때 랭킹 줄·시상대 칸이 어떻게 보이는지, 실제 랭킹 화면과 같은 부품으로 보여줌.
// 아래 버튼(구매 / 장착하기 등)은 부르는 쪽이 actions로 넣음.
import type { ReactNode } from "react";
import { Modal } from "../../components/ui";
import { RankingList } from "../../components/RankingList";
import { useAuth } from "../../lib/auth";
import type { RankingRow } from "../../lib/homeData";
import { PodiumStep } from "../Ranking";
import styles from "./Shop.module.css";

// special: 특수 칭호(닉네임 위 작은 글씨) 미리보기 — 이때 줄 꾸밈은 지금 장착한 상점 칭호(shop)로 보여줌
export type PreviewTitle = {
  heading: string;
  name: string;
  color: string | null | undefined;
  special?: boolean;
  shop?: { name: string; color: string } | null;
};

export function TitlePreview({ title, balance, actions, onClose }: { title: PreviewTitle | null; balance: number; actions?: ReactNode; onClose: () => void }) {
  const { channelId, channelName } = useAuth();
  const row: RankingRow | null = title
    ? {
        channel_id: channelId ?? "me",
        channel_name: channelName || "내 닉네임",
        total_points: balance,
        is_public: true,
        tier_title_name: null,
        tier_title_color: null,
        shop_title_name: title.special ? (title.shop?.name ?? null) : title.name,
        shop_title_color: title.special ? (title.shop?.color ?? null) : (title.color ?? null),
        special_titles: title.special ? [{ name: title.name, color: title.color ?? "" }] : null,
      }
    : null;
  return (
    <Modal
      open={!!title}
      onClose={onClose}
      title={`${title?.heading ?? ""} 장착 미리보기`}
      subtitle="내 닉네임에 달면 이렇게 보여요."
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          {actions}
        </>
      }
    >
      {row && (
        <div className={styles.preview}>
          <p className={styles.previewLabel}>랭킹</p>
          <RankingList rows={[row]} hideRank />
          <p className={styles.previewLabel}>1~3위 시상대</p>
          <div className={styles.previewPodium}>
            <PodiumStep r={row} i={0} />
          </div>
        </div>
      )}
    </Modal>
  );
}
