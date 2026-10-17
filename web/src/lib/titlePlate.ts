// 칭호 플레이트 — 랭킹 줄·시상대 닉네임 칸을 칭호 색·테두리로 꾸밀 때 쓰는 값 계산.
// DB의 칭호 값(titles.color, 예: "glow-wolfh-b22222")은 그대로 두고, 그리는 방식만 새로 정한 것.
//   기본(basic)  : 옅은 칭호색 바탕 + 한 색 테두리
//   메탈(shine)  : 옅은 바탕 + 금속 그라데이션 테두리 + 빛이 지나감
//   빛나는(glow) : 속은 어둡게(라이트는 하얗게) + 네온 링이 돌며 번짐
//   유리(glass)  : 반투명 + 비스듬한 반사광
//   두 색(바탕+글자 / 그라데이션) : 바탕·테두리에 두 색이 은은하게
//   무지개, 반짝 별(star)
// 색 계산은 테마(다크/라이트)에 따라 달라서 테마를 받아서 계산함. 모양은 styles/title-plate.css.
import type { CSSProperties } from "react";
import { hexLuminance as lum, inkForLight, mixHex as mix, parseTitleStyle } from "./titleStyle";

const RB_DARK_STOPS = ["#ff6b74", "#ffa94d", "#ffe066", "#a9e34b", "#38f9c0", "#74c0fc", "#b197fc", "#f783ac", "#ff6b74"];
const RB_LIGHT_STOPS = ["#d6336c", "#e8590c", "#b8860b", "#5c940d", "#099268", "#1971c2", "#7048e8", "#c2255c", "#d6336c"];
const RB_DARK = `linear-gradient(90deg,${RB_DARK_STOPS.join(",")})`;
const RB_LIGHT = `linear-gradient(90deg,${RB_LIGHT_STOPS.join(",")})`;

export type TitlePlate = {
  /** 줄·칸에 붙일 클래스 ("tp tp-shine tp-two" 등) */
  className: string;
  /** 줄·칸에 넣을 색 변수 */
  style: CSSProperties;
  /** 닉네임 뒤 칭호 글자 */
  /** iconStops: 칭호에 그라데이션이 있으면 아이콘도 같은 색으로(왼쪽 위 → 오른쪽 아래). [위치 0~1, 색] 목록 */
  /** iconFlow: 아이콘 그라데이션도 글자처럼 흐름(무지개) */
  tag: { className: string; style: CSSProperties; icon: string | null; iconStops?: [number, string][]; iconFlow?: boolean };
  star: boolean;
};

export function titlePlate(value: string | null | undefined, light: boolean): TitlePlate | null {
  if (!value) return null;
  const s = parseTitleStyle(value);
  const { color, color2, mix: mx, design, icon, star } = s;
  const cls = ["tp", `tp-${design}`];
  if (color === "rainbow") cls.push("tp-rainbow");
  if (color2) cls.push("tp-two");
  if (star) cls.push("tp-starred");

  if (color === "rainbow") {
    return {
      className: cls.join(" "),
      style: {},
      tag: {
        className: "tp-tag tp-tag--grad tp-tag--anim",
        style: { "--tc": light ? "#7048e8" : "#ffd43b", "--tg": light ? RB_LIGHT : RB_DARK } as CSSProperties,
        icon,
        iconStops: evenStops(light ? RB_LIGHT_STOPS : RB_DARK_STOPS), // 처음·끝 색이 같아서 반복해도 이음새 없음
        iconFlow: true,
      },
      star,
    };
  }

  const base = color;
  const inkMode = !!color2 && mx === "ink";
  // 테두리용 색: 다크에선 너무 어두운 색은 밝게, 라이트에선 너무 밝은 색은 어둡게
  const edge = (c: string) => (light ? (lum(c) > 0.45 ? mix(c, "#000000", 0.35) : c) : lum(c) < 0.03 ? mix(c, "#ffffff", 0.4) : c);
  // 글자색: 라이트는 읽히게 진하게, 다크는 너무 어두우면 밝게
  const txt = (c: string) => {
    if (light) return inkForLight(c, 0.16);
    let x = c;
    for (let i = 0; i < 6 && lum(x) < 0.2; i++) x = mix(x, "#ffffff", 0.22);
    return x;
  };
  // 바탕 세기: 검정은 다크에선 진하게(검은 판), 라이트에선 옅게 / 흰·은색은 조금 옅게
  const alpha = (c: string) => {
    const L = lum(c);
    if (L < 0.03) return light ? "7%" : "40%";
    if (L > 0.5) return light ? "10%" : "11%";
    return light ? "10%" : "15%";
  };

  const e = edge(base);
  const v: Record<string, string> = {
    "--tint": light && lum(base) > 0.5 ? mix(base, "#000000", 0.25) : base,
    "--edge": e,
    "--blite": mix(e, "#ffffff", 0.6),
    "--bdeep": mix(e, "#000000", 0.45),
    "--ta": alpha(base),
    "--glow-in": light ? `color-mix(in srgb, ${base} 4%, #ffffff)` : `color-mix(in srgb, ${base} 10%, #07090b)`,
  };
  if (design === "glass" && lum(base) < 0.03) v["--tint"] = light ? "#5a616b" : "#3a4049";
  if (color2) {
    const e2 = edge(color2);
    Object.assign(v, {
      "--tint2": color2,
      "--edge2": e2,
      "--blite2": mix(e2, "#ffffff", 0.6),
      "--ta2": light ? "13%" : "18%",
    });
  }
  v["--star"] = color2 || (light ? mix(e, "#000000", 0.1) : "#ffffff");

  // 닉네임 뒤 칭호 글자
  const tag: Record<string, string> = { "--tc": txt(inkMode ? color2! : color2 ? mix(base, color2, 0.5) : base) };
  if (inkMode) tag["--ic"] = txt(base);
  // 칭호 글자에 그라데이션이 있으면 아이콘도 같은 색으로 칠함(iconStops)
  let tagCls = "tp-tag";
  let iconStops: [number, string][] | undefined;
  if (inkMode) {
    // 바탕+글자 칭호(감마·델타 등): 테두리처럼 아이콘·글자도 바탕색 → 글자색
    tag["--tg"] = `linear-gradient(90deg,${txt(base)},${txt(color2!)})`;
    tagCls += " tp-tag--grad";
    iconStops = [
      [0.25, txt(base)],
      [1, txt(color2!)],
    ];
  } else if (design === "shine" && !color2) {
    // 메탈: 밝음 → 본색 → 밝음
    const stops = light ? [inkForLight(base, 0.1), inkForLight(base, 0.22), inkForLight(base, 0.1)] : [mix(txt(base), "#ffffff", 0.45), txt(base), mix(txt(base), "#ffffff", 0.3)];
    tag["--tg"] = `linear-gradient(90deg,${stops[0]},${stops[1]} 50%,${stops[2]})`;
    tagCls += " tp-tag--grad";
    iconStops = evenStops(stops);
  } else if (color2 && !inkMode) {
    tag["--tg"] = `linear-gradient(90deg,${txt(base)},${txt(color2)})`;
    tagCls += " tp-tag--grad";
    iconStops = evenStops([txt(base), txt(color2)]);
  }
  if (design === "glow" && !light) tagCls += " tp-tag--glow";

  return { className: cls.join(" "), style: v as CSSProperties, tag: { className: tagCls, style: tag as CSSProperties, icon, iconStops }, star };
}

function evenStops(colors: string[]): [number, string][] {
  return colors.map((c, i) => [colors.length === 1 ? 0 : i / (colors.length - 1), c]);
}
