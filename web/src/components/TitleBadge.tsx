import type { CSSProperties } from "react";
import { TITLE_ICON_MAP } from "../lib/titleIcons";
import { mixHex, parseTitleStyle, spForDark, spForLight } from "../lib/titleStyle";

// 아이콘 SVG 내용은 이 사이트 코드에 들어있는 고정 데이터(titleIcons.ts)라 그대로 넣어도 안전함.
export function TitleIconSvg({ id, className = "tb-icon" }: { id: string; className?: string }) {
  const icon = TITLE_ICON_MAP.get(id);
  if (!icon) return null;
  const inner = icon.inner ?? `<path d="${icon.d}"/>`;
  return (
    <svg className={className} viewBox={icon.viewBox ?? "0 0 256 256"} fill="currentColor" aria-hidden="true" dangerouslySetInnerHTML={{ __html: inner }} />
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
