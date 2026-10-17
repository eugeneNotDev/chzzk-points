import type { ReactNode } from "react";
import { Check, Radio, Timer } from "lucide-react";
import { TitleTag, PlateStars, useTitlePlate } from "../../components/TitlePlate";
import { useAuth } from "../../lib/auth";
import { fmt } from "../../lib/format";
import type { ShopItem } from "../../lib/shop";
import styles from "./Shop.module.css";

// 구매·사용 버튼 문구와 누를 수 있는지 — 카드와 칭호 미리보기 창이 같이 씀.
export function itemButtonState(p: { item: ShopItem; admin: boolean; balance: number; isLive: boolean; owned: boolean; cooldownLeft: number }) {
  const { item, admin, balance, isLive, owned, cooldownLeft } = p;
  const isTitle = !!item.grants_title_id;
  const liveBlocked = item.requires_live && !isLive;
  const affordable = balance >= item.cost;
  const stockRemaining = item.stock_limit != null ? Math.max(0, item.stock_limit - (item.sold_count ?? 0)) : null;
  const soldOut = item.stock_limit != null && stockRemaining! <= 0;
  const inactive = admin && item.is_active === false;
  const usable = !owned && !soldOut && !liveBlocked && affordable && cooldownLeft <= 0 && !inactive;
  let label = isTitle ? "구매" : "사용";
  if (owned) label = "보유중";
  else if (inactive) label = "판매 중지됨";
  else if (soldOut) label = "품절";
  else if (cooldownLeft > 0) label = `${cooldownLeft}초 후 사용 가능`;
  else if (liveBlocked) label = "방송 중에만 가능";
  else if (!affordable) label = "잔액 부족";
  return { label, usable, soldOut, inactive, stockRemaining };
}

// 칭호 무대 — 카드 윗부분 전체가 칭호 플레이트(시상대 윗칸과 같은 모양), 가운데 칭호 글자 크게 + 내 닉네임.
// 누르면 장착 미리보기(onPreview).
function TitleStage({ name, value, onPreview }: { name: string; value: string | null | undefined; onPreview?: () => void }) {
  const plate = useTitlePlate(value);
  const { channelName } = useAuth();
  return (
    <button type="button" className={styles.titleStage} onClick={onPreview} disabled={!onPreview} aria-label={`${name} 칭호 장착 미리보기`}>
      <span className={`${styles.stagePlate} ${plate ? `${plate.className} tp-card` : ""}`} style={plate?.style}>
        {plate?.star && <PlateStars />}
        {plate && (
          <span className={styles.stageTag}>
            <TitleTag name={name} plate={plate} dot={false} />
          </span>
        )}
        {channelName && <span className={styles.stageWho}>{channelName}</span>}
        {onPreview && <span className={styles.stageHint}>눌러서 미리보기</span>}
      </span>
    </button>
  );
}

// 상품 카드 하나. 칭호 상품은 받게 될 칭호를 무대에 크게 보여주고(누르면 장착 미리보기), 이미 산 칭호면 "보유중".
export function ShopItemCard({
  item,
  admin,
  balance,
  isLive,
  owned,
  cooldownLeft,
  busy,
  onUse,
  onEdit,
  onToggle,
  onDelete,
  onPreview,
  reorderHandle,
}: {
  item: ShopItem;
  admin: boolean;
  balance: number;
  isLive: boolean;
  owned: boolean;
  cooldownLeft: number;
  busy: boolean;
  onUse: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onPreview?: () => void;
  reorderHandle?: ReactNode;
}) {
  const isTitle = !!item.grants_title_id;
  const { label, usable, soldOut, inactive, stockRemaining } = itemButtonState({ item, admin, balance, isLive, owned, cooldownLeft });

  return (
    <article className={`${styles.card} ${isTitle ? styles.titleCard : ""} ${owned ? styles.owned : ""} ${soldOut ? styles.soldOut : ""} ${inactive ? styles.inactiveCard : ""}`}>
      {reorderHandle}
      {isTitle && <TitleStage name={item.titles?.name ?? item.name} value={item.titles?.color} onPreview={reorderHandle ? undefined : onPreview} />}
      <div className={styles.cardBody}>
        <h3 className={styles.name}>{item.name}</h3>
        {item.description && <p className={styles.desc}>{item.description}</p>}
        <div className={styles.meta}>
          {item.requires_live && (
            <span className="tag tag-live">
              <Radio size={11} aria-hidden="true" />
              방송 중에만
            </span>
          )}
          {!isTitle && item.cooldown_seconds > 0 && (
            <span className="tag">
              <Timer size={11} aria-hidden="true" />
              쿨타임 {item.cooldown_seconds}초
            </span>
          )}
          {stockRemaining != null && <span className={`tag ${soldOut ? "" : "tag-gold"}`}>{soldOut ? "품절" : `한정 ${fmt(stockRemaining)}개 남음`}</span>}
          {admin && isTitle && Number.isFinite(item.owner_count) && <span className="tag tag-blue">보유 {fmt(item.owner_count!)}명</span>}
          {inactive && <span className="tag">판매 중지</span>}
        </div>
      </div>
      <div className={styles.cardFoot}>
        <span className={`${styles.cost} num`}>
          {fmt(item.cost)}
          <small>P</small>
        </span>
        {!reorderHandle && (
          <button type="button" className={`btn ${usable ? "btn-primary" : ""} ${styles.useBtn}`} disabled={!usable || busy} onClick={onUse}>
            {owned && <Check size={16} aria-hidden="true" />}
            {label}
          </button>
        )}
      </div>
      {admin && !reorderHandle && (
        <div className={styles.adminRow}>
          <button type="button" className="link-btn" onClick={onEdit}>
            수정
          </button>
          <button type="button" className="link-btn" onClick={onToggle} disabled={busy}>
            {inactive ? "다시 판매" : "판매 중지"}
          </button>
          <button type="button" className="link-btn" onClick={onDelete}>
            삭제
          </button>
        </div>
      )}
    </article>
  );
}
