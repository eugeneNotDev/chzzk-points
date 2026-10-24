// 마이페이지 — 칭호 고르기(상점 칭호·특수 칭호 목록, 칭호 창).
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "../../components/Card";
import { TitleStage } from "../../components/TitlePlate";
import { SpecialTitleLine } from "../../components/TitleBadge";
import { TitlePreview } from "../shop/TitlePreview";
import { Modal } from "../../components/ui";
import { apiFetch, ApiError, getChannelId } from "../../lib/auth";
import { API } from "../../lib/config";
import { useTitles, type Me, type SpecialOwned } from "../../lib/queries";
import { PillTabs } from "../../components/PillTabs";
import styles from "./MyPage.module.css";

// 칭호 관리 — 마이페이지 위 "칭호" 박스를 누르면 뜸. 칭호 / 특수 칭호 탭.
export function TitlesModal({
  open,
  onClose,
  profile,
  tab,
  onTab: setTab,
}: {
  open: boolean;
  onClose: () => void;
  profile: Me | undefined;
  tab: "title" | "special";
  onTab: (t: "title" | "special") => void;
}) {
  const titles = useTitles();
  const ownedCount = (titles.data ?? []).filter((t) => (profile?.purchasedTitleIds ?? []).includes(t.id)).length;
  const spCount = profile?.specialTitles?.length ?? 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="내 칭호"
      actions={
        <button type="button" className="btn" onClick={onClose}>
          닫기
        </button>
      }
    >
      <PillTabs
        size="sm"
        label="칭호 종류"
        value={tab}
        onChange={setTab}
        options={[
          { value: "title", label: `칭호 ${ownedCount}` },
          { value: "special", label: `특수 칭호 ${spCount}` },
        ]}
      />
      <div className={styles.tabBody}>{tab === "title" ? <TitleList profile={profile} /> : <SpecialList profile={profile} />}</div>
    </Modal>
  );
}

