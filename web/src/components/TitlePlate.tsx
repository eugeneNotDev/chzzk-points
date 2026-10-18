// 칭호 플레이트 부품 — 랭킹 줄·시상대에서 씀(계산은 lib/titlePlate.ts, 모양은 styles/title-plate.css).
import { useId, useMemo, type CSSProperties, type ReactNode } from "react";
import { TITLE_ICON_MAP } from "../lib/titleIcons";
import { TITLE_ICON_CY } from "../lib/titleIconCenter";
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
    <span
      className={plate.tag.className}
      style={plate.tag.icon ? ({ ...plate.tag.style, "--icy": TITLE_ICON_CY[plate.tag.icon] ?? 0 } as CSSProperties) : plate.tag.style}
    >
      {dot && (
        <span className="tp-dot" aria-hidden="true">
          ·
        </span>
      )}
      {plate.tag.icon &&
        (plate.tag.iconStops ? (
          <GradIcon id={plate.tag.icon} stops={plate.tag.iconStops} flow={plate.tag.iconFlow} />
        ) : (
          <TitleIconSvg id={plate.tag.icon} className="tp-icon" />
        ))}
      <span className="tp-tx">{name}</span>
    </span>
  );
}

// 그라데이션 아이콘 — 일반 아이콘과 똑같은 SVG(위치·크기 동일)에, 칠만 SVG 그라데이션으로.
// 칭호 글자와 같은 색 순서로 왼쪽 위 → 오른쪽 아래.
// flow(무지개): 글자처럼 가로로 흐름 — 한 바퀴가 아이콘 폭 2배, 6초에 한 바퀴(글자 애니메이션과 같은 속도·방향).
function GradIcon({ id, stops, flow }: { id: string; stops: [number, string][]; flow?: boolean }) {
  const gid = "tpg" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const icon = TITLE_ICON_MAP.get(id);
  if (!icon) return null;
  const inner = icon.inner ?? `<path d="${icon.d}"/>`;
  return (
    <svg className="tp-icon" viewBox={icon.viewBox ?? "0 0 256 256"} aria-hidden="true">
      <defs>
        {flow ? (
          <linearGradient id={gid} x1="0" y1="0" x2="2" y2="0" spreadMethod="repeat">
            {stops.map(([o, c], i) => (
              <stop key={i} offset={o} stopColor={c} />
            ))}
            <animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="2 0" dur="6s" repeatCount="indefinite" />
          </linearGradient>
        ) : (
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            {stops.map(([o, c], i) => (
              <stop key={i} offset={o} stopColor={c} />
            ))}
          </linearGradient>
        )}
      </defs>
      <g fill={`url(#${gid})`} dangerouslySetInnerHTML={{ __html: inner }} />
    </svg>
  );
}

/** 칭호 글자만(플레이트 없이) — 관리자 목록·마이페이지 요약처럼 작게 보여줄 때. 칭호 값이 없으면 이름만. */
export function TitleText({ name, value, dot = false }: { name: string; value: string | null | undefined; dot?: boolean }) {
  const plate = useTitlePlate(value);
  if (!plate) return <span>{name}</span>;
  return <TitleTag name={name} plate={plate} dot={dot} />;
}

/** 칭호 무대 — 칭호 플레이트 칸 가운데에 칭호 글자를 크게(+ 아래 작은 글씨). onClick이 있으면 눌러서 미리보기. */
export function TitleStage({ name, value, sub, onClick, className = "" }: { name: string; value: string | null | undefined; sub?: ReactNode; onClick?: () => void; className?: string }) {
  const plate = useTitlePlate(value);
  return (
    <button type="button" className={`tp-stage-btn ${className}`} onClick={onClick} disabled={!onClick} aria-label={`${name} 칭호 장착 미리보기`}>
      <span className={`tp-stage ${plate ? `${plate.className} tp-card` : ""}`} style={plate?.style}>
        {plate?.star && <PlateStars />}
        <span className="tp-stage-tag">{plate ? <TitleTag name={name} plate={plate} dot={false} /> : name}</span>
        {sub && <span className="tp-stage-sub">{sub}</span>}
      </span>
    </button>
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
