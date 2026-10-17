// 칭호 관리 팝업 — 유저 상세 팝업 위에 한 겹 더 뜸.
// 보유 칭호 회수 · 칭호 지급(새로 만들기 / 기존 칭호 주기 → 상점 칭호·커스텀 칭호) · 특수 칭호(랭킹 닉네임 윗줄) 지급/회수.
import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "../../components/ui";
import { SpecialTitleLine } from "../../components/TitleBadge";
import { TitleText } from "../../components/TitlePlate";
import { TitleColorPicker } from "../../components/TitleColorPicker";
import { ApiError, apiFetch } from "../../lib/auth";
import { API } from "../../lib/config";
import { supabase } from "../../lib/supabase";
import { DEFAULT_TITLE_COLOR } from "../../lib/titleStyle";
import { adminCall, type OwnedTitle } from "../../lib/admin";
import styles from "./Admin.module.css";
import { alertDialog, confirmDialog } from "../../lib/dialog";

type Grantable = { id: string; name: string; color: string; kind: "shop" | "custom" };
type Special = { id: number; name: string; color: string; forced: boolean; source: "admin" | "monthly"; bonusPct?: number; grantedAt: string };
type Msg = { text: string; ok?: boolean } | null;

const EXISTING_HELP = {
  shop: "상점에서 파는 칭호를 그대로 지급해요. 포인트는 안 빠지고 상품 남은 수량도 안 줄어요.",
  custom: "전에 다른 유저한테 새로 만들어 줬던 칭호를 똑같이 지급해요.",
};
const GRANT_ERR: Record<string, string> = {
  already_owned: "이미 가지고 있는 칭호예요.",
  title_not_found: "없는 칭호예요(그새 지워졌을 수 있어요).",
  invalid_title_name: "칭호명은 1~20자로 입력해주세요.",
  invalid_title_color: "칭호 색상이 올바르지 않아요.",
};
const SPECIAL_ERR: Record<string, string> = {
  already_owned: "이미 같은 이름의 특수 칭호가 있어요.",
  too_many_titles: "특수 칭호는 한 유저에게 최대 5개까지만 줄 수 있어요.",
  invalid_title_name: "칭호명은 1~20자로 입력해주세요.",
  invalid_title_color: "칭호 색상이 올바르지 않아요.",
  invalid_bonus: "적립 보너스는 0~30% 사이로 입력해주세요.",
};
const errOf = (e: unknown, map: Record<string, string>) => (e instanceof ApiError && map[String(e.body.error)]) || "지급에 실패했어요.";

