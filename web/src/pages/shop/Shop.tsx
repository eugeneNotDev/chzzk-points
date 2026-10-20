// 포인트 상점(shop.html) / 칭호 상점(titles.html) — 같은 화면을 kind로 나눠 씀.
//  - 일반 상품: 쿨타임, 방송 중 전용, 사면 OBS 오버레이 알림
//  - 칭호 상품: 한 번 사면 보유, 한정 수량(품절), 산 칭호는 마이페이지에서 장착
//  - 관리자: 상품 추가/수정/판매 중지/삭제, 순서 변경(끌어서 놓기)
import { SkelGroup, SkelInline } from "../../components/Skeleton";
import { LoadError } from "../../components/LoadError";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownUp, Check, MousePointerClick, Plus } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { LoginNeeded, PageHead, Stat } from "../../components/ui";
import { ApiError, getChannelId, useAuth } from "../../lib/auth";
import { fmt } from "../../lib/format";
import { useBroadcastStatus, useMe, type Me } from "../../lib/queries";
import { deleteShopItem, reorderShopItems, SPEND_ERRORS, spendItem, updateShopItem, useShopItems, type ShopItem } from "../../lib/shop";
import { itemButtonState, ShopItemCard } from "./ShopItemCard";
import { TitlePreview } from "./TitlePreview";
import { ShopItemEditor } from "./ShopItemEditor";
import { ReorderGrid } from "./ReorderGrid";
import styles from "./Shop.module.css";
import { alertDialog, confirmDialog } from "../../lib/dialog";
import { AnimatedNumber } from "../../components/AnimatedNumber";