function TitleList({ profile }: { profile: Me | undefined }) {
  const titles = useTitles();
  const qc = useQueryClient();
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const owned = (titles.data ?? []).filter((t) => (profile?.purchasedTitleIds ?? []).includes(t.id));
  const previewT = previewId ? owned.find((t) => t.id === previewId) : undefined;

  async function equip(id: string) {
    if (!profile) return;
    const next = profile.selectedTitleId === id ? null : id;
    setBusy(true);
    setStatus({ text: "" });
    try {
      const data = await apiFetch<Me>(API.me, { body: { selectedTitleId: next } });
      qc.setQueryData(["me", getChannelId()], data);
      qc.invalidateQueries({ queryKey: ["ranking"] });
      setStatus({ text: next ? "칭호를 장착했어요." : "칭호를 해제했어요." });
    } catch (e) {
      setStatus({ text: e instanceof ApiError && e.body.error === "title_locked" ? "아직 잠긴 칭호예요." : "칭호 변경에 실패했어요.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className={`muted ${styles.tabDesc}`}>
        상점에서 구매했거나 선물받은 칭호예요. 랭킹에서 닉네임 옆에 붙고, 내 줄이 칭호 색으로 꾸며져요.
        <br />
        칭호를 누르면 장착한 모습을 미리 볼 수 있어요.
        <br />
        <Link to="/titles.html" className={styles.link}>
          칭호 상점 가기
        </Link>
      </p>
      {titles.isLoading && <span className={`skeleton ${styles.titlesSkel}`} />}
      {profile && titles.data && owned.length === 0 && <EmptyState>보유한 칭호가 없어요.</EmptyState>}
      <div className={styles.titleGrid}>
        {owned.map((t) => {
          const sel = profile?.selectedTitleId === t.id;
          return (
            <div key={t.id} className={`${styles.titleItem} ${sel ? styles.titleSel : ""}`}>
              <TitleStage name={t.name} value={t.color} sub={sel ? "장착 중" : undefined} onClick={() => setPreviewId(t.id)} />
              <span className={`muted ${styles.fs12}`}>
                {t.kind === "custom" ? "관리자가 지급한 칭호" : "상점에서 구매한 칭호"}
              </span>
              <button type="button" className={`btn btn-sm ${sel ? "" : "btn-primary"}`} disabled={busy} onClick={() => equip(t.id)}>
                {sel ? "장착 해제" : "장착하기"}
              </button>
            </div>
          );
        })}
      </div>
      <p className={`status ${status.error ? "error" : "ok"}`}>{status.text}</p>
      <TitlePreview
        title={previewT ? { heading: `[${previewT.name}]`, name: previewT.name, color: previewT.color } : null}
        balance={profile?.balance ?? 0}
        actions={
          previewT && (
            <button type="button" className={`btn ${profile?.selectedTitleId === previewT.id ? "" : "btn-primary"}`} disabled={busy} onClick={() => equip(previewT.id)}>
              {profile?.selectedTitleId === previewT.id ? "장착 해제" : "장착하기"}
            </button>
          )
        }
        onClose={() => setPreviewId(null)}
      />
    </>
  );
}

// 특수 칭호 — 랭킹 닉네임 위 작은 글씨. 관리자 지급·지난달 1~3위 칭호 중 하나를 골라 장착.
// 관리자가 고정한 칭호가 있으면(specialLocked) 그게 항상 보이고 바꿀 수 없음.
function SpecialList({ profile }: { profile: Me | undefined }) {
  const titles = useTitles();
  const qc = useQueryClient();
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const list = profile?.specialTitles ?? [];
  if (!profile) return null;
  if (list.length === 0) return <EmptyState>가진 특수 칭호가 없어요. 관리자 지급이나 매달 랭킹 1~3위 보상으로 받을 수 있어요.</EmptyState>;
  const locked = !!profile.specialLocked;
  const shop = titles.data?.find((t) => t.id === profile.selectedTitleId) ?? null;
  const previewT = previewId != null ? list.find((t) => t.id === previewId) : undefined;
  const sourceText = (t: SpecialOwned) => (t.forced ? "관리자가 고정한 칭호" : t.source === "monthly" ? "랭킹 보상 · 다음 달 1일까지" : "관리자가 지급한 칭호");

  async function equip(id: number) {
    if (!profile || locked) return;
    const next = profile.selectedSpecialId === id ? null : id;
    setBusy(true);
    setStatus({ text: "" });
    try {
      const data = await apiFetch<Me>(API.me, { body: { selectedSpecialId: next } });
      qc.setQueryData(["me", getChannelId()], data);
      qc.invalidateQueries({ queryKey: ["ranking"] });
      setStatus({ text: next ? "특수 칭호를 장착했어요." : "특수 칭호를 해제했어요." });
    } catch (e) {
      const code = e instanceof ApiError ? e.body.error : "";
      setStatus({ text: code === "special_locked" ? "관리자가 고정한 칭호가 있어서 바꿀 수 없어요." : "특수 칭호 변경에 실패했어요.", error: true });
    } finally {
      setBusy(false);
    }
  }

  const button = (t: SpecialOwned, cls = "btn-sm") => {
    const sel = profile.selectedSpecialId === t.id;
    if (locked) {
      return (
        <button type="button" className={`btn ${cls}`} disabled>
          {sel ? "고정됨" : "바꿀 수 없음"}
        </button>
      );
    }
    return (
      <button type="button" className={`btn ${cls} ${sel ? "" : "btn-primary"}`} disabled={busy} onClick={() => equip(t.id)}>
        {sel ? "장착 해제" : "장착하기"}
      </button>
    );
  };

  return (
    <>
      <p className={`muted ${styles.tabDesc}`}>
        {locked ? (
          <>
            관리자가 고정한 특수 칭호가 있어서 그 칭호가 항상 보여요.
            <br />
            해제하거나 다른 특수 칭호로 바꿀 수 없어요.
          </>
        ) : (
          <>
            랭킹에서 닉네임 위에 작게 붙는 칭호예요. 하나를 골라 장착할 수 있어요.
            <br />
            칭호를 누르면 장착한 모습을 미리 볼 수 있어요.
            <br />
            <b className={styles.bonusNote}>적립 보너스</b>가 있는 칭호는 장착하는 동안 출석·방송 코드·방송 후기·게시판 활동으로 받는 포인트가 늘어나요.
          </>
        )}
      </p>
      <div className={styles.titleGrid}>
        {list.map((t) => {
          const sel = profile.selectedSpecialId === t.id;
          return (
            <div key={t.id} className={`${styles.titleItem} ${sel ? styles.titleSel : ""}`}>
              <button type="button" className={styles.spStage} onClick={() => setPreviewId(t.id)} aria-label={`${t.name} 특수 칭호 미리보기`}>
                <SpecialTitleLine list={[t]} />
                {sel && <span className={styles.spSub}>{locked ? "고정" : "장착 중"}</span>}
              </button>
              {!!t.bonusPct && <span className={styles.bonusChip}>적립 +{t.bonusPct}%</span>}
              <span className={`muted ${styles.fs12}`}>
                {sourceText(t)}
              </span>
              {button(t)}
            </div>
          );
        })}
      </div>
      <p className={`status ${status.error ? "error" : "ok"}`}>{status.text}</p>
      <TitlePreview
        title={previewT ? { heading: previewT.name, name: previewT.name, color: previewT.color, special: true, shop: shop ? { name: shop.name, color: shop.color } : null } : null}
        balance={profile.balance}
        actions={previewT && button(previewT, "")}
        onClose={() => setPreviewId(null)}
      />
    </>
  );
}