export function TitlesModal({
  open,
  onClose,
  channelId,
  name,
  owned,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  channelId: string;
  name: string;
  owned: OwnedTitle[];
  onChanged: () => Promise<void> | void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [kind, setKind] = useState<"shop" | "custom">("shop");
  const [picked, setPicked] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_TITLE_COLOR);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [spName, setSpName] = useState("");
  const [spColor, setSpColor] = useState(DEFAULT_TITLE_COLOR);
  const [spMsg, setSpMsg] = useState<Msg>(null);
  const [spBusy, setSpBusy] = useState(false);
  const [spForced, setSpForced] = useState(false);
  const [spBonus, setSpBonus] = useState("0");

  // 열 때마다 처음 상태로 + 목록 새로 받기(방금 만든 칭호도 보이게)
  useEffect(() => {
    if (!open) return;
    setMode("new");
    setKind("shop");
    setPicked(null);
    setNewName("");
    setNewColor(DEFAULT_TITLE_COLOR);
    setMsg(null);
    setSpName("");
    setSpColor(DEFAULT_TITLE_COLOR);
    setSpMsg(null);
    setSpForced(false);
    setSpBonus("0");
    qc.invalidateQueries({ queryKey: ["admin", "grantable-titles"] });
    qc.invalidateQueries({ queryKey: ["admin", "special-titles", channelId] });
  }, [open, channelId, qc]);

  const titlesQ = useQuery({
    queryKey: ["admin", "grantable-titles"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from("titles").select("id, name, color, kind").order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []).filter((t) => t.kind === "shop" || t.kind === "custom") as Grantable[];
    },
  });
  const spKey = ["admin", "special-titles", channelId];
  const spQ = useQuery({
    queryKey: spKey,
    enabled: open,
    queryFn: () => apiFetch<{ titles: Special[] }>(`${API.adminSpecialTitle}?channelId=${encodeURIComponent(channelId)}`),
  });

  const ownedIds = new Set(owned.map((t) => t.id));
  const all = titlesQ.data ?? [];
  const countOf = (k: "shop" | "custom") => all.filter((t) => t.kind === k && !ownedIds.has(t.id)).length;
  const choices = all.filter((t) => t.kind === kind && !ownedIds.has(t.id));

  const afterTitleChange = async () => {
    await qc.invalidateQueries({ queryKey: ["admin", "grantable-titles"] });
    await onChanged();
  };

  const revoke = async (t: OwnedTitle) => {
    if (!(await confirmDialog(`"${t.name}" 칭호를 이 유저에게서 회수할까요?`, { danger: true }))) return;
    try {
      await adminCall({ action: "revoke-title", channelId, titleId: t.id });
      await afterTitleChange();
      setMsg({ text: `"${t.name}" 칭호를 회수했어요.`, ok: true });
    } catch {
      alertDialog("칭호를 회수하지 못했어요.");
    }
  };

  const grant = async (e: FormEvent) => {
    e.preventDefault();
    let payload: Record<string, unknown>;
    if (mode === "existing") {
      if (!picked || !choices.some((c) => c.id === picked)) return setMsg({ text: "지급할 칭호를 골라주세요." });
      payload = { action: "grant-title", channelId, titleId: picked };
    } else {
      const n = newName.trim();
      if (!n) return setMsg({ text: "칭호명을 입력해주세요." });
      payload = { action: "grant-custom-title", channelId, name: n, color: newColor };
    }
    setBusy(true);
    setMsg({ text: "지급 중..." , ok: true });
    try {
      await adminCall(payload);
      setNewName("");
      setNewColor(DEFAULT_TITLE_COLOR);
      setPicked(null);
      await afterTitleChange();
      setMsg({ text: "칭호를 지급했어요. 유저가 마이페이지에서 장착할 수 있어요.", ok: true });
    } catch (er) {
      setMsg({ text: errOf(er, GRANT_ERR) });
    } finally {
      setBusy(false);
    }
  };

  const grantSpecial = async (e: FormEvent) => {
    e.preventDefault();
    const n = spName.trim();
    if (!n) return setSpMsg({ text: "칭호명을 입력해주세요." });
    setSpBusy(true);
    try {
      const r = await apiFetch<{ titles: Special[] }>(API.adminSpecialTitle, { body: { channelId, name: n, color: spColor, forced: spForced, bonusPct: Number(spBonus) || 0 } });
      qc.setQueryData(spKey, r);
      setSpName("");
      setSpColor(DEFAULT_TITLE_COLOR);
      setSpMsg({ text: spForced ? "고정 특수 칭호를 지급했어요. 바로 랭킹 닉네임 위에 보이고, 유저가 바꿀 수 없어요." : "특수 칭호를 지급했어요. 유저가 마이페이지에서 장착할 수 있어요.", ok: true });
      setSpForced(false);
      setSpBonus("0");
      qc.invalidateQueries({ queryKey: ["ranking"] });
      onChanged();
    } catch (er) {
      setSpMsg({ text: errOf(er, SPECIAL_ERR) });
    } finally {
      setSpBusy(false);
    }
  };
  const toggleForced = async (t: Special) => {
    try {
      const r = await apiFetch<{ titles: Special[] }>(API.adminSpecialTitle, { body: { channelId, action: "force", id: t.id, forced: !t.forced } });
      qc.setQueryData(spKey, r);
      setSpMsg({ text: t.forced ? `"${t.name}" 고정을 풀었어요. 이제 유저가 고를 수 있어요.` : `"${t.name}"을(를) 고정했어요. 항상 이 칭호가 보여요.`, ok: true });
      qc.invalidateQueries({ queryKey: ["ranking"] });
      onChanged();
    } catch {
      alertDialog("고정 상태를 바꾸지 못했어요.");
    }
  };
  const editBonus = async (t: Special) => {
    const v = window.prompt(`"${t.name}" 적립 보너스(%)를 입력하세요. 0~30, 0이면 없음.`, String(t.bonusPct ?? 0));
    if (v == null) return;
    const pct = Number(v.trim());
    if (!Number.isInteger(pct) || pct < 0 || pct > 30) return alertDialog("0~30 사이 정수로 입력해주세요.");
    try {
      const r = await apiFetch<{ titles: Special[] }>(API.adminSpecialTitle, { body: { channelId, action: "bonus", id: t.id, bonusPct: pct } });
      qc.setQueryData(spKey, r);
      setSpMsg({ text: `"${t.name}" 적립 보너스를 ${pct}%로 바꿨어요.`, ok: true });
    } catch {
      alertDialog("적립 보너스를 바꾸지 못했어요.");
    }
  };
  const revokeSpecial = async (t: Special) => {
    if (!(await confirmDialog(`"${t.name}" 특수 칭호를 회수할까요?`, { danger: true }))) return;
    try {
      const r = await apiFetch<{ titles: Special[] }>(API.adminSpecialTitle, { body: { channelId, action: "revoke", id: t.id } });
      qc.setQueryData(spKey, r);
      setSpMsg({ text: `"${t.name}" 특수 칭호를 회수했어요.`, ok: true });
      qc.invalidateQueries({ queryKey: ["ranking"] });
      onChanged();
    } catch {
      alertDialog("특수 칭호를 회수하지 못했어요.");
    }
  };

  return (
    <Modal open={open} onClose={onClose} wide title={`${name} 칭호 관리`}>
      <div className={styles.detail}>
        <h4 className={styles.detailH}>보유 칭호</h4>
        {owned.length === 0 ? (
          <p className={styles.muted}>보유한 칭호가 없어요.</p>
        ) : (
          <div className={styles.chips}>
            {owned.map((t) => (
              <span key={t.id} className={styles.chip}>
                <TitleText name={t.name} value={t.color} />
                <span className={styles.muted}>
                  {t.kind === "custom" ? "관리자 지급" : "상점 칭호"}
                  {t.equipped ? " · 장착 중" : ""}
                </span>
                <button type="button" className={styles.linkBtn} onClick={() => revoke(t)}>
                  회수
                </button>
              </span>
            ))}
          </div>
        )}

        <h4 className={styles.detailH}>칭호 지급</h4>
        <form className={styles.grantForm} onSubmit={grant} autoComplete="off">
          <div className="segment" role="tablist">
            {(["new", "existing"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setMsg(null);
                }}
              >
                {m === "new" ? "새로 만들기" : "기존 칭호 주기"}
              </button>
            ))}
          </div>
          {mode === "new" ? (
            <>
              <label className="field">
                <span className="field-label">칭호명 (최대 20자)</span>
                <input className="input" maxLength={20} placeholder="예: 1호 팬" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </label>
              <div className="field">
                <span className="field-label">칭호 꾸미기</span>
                <TitleColorPicker value={newColor} onChange={setNewColor} previewName={newName} />
              </div>
            </>
          ) : (
            <>
              <div className={styles.subTabs}>
                {(["shop", "custom"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={kind === k ? styles.on : ""}
                    onClick={() => {
                      setKind(k);
                      setPicked(null);
                      setMsg(null);
                    }}
                  >
                    {k === "shop" ? "상점 칭호" : "커스텀 칭호"} {titlesQ.data && <span className="num">{countOf(k)}</span>}
                  </button>
                ))}
              </div>
              <p className={styles.muted}>{EXISTING_HELP[kind]}</p>
              <div className={styles.pickList} role="radiogroup">
                {titlesQ.isLoading && <p className={styles.muted}>불러오는 중...</p>}
                {titlesQ.isError && <p className={styles.muted}>칭호 목록을 불러오지 못했어요.</p>}
                {titlesQ.data && choices.length === 0 && (
                  <p className={styles.muted}>
                    {all.some((t) => t.kind === kind) ? "이 유저가 이미 전부 가지고 있어요." : kind === "shop" ? "상점 칭호가 아직 없어요." : "만들어 준 커스텀 칭호가 아직 없어요."}
                  </p>
                )}
                {choices.map((t) => (
                  <button key={t.id} type="button" role="radio" aria-checked={picked === t.id} className={`${styles.pick} ${picked === t.id ? styles.on : ""}`} onClick={() => setPicked(t.id)}>
                    <TitleText name={t.name} value={t.color} />
                  </button>
                ))}
              </div>
            </>
          )}
          {msg && <p className={`status ${msg.ok ? "ok" : "error"}`}>{msg.text}</p>}
          <div className={styles.formEnd}>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              지급하기
            </button>
          </div>
        </form>

        <h4 className={styles.detailH}>특수 칭호</h4>
        <p className={styles.muted}>
          랭킹에서 닉네임 위에 작은 글씨로 보여요. 유저가 마이페이지에서 하나 골라 장착해요. <b>고정</b>한 칭호는 항상 그게 보이고 유저가 해제·변경할 수 없어요. 지난달 1~3위
          칭호는 매달 1일에 자동으로 지급돼요. (비공개 유저는 안 보임)
        </p>
        {spQ.data && spQ.data.titles.length === 0 && <p className={styles.muted}>지급한 특수 칭호가 없어요.</p>}
        {spQ.data && spQ.data.titles.length > 0 && (
          <div className={styles.chips}>
            {spQ.data.titles.map((t) => (
              <span key={t.id} className={styles.chip}>
                <SpecialTitleLine list={[t]} />
                <span className={styles.muted}>
                  {t.source === "monthly" ? "랭킹 보상" : "관리자 지급"}
                  {t.forced ? " · 고정" : ""}
                  {t.bonusPct ? ` · 적립 +${t.bonusPct}%` : ""}
                </span>
                <button type="button" className={styles.linkBtn} onClick={() => editBonus(t)}>
                  보너스
                </button>
                <button type="button" className={styles.linkBtn} onClick={() => toggleForced(t)}>
                  {t.forced ? "고정 풀기" : "고정"}
                </button>
                <button type="button" className={styles.linkBtn} onClick={() => revokeSpecial(t)}>
                  회수
                </button>
              </span>
            ))}
          </div>
        )}
        {spQ.isError && <p className="status error">특수 칭호를 불러오지 못했어요.</p>}
        <form className={styles.grantForm} onSubmit={grantSpecial} autoComplete="off">
          <label className="field">
            <span className="field-label">칭호명 (최대 20자)</span>
            <input className="input" maxLength={20} placeholder="예: 도박중독" value={spName} onChange={(e) => setSpName(e.target.value)} />
          </label>
          <div className="field">
            <span className="field-label">칭호 꾸미기</span>
            <TitleColorPicker value={spColor} onChange={setSpColor} previewName={spName} mode="special" />
          </div>
          <label className="field">
            <span className="field-label">적립 보너스 % (0~30, 0이면 없음)</span>
            <input className="input" type="number" min={0} max={30} step={1} inputMode="numeric" value={spBonus} onChange={(e) => setSpBonus(e.target.value)} style={{ maxWidth: 120 }} />
            <span className={styles.muted}>장착하는 동안 출석체크·방송 코드·방송 후기·게시판 활동으로 받는 포인트가 이만큼 더 들어와요. (미니게임·투표·후원 적립엔 안 붙음)</span>
          </label>
          <label className={styles.checkRow}>
            <input type="checkbox" checked={spForced} onChange={(e) => setSpForced(e.target.checked)} />
            <span>
              <b>고정으로 지급</b> — 바로 보이고, 유저가 해제하거나 다른 특수 칭호로 바꿀 수 없어요.
            </span>
          </label>
          {spMsg && <p className={`status ${spMsg.ok ? "ok" : "error"}`}>{spMsg.text}</p>}
          <div className={styles.formEnd}>
            <button type="submit" className="btn btn-primary" disabled={spBusy}>
              특수 칭호 지급
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
