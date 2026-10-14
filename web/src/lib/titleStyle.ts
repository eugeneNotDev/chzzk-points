// 칭호 배지 값 해석 — 기존 사이트 chzzk-auth.js의 parseTitleStyle/titleBadgeForeground 등을 TS로 옮긴 것.
// DB엔 titles.color 한 칸에 "색 + 디자인 + 아이콘 + 별" 조합이 문자열로 저장돼 있음:
//   "#00e5a0" / "rainbow" / "shine-crown-ffd43b" / "glow-rainbow" / "book-star-00e5a0"
//   "basic-ff6bb5-5dc8ff"(그라데이션) / "glass-1b1e24-t-f2c230"(배경+글자)
import { TITLE_ICON_MAP } from "./titleIcons";

export type TitleStyle = {
  color: string; // "#rrggbb" | "rainbow"
  color2: string | null;
  mix: "grad" | "ink";
  design: "basic" | "shine" | "glow" | "glass";
  icon: string | null;
  star: boolean;
};

const DEFAULT_TITLE_COLOR = "#00e5a0";
const DESIGNS = new Set(["basic", "shine", "glow", "glass"]);

export function parseTitleStyle(value: unknown): TitleStyle {
  const fallback: TitleStyle = { color: DEFAULT_TITLE_COLOR, color2: null, mix: "grad", design: "basic", icon: null, star: false };
  if (typeof value !== "string" || !value) return fallback;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return { ...fallback, color: v };
  if (v === "rainbow") return { ...fallback, color: "rainbow" };
  const isHex6 = (t: string) => /^[0-9a-f]{6}$/.test(t);
  const parts = v.split("-");
  const last = parts.pop()!;
  let color: string;
  let color2: string | null = null;
  let mix: TitleStyle["mix"] = "grad";
  if (last === "rainbow") {
    color = "rainbow";
  } else if (isHex6(last)) {
    const n = parts.length;
    if (n >= 2 && parts[n - 1] === "t" && isHex6(parts[n - 2])) {
      color = `#${parts[n - 2]}`;
      color2 = `#${last}`;
      mix = "ink";
      parts.length = n - 2;
    } else if (n >= 1 && isHex6(parts[n - 1])) {
      color = `#${parts[n - 1]}`;
      color2 = `#${last}`;
      parts.length = n - 1;
    } else {
      color = `#${last}`;
    }
  } else {
    return fallback;
  }
  let design: TitleStyle["design"] = "basic";
  let icon: string | null = null;
  let star = false;
  for (const p of parts) {
    if (p === "star") star = true;
    else if (TITLE_ICON_MAP.has(p)) icon = p;
    else if (DESIGNS.has(p)) design = p as TitleStyle["design"];
  }
  return { color, color2, mix, design, icon, star };
}

export function hexLuminance(hex: string) {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function mixHex(hex: string, targetHex: string, t: number) {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(targetHex.slice(i, i + 2), 16));
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

function textColorOn(base: string) {
  const contrastWhite = 1.05 / (hexLuminance(base) + 0.05);
  return contrastWhite >= 3 ? "#ffffff" : "#111418";
}

export function titleBadgeForeground({ color, color2, mix, design }: TitleStyle) {
  if (color === "rainbow") return "#ffffff";
  if (color2 && mix === "ink") return color2;
  const base = color2 ? mixHex(color, color2, 0.5) : color;
  if (design === "glow") return mixHex(base, "#ffffff", 0.35);
  if (design === "glass") {
    const light = mixHex(base, "#ffffff", 0.55);
    return hexLuminance(light) < 0.2 ? "#e9ecef" : light;
  }
  return textColorOn(base);
}

// 특수 칭호(닉네임 윗줄 작은 글씨)용 — 어두운 배경에서 너무 어두운 색은 밝게, 밝은 테마에선 너무 밝은 색은 어둡게.
export const spForDark = (hex: string) => (hexLuminance(hex) < 0.18 ? mixHex(hex, "#ffffff", 0.45) : hex);
export function spForLight(hex: string) {
  let c = hex;
  for (let i = 0; i < 4 && hexLuminance(c) > 0.25; i++) c = mixHex(c, "#000000", 0.25);
  return c;
}
