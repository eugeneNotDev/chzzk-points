// 칭호 꾸미기 — 상점 칭호 상품 추가/수정, 관리자 칭호 지급에서 같이 씀.
//  - 색: 예시 동그라미 / 색상표(+) / HEX 직접 입력, 무지개
//  - 두 가지 색: 그라데이션 또는 배경색+글자색
//  - 디자인: 기본 / 메탈 반짝 / 빛나는 테두리 / 유리
//  - 장식: 아이콘 70여 개 중 하나 + 반짝이 별
// mode="special"이면 특수 칭호(닉네임 윗줄 글씨)용 — 디자인은 기본/광택만, 별·배경+글자 없음.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ChevronRight, Plus, X } from "lucide-react";
import { TITLE_ICONS, TITLE_ICON_MAP } from "../lib/titleIcons";
import {
  composeTitleStyle,
  DEFAULT_TITLE_COLOR,
  parseHexColorInput,
  parseTitleStyle,
  TITLE_COLOR_PRESETS,
  TITLE_DESIGNS,
  titleBadgeTextColor,
  type TitleStyle,
} from "../lib/titleStyle";
import { SpecialTitleLine, TitleIconSvg } from "./TitleBadge";
import { TitleText } from "./TitlePlate";
import { RankingList } from "./RankingList";
import type { RankingRow } from "../lib/homeData";
import styles from "./TitleColorPicker.module.css";

const SPECIAL_DESIGNS = [
  { id: "basic", name: "기본" },
  { id: "shine", name: "금속 광택" },
] as const;

