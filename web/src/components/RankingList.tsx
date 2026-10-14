// 랭킹 목록 — 랭킹 화면과 홈 미리보기가 같이 씀.
// 이름 칸 = [비공개 표시(관리자 화면만)][장착 칭호 배지] 닉네임, 특수 칭호는 닉네임 바로 위(칭호 배지 위가 아니라 닉네임 위에만) 작은 글씨.
// 비공개 유저는 이름이 이미 "비공개"로 가려져서 내려옴(본인도 똑같이 — 설정이 잘 됐는지 보이게).
import { fmt } from "../lib/format";
import { useAuth } from "../lib/auth";
import { isMyRankingRow, type RankingRow } from "../lib/homeData";
import { SpecialTitleLine, TitleBadge } from "./TitleBadge";
import styles from "./RankingList.module.css";

const RANK_COLORS = ["var(--c-gold)", "var(--c-silver)", "var(--c-bronze)"];

export function RankingList({ rows, onAdminClick }: { rows: RankingRow[]; onAdminClick?: (channelId: string) => void }) {
  const { channelId } = useAuth();
  return (
    <ol className={styles.list}>
      {rows.map((r, i) => {
        const me = isMyRankingRow(r, channelId);
        const isPrivate = r.is_public === false;
        const clickable = !!(onAdminClick && r.admin_view && r.channel_id);
        const nameInner = (
          <span className={styles.nameLine}>
            {r.admin_view && isPrivate && <span className={styles.privateTag}>비공개</span>}
            {r.shop_title_name && <TitleBadge name={r.shop_title_name} value={r.shop_title_color} className="rk-shop" />}
            <span className={styles.nameCol}>
              {!isPrivate && <SpecialTitleLine list={r.special_titles} />}
              <span className={`${styles.nameText} ${isPrivate && !r.admin_view ? styles.muted : ""}`}>
                {r.channel_name || "(이름 없음)"}
                {me && " (나)"}
              </span>
            </span>
          </span>
        );
        return (
          <li key={`${r.channel_id}-${i}`} className={`${styles.row} ${me ? styles.me : ""} ${i < 3 ? styles.top : ""}`}>
            <span className={`${styles.no} num`} style={{ color: RANK_COLORS[i] ?? "var(--c-text-4)" }}>
              {i + 1}
            </span>
            {clickable ? (
              <button type="button" className={`${styles.name} ${styles.nameBtn}`} onClick={() => onAdminClick!(r.channel_id)} title="유저 상세 보기">
                {nameInner}
              </button>
            ) : (
              <span className={styles.name}>{nameInner}</span>
            )}
            <span className={`${styles.points} num`}>{fmt(r.total_points)}P</span>
          </li>
        );
      })}
    </ol>
  );
}
