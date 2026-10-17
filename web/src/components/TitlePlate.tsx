// 칭호 플레이트 부품 — 랭킹 줄·시상대에서 씀(계산은 lib/titlePlate.ts, 모양은 styles/title-plate.css).
import { useId, useMemo } from "react";
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
      {plate.tag.icon && (plate.tag.iconStops ? <GradIcon id={plate.tag.icon} stops={plate.tag.iconStops} /> : <TitleIconSvg id={plate.tag.icon} className="tp-icon" />)}
      <span className="tp-tx">{name}</span>
    </span>
  );
}

// 그라데이션 아이콘 — 일반 아이콘과 똑같은 SVG(위치·크기 동일)에, 칠만 SVG 그라데이션으로.
// 칭호 글자와 같은 색 순서로 왼쪽 위 → 오른쪽 아래.
function GradIcon({ id, stops }: { id: string; stops: [number, string][] }) {
  const gid = "tpg" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const icon = TITLE_ICON_MAP.get(id);
  if (!icon) return null;
  const inner = icon.inner ?? `<path d="${icon.d}"/>`;
  return (
    <svg className="tp-icon" viewBox={icon.viewBox ?? "0 0 256 256"} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          {stops.map(([o, c], i) => (
            <stop key={i} offset={o} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      <g fill={`url(#${gid})`} dangerouslySetInnerHTML={{ __html: inner }} />
    </svg>
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
