// 칭호 플레이트 부품 — 랭킹 줄·시상대에서 씀(계산은 lib/titlePlate.ts, 모양은 styles/title-plate.css).
import { useMemo, type CSSProperties } from "react";
import { TITLE_ICON_MAP } from "../lib/titleIcons";
import { titlePlate } from "../lib/titlePlate";
import { useTheme } from "../lib/theme";
import { TitleIconSvg } from "./TitleBadge";

const STAR_PATH = "M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6z";

/** 칭호 값 → 플레이트(테마가 바뀌면 다시 계산). 칭호가 없으면 null. */
export function useTitlePlate(value: string | null | undefined) {
  const { theme } = useTheme();
  return useMemo(() => titlePlate(value, theme === "light"), [value, theme]);
}

/** 닉네임 뒤 "· 🐺 알파" */
export function TitleTag({ name, plate, dot = true }: { name: string; plate: NonNullable<ReturnType<typeof titlePlate>>; dot?: boolean }) {
  return (
    <span className={plate.tag.className} style={plate.tag.style}>
      {dot && (
        <span className="tp-dot" aria-hidden="true">
          ·
        </span>
      )}
      {plate.tag.icon && (plate.tag.iconGrad ? <GradIcon id={plate.tag.icon} /> : <TitleIconSvg id={plate.tag.icon} className="tp-icon" />)}
      <span className="tp-tx">{name}</span>
    </span>
  );
}

// 그라데이션 아이콘 — 아이콘 모양을 마스크로 쓰고 바탕을 그라데이션(--icg)으로 칠함
const maskCache = new Map<string, string>();
function iconMask(id: string) {
  let m = maskCache.get(id);
  if (!m) {
    const icon = TITLE_ICON_MAP.get(id);
    if (!icon) return "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox ?? "0 0 256 256"}" fill="#000">${icon.inner ?? `<path d="${icon.d}"/>`}</svg>`;
    m = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
    maskCache.set(id, m);
  }
  return m;
}
function GradIcon({ id }: { id: string }) {
  return <span className="tp-icon tp-mi" style={{ "--m": iconMask(id) } as CSSProperties} aria-hidden="true" />;
}

/** 반짝 별 장식(칭호에 별이 있을 때) — 플레이트 안에 넣음 */
export function PlateStars() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <svg key={i} className={`tp-sp tp-sp${i}`} viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d={STAR_PATH} />
        </svg>
      ))}
    </>
  );
}
