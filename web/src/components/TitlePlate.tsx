// 칭호 플레이트 부품 — 랭킹 줄·시상대에서 씀(계산은 lib/titlePlate.ts, 모양은 styles/title-plate.css).
import { useId, useMemo, type CSSProperties, type ReactNode } from "react";
import { TITLE_ICON_MAP } from "../lib/titleIcons";
import { TITLE_ICON_CY } from "../lib/titleIconCenter";
import { titlePlate, type TitlePlate as TitlePlateT } from "../lib/titlePlate";
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
        <PlateBg bg={plate?.bg} />
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

/** 칭호 배경(밤하늘·무지개 하늘) 장식 — 플레이트 안에 넣음. 배경이 없으면 아무것도 안 그림. */
export function PlateBg({ bg }: { bg: TitlePlateT["bg"] | undefined }) {
  if (bg === "night") return <PlateDream />;
  if (bg === "sky") return <PlateSky />;
  return null;
}

// 밤하늘 배경 — 잔별이 하나씩 따로 반짝이고(타이밍·크기 제각각) 구석에 초승달. 플레이트 안에 넣음.
// [가로 %, 세로 %, 크기 px, 주기 s, 시작 지연 s] — 세 번째마다 십자 대신 작은 점
const DREAM_STARS: [number, number, number, number, number][] = [
  [8, 22, 9, 3.2, 0],
  [19, 68, 5, 4.1, 1.3],
  [31, 18, 7, 3.6, 2.4],
  [46, 72, 6, 4.4, 0.6],
  [58, 20, 8, 3.9, 1.9],
  [69, 66, 5, 3.4, 3.0],
  [80, 26, 6, 4.2, 0.2],
  [25, 45, 10, 5.0, 2.9],
  [52, 48, 5, 4.6, 3.6],
  [90, 70, 4, 3.8, 1.1],
];
export function PlateDream() {
  return (
    <span className="tp-sky" aria-hidden="true">
      <span className="tp-moon" />
      {DREAM_STARS.map(([x, y, s, d, dl], i) => {
        const style = { "--x": `${x}%`, "--y": `${y}%`, "--s": `${s}px`, "--d": `${d}s`, "--dl": `-${dl}s` } as CSSProperties;
        return i % 3 === 2 ? (
          <span key={i} className="tp-dstar tp-dstar--dot" style={style} />
        ) : (
          <svg key={i} className="tp-dstar" viewBox="0 0 24 24" style={style}>
            <path fill="currentColor" d={STAR_PATH} />
          </svg>
        );
      })}
    </span>
  );
}

// 무지개 하늘 배경 — 무지개 아치 + 천천히 좌우로 흘러가는 구름과 양(네루).
// [가로 %, 세로 %, 폭 px, 주기 s, 시작 지연 s, 양?] — 랭킹 줄은 좁아서 2개만, 시상대·상점 칸은 5개
const SKY_ROW: [number, number, number, number, number, boolean][] = [
  [34, 2, 18, 40, 0, false],
  [55, 56, 24, 38, 4, true],
];
const SKY_CARD: [number, number, number, number, number, boolean][] = [
  [4, 62, 30, 40, 0, false],
  [7, 8, 30, 38, 6, true],
  [30, 4, 20, 46, 8, false],
  [80, 62, 30, 46, 22, true],
  [78, 6, 26, 52, 20, false],
];
const CLOUD_PATH = "M14 30a10 10 0 0 1 0-20a13 13 0 0 1 24-4a11 11 0 0 1 16 8a8 8 0 0 1 0 16z";
function SkyCloud({ c, where }: { c: (typeof SKY_ROW)[number]; where: "row" | "card" }) {
  const [x, y, w, d, dl, sheep] = c;
  const style = { "--x": `${x}%`, "--y": `${y}%`, "--w": `${w}px`, "--d": `${d}s`, "--dl": `-${dl}s` } as CSSProperties;
  const cls = `tp-cloud tp-cloud--${where}`;
  return sheep ? (
    <svg className={`${cls} tp-cloud--sheep`} viewBox="0 0 64 40" style={style}>
      <path className="tp-wool" d="M16 28a9 9 0 0 1-2-17a11 11 0 0 1 20-5a10 10 0 0 1 16 6a8 8 0 0 1 0 16z" />
      <ellipse className="tp-sheep-face" cx="51" cy="20" rx="6" ry="7.5" />
      <ellipse className="tp-sheep-face" cx="46" cy="15" rx="3" ry="1.6" transform="rotate(-25 46 15)" />
      <rect className="tp-sheep-face" x="20" y="27" width="3" height="8" rx="1.5" />
      <rect className="tp-sheep-face" x="38" y="27" width="3" height="8" rx="1.5" />
    </svg>
  ) : (
    <svg className={cls} viewBox="0 0 64 32" style={style}>
      <path d={CLOUD_PATH} />
    </svg>
  );
}
export function PlateSky() {
  return (
    <span className="tp-sky" aria-hidden="true">
      <span className="tp-arc" />
      {SKY_ROW.map((c, i) => (
        <SkyCloud key={`r${i}`} c={c} where="row" />
      ))}
      {SKY_CARD.map((c, i) => (
        <SkyCloud key={`c${i}`} c={c} where="card" />
      ))}
    </span>
  );
}