export function TitleColorPicker({
  value,
  onChange,
  previewName,
  mode = "badge",
}: {
  value: string;
  onChange: (v: string) => void;
  previewName?: string;
  mode?: "badge" | "special";
}) {
  const special = mode === "special";
  const normalize = (st: TitleStyle): TitleStyle => (special ? { ...st, design: st.design === "shine" ? "shine" : "basic", star: false, mix: "grad" } : st);
  const state = useMemo(() => normalize(parseTitleStyle(value)), [value, special]); // eslint-disable-line react-hooks/exhaustive-deps
  const [lastHex2, setLastHex2] = useState(state.color2 || "#5dc8ff");
  const [iconOpen, setIconOpen] = useState(false);
  const set = (patch: Partial<TitleStyle>) => {
    const next = { ...state, ...patch };
    if (next.color2) setLastHex2(next.color2);
    onChange(composeTitleStyle(normalize(next)));
  };
  const isRainbow = state.color === "rainbow";
  const duoOn = !!state.color2;
  const labels = !duoOn ? ["색", ""] : state.mix === "ink" ? ["배경색", "글자색"] : ["왼쪽 색", "오른쪽 색"];
  const designs = special ? SPECIAL_DESIGNS : TITLE_DESIGNS;
  const name = (previewName || "").trim() || "칭호";
  const currentIcon = state.icon ? TITLE_ICON_MAP.get(state.icon) : undefined;

  function setGroupColor(group: 1 | 2, v: string) {
    if (group === 1) set(v === "rainbow" ? { color: v, color2: null } : { color: v });
    else set({ color2: v });
  }

  return (
    <div className={styles.picker}>
      <ColorGroup
        label={labels[0]}
        current={state.color}
        withRainbow
        onPick={(v) => setGroupColor(1, v)}
      />

      <div className={styles.duoBar}>
        <label className="check">
          <input type="checkbox" checked={duoOn} disabled={isRainbow} onChange={(e) => set({ color2: e.target.checked && !isRainbow ? lastHex2 : null })} />
          두 가지 색 섞기
        </label>
        {duoOn && !special && (
          <div className="segment">
            <button type="button" aria-selected={state.mix === "grad"} onClick={() => set({ mix: "grad" })}>
              그라데이션
            </button>
            <button type="button" aria-selected={state.mix === "ink"} onClick={() => set({ mix: "ink" })}>
              배경색 + 글자색
            </button>
          </div>
        )}
        {duoOn && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => set({ color: state.color2!, color2: state.color })}>
            <ArrowLeftRight size={14} aria-hidden="true" /> 순서 바꾸기
          </button>
        )}
        {isRainbow && <span className="muted" style={{ fontSize: 12 }}>무지개는 두 번째 색이랑 같이 못 써요</span>}
      </div>

      {duoOn && <ColorGroup label={labels[1]} current={state.color2!} onPick={(v) => setGroupColor(2, v)} />}

      <div className={styles.row}>
        <span className={styles.rowLabel}>디자인</span>
        <div className={styles.designs} role="radiogroup" aria-label="칭호 디자인">
          {designs.map((d) => {
            const sample = composeTitleStyle({ ...state, design: d.id as TitleStyle["design"], icon: null, star: false });
            return (
              <button key={d.id} type="button" role="radio" aria-checked={state.design === d.id} className={`${styles.design} ${state.design === d.id ? styles.on : ""}`} onClick={() => set({ design: d.id as TitleStyle["design"] })}>
                <span className={styles.designSample}>{special ? <SpecialTitleLine list={[{ name: "가나다", color: sample }]} /> : <TitleText name="가나" value={sample} />}</span>
                <span>{d.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.row}>
        <span className={styles.rowLabel}>장식</span>
        <button type="button" className={`btn btn-sm ${styles.iconBtn}`} onClick={() => setIconOpen(true)}>
          {currentIcon ? (
            <>
              <TitleIconSvg id={currentIcon.id} className={styles.glyph} /> 아이콘: {currentIcon.name}
            </>
          ) : (
            "아이콘 붙이기"
          )}
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        {!special && (
          <label className="check">
            <input type="checkbox" checked={state.star} onChange={(e) => set({ star: e.target.checked })} />
            반짝이 별
          </label>
        )}
      </div>

      <div className={styles.preview}>
        <span className="muted" style={{ fontSize: 12 }}>
          {special ? "랭킹 미리보기" : "미리보기"}
        </span>
        {/* 실제 랭킹 줄과 같은 부품으로 — 일반 칭호는 줄 플레이트 + 닉네임 뒤 글자, 특수 칭호는 닉네임 위 */}
        <div className={styles.rowPreview}>
          <RankingList rows={[previewRow(name, composeTitleStyle(state), special)]} hideRank />
        </div>
      </div>

      {iconOpen && (
        <IconDialog
          current={state.icon}
          preview={special ? <SpecialTitleLine list={[{ name, color: composeTitleStyle(state) }]} /> : <TitleText name={name} value={composeTitleStyle(state)} />}
          onPick={(id) => {
            set({ icon: id });
            setIconOpen(false);
          }}
          onClose={() => setIconOpen(false)}
        />
      )}
    </div>
  );
}

function ColorGroup({ label, current, withRainbow = false, onPick }: { label: string; current: string; withRainbow?: boolean; onPick: (v: string) => void }) {
  const [hex, setHex] = useState(current === "rainbow" ? "" : current);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setHex(current === "rainbow" ? "" : current);
    setInvalid(false);
  }, [current]);
  const isPreset = TITLE_COLOR_PRESETS.some((p) => p.value === current);
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <span className={styles.rowLabel}>{label}</span>
        <label className={styles.hexField}>
          <span>HEX</span>
          <input
            type="text"
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            className={invalid ? styles.invalid : ""}
            placeholder={current === "rainbow" ? "무지개" : "#00e5a0"}
            value={hex}
            onChange={(e) => {
              setHex(e.target.value);
              const parsed = parseHexColorInput(e.target.value);
              if (parsed && /^#?[0-9a-fA-F]{6}$/.test(e.target.value.trim())) onPick(parsed);
              else setInvalid(e.target.value.trim().length > 0);
            }}
            onBlur={() => {
              const parsed = parseHexColorInput(hex);
              if (parsed) onPick(parsed);
              else {
                setHex(current === "rainbow" ? "" : current);
                setInvalid(false);
              }
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), (e.target as HTMLInputElement).blur())}
          />
        </label>
      </div>
      <div className={styles.swatches} role="radiogroup" aria-label={label || "색"}>
        {TITLE_COLOR_PRESETS.filter((p) => withRainbow || p.value !== "rainbow").map((p) => (
          <button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={p.value === current}
            aria-label={p.name}
            title={p.name}
            className={`${styles.swatch} ${p.value === "rainbow" ? styles.rainbow : ""} ${p.value === current ? styles.selected : ""}`}
            style={{ ["--swatch" as string]: p.value === "rainbow" ? "transparent" : p.value, ["--swatch-fg" as string]: titleBadgeTextColor(p.value) }}
            onClick={() => onPick(p.value)}
          />
        ))}
        <label
          className={`${styles.swatch} ${styles.custom} ${!isPreset ? styles.selected : ""}`}
          title="색상표에서 직접 고르기"
          style={!isPreset ? { ["--swatch" as string]: current, ["--swatch-fg" as string]: titleBadgeTextColor(current) } : undefined}
        >
          <Plus size={14} aria-hidden="true" />
          <input type="color" value={current === "rainbow" ? DEFAULT_TITLE_COLOR : current} onChange={(e) => onPick(e.target.value)} aria-label="색상표에서 직접 고르기" />
        </label>
      </div>
    </div>
  );
}

