// 관리자: 상품 추가/수정. 칭호 상품은 지급할 칭호명·꾸미기·한정 수량, 일반 상품은 쿨타임·방송 중 전용·오버레이 알림.
// 상품 id는 추가할 때만 정할 수 있고 이후엔 못 바꿈(수정 화면에선 아예 숨김).
import { useState } from "react";
import { Modal } from "../../components/ui";
import { TitleColorPicker } from "../../components/TitleColorPicker";
import { ApiError } from "../../lib/auth";
import { fmt } from "../../lib/format";
import { DEFAULT_TITLE_COLOR } from "../../lib/titleStyle";
import { createShopItem, SAVE_ERRORS, updateShopItem, type ShopItem } from "../../lib/shop";
import styles from "./Shop.module.css";

export function ShopItemEditor({
  mode,
  item,
  itemType,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  item?: ShopItem;
  itemType: "regular" | "title";
  onClose: () => void;
  onSaved: () => void;
}) {
  const isTitle = itemType === "title";
  const isEdit = mode === "edit";
  const sold = Number(item?.sold_count ?? 0);
  const [id, setId] = useState("");
  const [name, setName] = useState(item?.name ?? "");
  const [desc, setDesc] = useState(item?.description ?? "");
  const [cost, setCost] = useState(item ? String(item.cost) : "");
  const [cooldown, setCooldown] = useState(String(item?.cooldown_seconds ?? 0));
  const [titleName, setTitleName] = useState(item?.titles?.name ?? "");
  const [titleColor, setTitleColor] = useState(item?.titles?.color ?? DEFAULT_TITLE_COLOR);
  // 수정 화면의 재고 칸은 "남은 수량" — 저장할 땐 서버가 쓰는 전체 한정 수량(팔린 개수 + 남은 수량)으로 바꿔 보냄
  const [stock, setStock] = useState(item?.stock_limit != null ? String(Math.max(0, item.stock_limit - sold)) : "");
  const [requiresLive, setRequiresLive] = useState(!!item?.requires_live);
  const [overlay, setOverlay] = useState(item ? item.show_on_overlay !== false : !isTitle);
  const [isActive, setIsActive] = useState(item?.is_active !== false);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);

  const err = (text: string) => setStatus({ text, error: true });

  async function submit() {
    const n = name.trim();
    const c = Number(cost);
    if (!n) return err("상품명을 입력해주세요.");
    if (!Number.isFinite(c) || c <= 0) return err("가격을 1 이상으로 입력해주세요.");
    const payload: Record<string, unknown> = { name: n, description: desc.trim(), cost: c };
    if (isTitle) {
      const tn = titleName.trim();
      if (!tn) return err("지급할 칭호명을 입력해주세요.");
      payload.titleName = tn;
      payload.titleColor = titleColor;
      payload.showOnOverlay = false;
      const raw = stock.trim();
      if (raw) {
        const entered = Number(raw);
        if (!Number.isInteger(entered) || entered < (isEdit ? 0 : 1)) return err(isEdit ? "남은 수량은 0 이상의 정수로 입력해주세요." : "한정 수량은 1 이상의 정수로 입력해주세요.");
        const limit = isEdit ? sold + entered : entered;
        if (limit <= 0) return err("아직 안 팔린 상품은 남은 수량을 1 이상으로 해주세요(내리려면 판매 중지).");
        payload.stockLimit = limit;
      } else payload.stockLimit = null;
    } else {
      payload.cooldownSeconds = Number(cooldown) || 0;
      payload.requiresLive = requiresLive;
      payload.showOnOverlay = overlay;
    }

    setBusy(true);
    setStatus({ text: "저장 중..." });
    try {
      if (!isEdit) {
        const idv = id.trim();
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(idv)) {
          setBusy(false);
          return err("상품 id는 영문 소문자/숫자/하이픈만 가능해요 (첫 글자는 하이픈 불가).");
        }
        await createShopItem({ id: idv, ...payload, ...(isTitle ? { isTitleItem: true } : {}) });
      } else {
        await updateShopItem(item!.id, { ...payload, isActive });
      }
      onSaved();
    } catch (e) {
      const code = e instanceof ApiError ? String(e.body.error ?? "") : "";
      err(SAVE_ERRORS[code] || "저장에 실패했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide={isTitle}
      title={`${isTitle ? "칭호 상품" : "상품"} ${isEdit ? "수정" : "추가"}`}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
            {isEdit ? "저장" : "추가"}
          </button>
        </>
      }
    >
      <div className={styles.form}>
        {!isEdit && (
          <label className="field">
            <span className="field-label">상품 id (내부 식별용, 추가 후 수정 불가)</span>
            <input className="input" placeholder="예: water (영문 소문자/숫자/하이픈)" maxLength={64} value={id} onChange={(e) => setId(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span className="field-label">상품명</span>
          <input className="input" placeholder="상점에 표시될 이름" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">설명</span>
          <textarea className="textarea" rows={3} placeholder="상품 카드에 표시될 설명" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>
        <div className={styles.formRow}>
          <label className="field">
            <span className="field-label">가격 (P)</span>
            <input className="input num" type="number" min={1} value={cost} onChange={(e) => setCost(e.target.value)} />
          </label>
          {!isTitle && (
            <label className="field">
              <span className="field-label">쿨타임 (초, 0=없음)</span>
              <input className="input num" type="number" min={0} value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
            </label>
          )}
        </div>

        {isTitle && (
          <>
            <label className="field">
              <span className="field-label">지급할 칭호명</span>
              <input className="input" placeholder="예: 네루" maxLength={40} value={titleName} onChange={(e) => setTitleName(e.target.value)} />
            </label>
            <div className="field">
              <span className="field-label">칭호 꾸미기</span>
              <TitleColorPicker value={titleColor} onChange={setTitleColor} previewName={titleName} />
            </div>
            <label className="field">
              <span className="field-label">{isEdit ? "남은 수량 (비워두면 무제한)" : "한정 수량 (비워두면 무제한)"}</span>
              <input className="input num" type="number" min={isEdit ? 0 : 1} placeholder="예: 10" value={stock} onChange={(e) => setStock(e.target.value)} />
              {isEdit && (sold > 0 || item?.stock_limit != null) && (
                <span className={`muted ${styles.fs12}`}>
                  지금까지 {fmt(sold)}개 팔렸어요. 품절된 상품도 여기 숫자를 늘리면 다시 팔 수 있어요.
                </span>
              )}
            </label>
          </>
        )}

        {!isTitle && (
          <div className={styles.checks}>
            <label className="check">
              <input type="checkbox" checked={requiresLive} onChange={(e) => setRequiresLive(e.target.checked)} />
              방송 중에만 사용 가능
            </label>
            <label className="check">
              <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />
              오버레이 알림 표시
            </label>
          </div>
        )}
        {isEdit && (
          <label className="check">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            상점에 노출 (끄면 판매 중지)
          </label>
        )}
        <p className={`status ${status.error ? "error" : ""}`}>{status.text}</p>
      </div>
    </Modal>
  );
}
