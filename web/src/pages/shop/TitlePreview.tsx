// 칭호 장착 미리보기 — 칭호 상점에서 칭호 무대를 누르면 뜸.
// 내 닉네임이 이 칭호를 달았을 때 랭킹 줄·시상대 칸이 어떻게 보이는지, 실제 랭킹 화면과 같은 부품으로 보여줌.
import { Check } from "lucide-react";
import { Modal } from "../../components/ui";
import { RankingList } from "../../components/RankingList";
import { useAuth } from "../../lib/auth";
import type { RankingRow } from "../../lib/homeData";
import type { ShopItem } from "../../lib/shop";
import { PodiumStep } from "../Ranking";
import styles from "./Shop.module.css";

export function TitlePreview({
  item,
  balance,
  button,
  busy,
  onBuy,
  onClose,
}: {
  item: ShopItem | null;
  balance: number;
  button: { label: string; usable: boolean; owned: boolean } | null;
  busy: boolean;
  onBuy: () => void;
  onClose: () => void;
}) {
  const { channelId, channelName } = useAuth();
  const name = item?.titles?.name ?? item?.name ?? "";
  const row: RankingRow | null = item
    ? {
        channel_id: channelId ?? "me",
        channel_name: channelName || "내 닉네임",
        total_points: balance,
        is_public: true,
        tier_title_name: null,
        tier_title_color: null,
        shop_title_name: name,
        shop_title_color: item.titles?.color ?? null,
        special_titles: null,
      }
    : null;
  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={`${item?.name ?? ""} 장착 미리보기`}
      subtitle="내 닉네임에 달면 이렇게 보여요."
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          {button && (
            <button type="button" className={`btn ${button.usable ? "btn-primary" : ""}`} disabled={!button.usable || busy} onClick={onBuy}>
              {button.owned && <Check size={16} aria-hidden="true" />}
              {button.label}
            </button>
          )}
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