function IconDialog({ current, preview, onPick, onClose }: { current: string | null; preview: React.ReactNode; onPick: (id: string | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    d.querySelector(`.${styles.iconSel}`)?.scrollIntoView({ block: "nearest" });
    // Esc로 닫을 때 뒤의 상점/관리자 팝업까지 같이 닫히지 않게 여기서 멈춤
    const onCancel = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    d.addEventListener("cancel", onCancel);
    return () => d.removeEventListener("cancel", onCancel);
  }, [onClose]);
  let lastGroup = "";
  return (
    <dialog ref={ref} className={`modal ${styles.iconDialog}`} aria-label="아이콘 고르기" onClick={(e) => e.target === ref.current && onClose()}>
      <div className="modal-head" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h3>아이콘 고르기</h3>
        <span style={{ fontSize: 16 }}>{preview}</span>
        <button type="button" className="btn btn-ghost icon-btn" style={{ marginLeft: "auto" }} aria-label="닫기" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="modal-body">
        <div className={styles.iconGrid} role="radiogroup" aria-label="아이콘">
          <button type="button" role="radio" aria-checked={!current} className={`${styles.iconOpt} ${styles.none} ${!current ? styles.iconSel : ""}`} onClick={() => onPick(null)}>
            없음
          </button>
          {TITLE_ICONS.map((i) => {
            const head = i.group !== lastGroup;
            lastGroup = i.group;
            return (
              <span key={i.id} style={{ display: "contents" }}>
                {head && <span className={styles.iconGroup}>{i.group}</span>}
                <button type="button" role="radio" aria-checked={current === i.id} title={i.name} aria-label={i.name} className={`${styles.iconOpt} ${current === i.id ? styles.iconSel : ""}`} onClick={() => onPick(i.id)}>
                  <TitleIconSvg id={i.id} className={styles.iconGlyph} />
                </button>
              </span>
            );
          })}
        </div>
      </div>
    </dialog>
  );
}

// 칭호 만들기 미리보기용 가짜 랭킹 줄
function previewRow(name: string, color: string, special: boolean): RankingRow {
  return {
    channel_id: "__preview",
    channel_name: "닉네임",
    total_points: 12345,
    is_public: true,
    tier_title_name: null,
    tier_title_color: null,
    shop_title_name: special ? null : name,
    shop_title_color: special ? null : color,
    special_titles: special ? [{ name, color }] : null,
  };
}
