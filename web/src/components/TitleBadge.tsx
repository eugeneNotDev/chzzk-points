import type { CSSProperties } from "react";
import { TITLE_ICON_MAP } from "../lib/titleIcons";
import { inkForLight, mixHex, parseTitleStyle, spForDark, spForLight, titleBadgeForeground } from "../lib/titleStyle";

// 아이콘 SVG 내용은 이 사이트 코드에 들어있는 고정 데이터(titleIcons.ts)라 그대로 넣어도 안전함.
export function TitleIconSvg({ id, className = "tb-icon" }: { id: string; className?: string }) {
  const icon = TITLE_ICON_MAP.get(id);
  if (!icon) return null;
  const inner = icon.inner ?? `<path d="${icon.d}"/>`;
  return (
    <svg className={className} viewBox={icon.viewBox ?? "0 0 256 256"} fill="currentColor" aria-hidden="true" dangerouslySetInnerHTML={{ __html: inner }} />
  );
}

const STAR_PATH = "M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6z";

// 상점 구매/관리자 지급 칭호 배지 — 모양은 기존 사이트와 완전히 같음(styles/title-badge.css).
export function TitleBadge({ name, value, className }: { name: string; value: string | null | undefined; className?: string }) {
  const style = parseTitleStyle(value);
  const { color, color2, mix, design, icon, star } = style;
  const classes = ["title-badge"];
  if (design !== "basic") classes.push(`title-badge--${design}`);
  if (color === "rainbow") classes.push("title-badge--rainbow");
  if (color2) classes.push(mix === "ink" ? "title-badge--ink" : "title-badge--duo");
  if (icon) classes.push("title-badge--icon");
  if (star) classes.push("title-badge--starred");
  if (className) classes.push(className);

  let vars: Record<string, string> = {};
  if (color !== "rainbow") {
    vars = {
      "--badge-bg": color,
      "--badge-fg": titleBadgeForeground(style),
      "--badge-light": mixHex(color, "#ffffff", 0.55),
      "--badge-dark": mixHex(color, "#000000", 0.32),
      // 라이트 모드용 — 빛나는 테두리·유리 칭호는 밝은 바탕이 되니 글자를 진하게
      "--badge-deep": inkForLight(color),
      "--badge-fg-l": inkForLight(color2 && mix === "ink" ? color2 : color2 ? mixHex(color, color2, 0.5) : color),
    };
    if (color2) {
      Object.assign(vars, {
        "--badge-bg2": color2,
        "--badge-light2": mixHex(color2, "#ffffff", 0.55),
        "--badge-dark2": mixHex(color2, "#000000", 0.32),
        "--badge-deep2": inkForLight(color2),
      });
    }
  }
  return (
    <span className={classes.join(" ")} style={vars as CSSProperties}>
      {design === "shine" && <span className="tb-sweep" aria-hidden="true" />}
      {icon && <TitleIconSvg id={icon} />}
      <span className="tb-text">{name}</span>
      {star && (
        <span className="tb-stars" aria-hidden="true">
          {[1, 2, 3].map((i) => (
            <svg key={i} className={`tb-star tb-star--${i}`} viewBox="0 0 24 24">
              <path fill="currentColor" d={STAR_PATH} />
            </svg>
          ))}
        </span>
      )}
    </span>
  );
}

export type SpecialTitle = { name: string; color: string };

// 특수 칭호(지난달 1위 + 관리자 지급) — 닉네임 윗줄 작은 글씨.
export function SpecialTitleLine({ list }: { list: SpecialTitle[] | null | undefined }) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return (
    <span className="rk-sp">
      {list.map((t, i) => {
        const { color, color2, design, icon } = parseTitleStyle(t.color);
        let cls = "rk-sp-item";
        const vars: Record<string, string> = {};
        if (color === "rainbow") {
          cls += " rk-sp-item--rainbow";
        } else {
          const d1 = spForDark(color);
          const l1 = spForLight(color);
          vars["--sp"] = d1;
          vars["--sp-l"] = l1;
          if (color2 || design === "shine") {
            cls += " rk-sp-item--grad";
            vars["--sp-grad"] = color2
              ? `linear-gradient(90deg,${d1},${spForDark(color2)})`
              : `linear-gradient(90deg,${mixHex(d1, "#ffffff", 0.45)},${d1} 45%,${mixHex(d1, "#ffffff", 0.3)} 70%,${d1})`;
            vars["--sp-grad-l"] = `linear-gradient(90deg,${l1},${color2 ? spForLight(color2) : mixHex(l1, "#000000", 0.2)})`;
          }
        }
        return (
          <span key={i} style={{ display: "contents" }}>
            {i > 0 && (
              <span className="rk-sp-dot" aria-hidden="true">
                ·
              </span>
            )}
            <span className={cls} style={vars as CSSProperties}>
              {icon && <TitleIconSvg id={icon} className="rk-sp-icon" />}
              <span className="rk-sp-text">{t.name}</span>
            </span>
          </span>
        );
      })}
    </span>
  );
}
