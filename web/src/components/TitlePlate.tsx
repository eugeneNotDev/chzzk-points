// 칭호 플레이트 부품 — 랭킹 줄·시상대에서 씀(계산은 lib/titlePlate.ts, 모양은 styles/title-plate.css).
import { useMemo } from "react";
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
      {plate.tag.icon && <TitleIconSvg id={plate.tag.icon} className="tp-icon" />}
      <span className="tp-tx">{name}</span>
    </span>
  );
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