export function ShopPage({ kind }: { kind: "general" | "title" }) {
  const { isLoggedIn, isAdmin } = useAuth();
  const me = useMe();
  const live = useBroadcastStatus();
  const itemsQ = useShopItems();
  const qc = useQueryClient();
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [now, setNow] = useState(Date.now());
  const [editor, setEditor] = useState<{ mode: "add" | "edit"; item?: ShopItem } | null>(null);
  const [reorder, setReorder] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const isTitle = kind === "title";
  const all = (itemsQ.data ?? []).filter((i) => Boolean(i.grants_title_id) === isTitle);
  const active = all.filter((i) => i.is_active !== false);
  const inactive = isAdmin ? all.filter((i) => i.is_active === false) : [];
  const owned = useMemo(() => new Set(me.data?.purchasedTitleIds ?? []), [me.data]);

  // 쿨타임 카운트다운(새로고침하면 초기화 — 진짜 판단은 서버)
  const anyCooldown = Object.values(cooldowns).some((t) => t > now);
  useEffect(() => {
    if (!anyCooldown) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyCooldown]);

  useEffect(() => {
    setStatus({ text: "" });
    setReorder(null);
  }, [kind]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["shop-items"] });

  async function use(item: ShopItem) {
    setBusyId(item.id);
    setStatus({ text: "" });
    try {
      const d = await spendItem(item.id);
      qc.setQueryData<Me>(["me", getChannelId()], (prev) =>
        prev ? { ...prev, balance: d.balance ?? prev.balance, purchasedTitleIds: d.titleGranted ? [...(prev.purchasedTitleIds ?? []), d.titleGranted.id] : prev.purchasedTitleIds } : prev,
      );
      if (d.titleGranted) {
        setStatus({ text: `"${d.titleGranted.name}" 칭호를 획득했어요! 마이페이지에서 장착할 수 있어요.` });
        refresh(); // 남은 수량 갱신
      } else {
        setStatus({ text: `${d.item?.name ?? "아이템"} 사용했어요! (-${fmt(d.item?.cost ?? 0)}P)` });
      }
      if ((d.item?.cooldownSeconds ?? 0) > 0) {
        const t = Date.now();
        setCooldowns((c) => ({ ...c, [item.id]: t + d.item!.cooldownSeconds * 1000 }));
        setNow(t);
      }
    } catch (e) {
      const code = e instanceof ApiError ? String(e.body.error ?? "") : "";
      if (code === "cooldown") {
        const wait = e instanceof ApiError ? Number(e.body.retryAfterSeconds) : NaN;
        setStatus({ text: Number.isFinite(wait) ? `너무 빨라요! ${wait}초 후에 다시 사용할 수 있어요.` : "너무 빨라요! 잠시 후 다시 시도해주세요.", error: true });
        if (Number.isFinite(wait)) {
          const t = Date.now();
          setCooldowns((c) => ({ ...c, [item.id]: t + wait * 1000 }));
          setNow(t);
        }
      } else if (code !== "banned") {
        setStatus({ text: SPEND_ERRORS[code] || "사용에 실패했어요. 다시 시도해주세요.", error: true });
      }
      qc.invalidateQueries({ queryKey: ["broadcast-status"] });
      if (code === "sold_out" || code === "item_not_found") refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(item: ShopItem) {
    setBusyId(item.id);
    try {
      await updateShopItem(item.id, { isActive: item.is_active === false });
      await refresh();
    } catch {
      alertDialog("판매 상태를 바꾸지 못했어요.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: ShopItem) {
    let msg: string;
    if (item.grants_title_id) {
      const owners = Number(item.owner_count) || 0;
      msg =
        owners > 0
          ? `"${item.name}" 상품을 완전히 삭제할까요?\n\n이 칭호를 가진 유저 ${owners}명에게서 칭호가 회수돼요(되돌릴 수 없음).\n산 사람은 그대로 두고 상점에서만 내리려면 취소하고 "판매 중지"를 눌러주세요.`
          : `"${item.name}" 상품을 완전히 삭제할까요?\n\n아직 이 칭호를 가진 유저는 없어요.`;
    } else {
      msg = `"${item.name}" 상품을 완전히 삭제할까요?\n\n과거 구매 로그(포인트 내역)에는 영향 없어요. 잠깐 내리기만 하려면 "판매 중지"를 쓰세요.`;
    }
    if (!(await confirmDialog(msg))) return;
    try {
      const d = await deleteShopItem(item.id);
      setStatus({ text: d.revokedOwners ? `"${item.name}" 삭제 완료 — ${d.revokedOwners}명에게서 칭호를 회수했어요.` : `"${item.name}" 삭제 완료.` });
      refresh();
    } catch {
      alertDialog("삭제에 실패했어요.");
    }
  }

  async function saveOrder() {
    if (!reorder) return;
    if (reorder.join("\n") === active.map((i) => i.id).join("\n")) return setReorder(null);
    setSaving(true);
    setStatus({ text: "순서 저장 중..." });
    try {
      // 그 탭 상품 전부 — 판매 중인 건 새 순서, 판매 중지된 건 지금 순서 그대로 그 뒤에
      await reorderShopItems([...reorder, ...inactive.map((i) => i.id)]);
      await refresh();
      setReorder(null);
      setStatus({ text: "상품 순서를 저장했어요." });
    } catch (e) {
      const code = e instanceof ApiError ? e.body.error : "";
      if (code === "stale_order" || code === "invalid_order") {
        await refresh();
        setReorder(null);
        setStatus({ text: "그 사이 상품 목록이 바뀌어서 저장하지 못했어요. 다시 순서를 바꿔주세요.", error: true });
      } else setStatus({ text: "순서를 저장하지 못했어요. 다시 시도해주세요.", error: true });
    } finally {
      setSaving(false);
    }
  }

  const title = isTitle ? "칭호 상점" : "포인트 상점";
  const desc = isTitle ? "칭호를 사면 마이페이지에서 장착할 수 있어요. 랭킹에서 닉네임과 함께 보여요." : "포인트로 방송에 직접 참여해 보세요. 사용하면 방송 화면에 알림이 떠요.";

  if (!isLoggedIn) {
    return (
      <div className="page">
        <PageHead title={title} desc={desc} />
        <Card>
          <LoginNeeded>로그인하면 포인트 상점을 이용할 수 있어요.</LoginNeeded>
        </Card>
      </div>
    );
  }

  const cardProps = (item: ShopItem) => {
    const until = cooldowns[item.id] ?? 0;
    return {
      item,
      admin: isAdmin,
      balance: me.data?.balance ?? 0,
      isLive: live.data?.isLive === true,
      owned: !!item.grants_title_id && owned.has(item.grants_title_id),
      cooldownLeft: Math.max(0, Math.ceil((until - now) / 1000)),
      busy: busyId === item.id || !me.data,
      onUse: () => use(item),
      onEdit: () => setEditor({ mode: "edit", item }),
      onToggle: () => toggleActive(item),
      onDelete: () => remove(item),
      onPreview: item.grants_title_id ? () => setPreviewId(item.id) : undefined,
    };
  };
  const previewItem = previewId ? (all.find((i) => i.id === previewId) ?? null) : null;
  const previewProps = previewItem ? cardProps(previewItem) : null;
  const previewBtn = previewProps ? itemButtonState(previewProps) : null;

  return (
    <div className="page">
      <PageHead title={title} desc={desc} stats={<Stat label="보유 포인트" value={me.data ? <AnimatedNumber value={me.data.balance} /> : <SkelInline w={90} h={22} />} unit="P" tone="accent" />} />

      <div className={styles.topRow}>
        <div className="segment" role="tablist" aria-label="상점 종류">
          <Link to="/shop.html" role="tab" aria-selected={!isTitle} className={!isTitle ? "on" : ""} style={segLink}>
            일반 상품
          </Link>
          <Link to="/titles.html" role="tab" aria-selected={isTitle} className={isTitle ? "on" : ""} style={segLink}>
            칭호
          </Link>
        </div>
      </div>

      {isAdmin && (
        <div className={styles.adminBar}>
          {reorder ? (
            <>
              <span className="muted" style={{ fontSize: 13 }}>
                카드를 끌어서 원하는 자리에 놓아주세요. (폰은 손잡이를 잡고 끌어요)
              </span>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn btn-sm" disabled={saving} onClick={() => setReorder(null)}>
                취소
              </button>
              <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={saveOrder}>
                완료
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-sm" onClick={() => setEditor({ mode: "add" })}>
                <Plus size={16} aria-hidden="true" />
                {isTitle ? "칭호 상품 추가" : "상품 추가"}
              </button>
              <button type="button" className="btn btn-sm" disabled={active.length < 2} title={active.length < 2 ? "판매 중인 상품이 2개 이상일 때 쓸 수 있어요" : ""} onClick={() => setReorder(active.map((i) => i.id))}>
                <ArrowDownUp size={16} aria-hidden="true" />
                순서 변경
              </button>
            </>
          )}
        </div>
      )}

      {isTitle && !reorder && (
        <p className={styles.previewTip}>
          <MousePointerClick size={16} aria-hidden="true" />
          <span>
            <b>칭호를 눌러보면</b> 내 닉네임에 장착한 모습을 미리 볼 수 있어요.
          </span>
        </p>
      )}

      <p className={`status ${status.error ? "error" : "ok"}`} role="status">
        {status.text}
      </p>

      {itemsQ.isLoading && (
        <SkelGroup className={styles.grid}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="skeleton" style={{ height: 200, borderRadius: 20 }} />
          ))}
        </SkelGroup>
      )}
      {itemsQ.isError && <LoadError what="상품 목록" onRetry={() => itemsQ.refetch()} />}
      {itemsQ.data && active.length === 0 && (
        <Card>
          <EmptyState>상품 준비 중이에요.</EmptyState>
        </Card>
      )}

      {reorder ? (
        <ReorderGrid ids={reorder} items={active} onChange={setReorder} render={(item, handle) => <ShopItemCard {...cardProps(item)} reorderHandle={handle} />} />
      ) : (
        <div className={styles.grid}>
          {active.map((item) => (
            <ShopItemCard key={item.id} {...cardProps(item)} />
          ))}
        </div>
      )}

      {inactive.length > 0 && !reorder && (
        <details className={styles.inactive}>
          <summary>판매 중지된 상품 {inactive.length}개</summary>
          <div className={styles.grid}>
            {inactive.map((item) => (
              <ShopItemCard key={item.id} {...cardProps(item)} />
            ))}
          </div>
        </details>
      )}

      <TitlePreview
        title={previewItem ? { heading: previewItem.name, name: previewItem.titles?.name ?? previewItem.name, color: previewItem.titles?.color } : null}
        balance={me.data?.balance ?? 0}
        actions={previewBtn && previewItem && (
          <button type="button" className={`btn ${previewBtn.usable ? "btn-primary" : ""}`} disabled={!previewBtn.usable || !!previewProps?.busy} onClick={() => use(previewItem)}>
            {previewProps?.owned && <Check size={16} aria-hidden="true" />}
            {previewBtn.label}
          </button>
        )}
        onClose={() => setPreviewId(null)}
      />

      {isAdmin && editor && (
        <ShopItemEditor
          mode={editor.mode}
          item={editor.item}
          itemType={editor.item ? (editor.item.grants_title_id ? "title" : "regular") : isTitle ? "title" : "regular"}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

const segLink: React.CSSProperties = { display: "inline-flex", alignItems: "center", height: 34, padding: "0 14px", borderRadius: 9, fontSize: 14 };

export default function Shop() {
  // 기존 사이트의 칭호 상점 주소(shop.html#title-shop-section)로 들어오면 칭호 상점으로
  const nav = useNavigate();
  const toTitles = typeof location !== "undefined" && location.hash.includes("title");
  useEffect(() => {
    if (toTitles) nav("/titles.html", { replace: true });
  }, [toTitles, nav]);
  return <ShopPage kind="general" />;
}
