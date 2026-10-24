// 유진 키우기 갈림길 — 병(병이 생긴 해에 바로).
import { josa } from "../../josa.ts";
import type { Fork } from "../../engine.ts";
import { R, dice, fx, pick } from "../util.ts";
import { DISEASES } from "../world.ts";

export const illnessForks: Fork[] = [
  {
    id: "sick_treat", a: [0, 120], rep: 1, tag: "건강", t: (c) => `${c.s.sick?.name ?? "병"}, 치료를 어떻게 할까?`,
    if: (c) => !!c.s.sick,
    opts: [
      dice("큰 병원에서 제대로 치료", "health", {
        great: R("치료가 아주 잘 됐다. 완치 판정을 받았다!", fx({ health: 8, happy: 5 }, 0, { fn: (c) => (c.s.sick = null) }), true),
        good: R("치료가 잘 됐다. 완치됐다.", fx({ health: 4, happy: 3 }, 0, { fn: (c) => (c.s.sick = null) })),
        normal: R("조금 나아졌다. 꾸준히 관리해야 한다.", fx({ health: 2 }, 0, { fn: (c) => c.s.sick && (c.s.sick.sev = Math.max(1, c.s.sick.sev - 1)) })),
        bad: R("치료가 잘 듣지 않았다.", fx({ health: -3, happy: -3 })),
        terrible: R("치료 중 합병증이 왔다.", fx({ health: -8, happy: -5 }, 0, { fn: (c) => c.s.sick && (c.s.sick.sev += 1) })),
      }, {
        cost: (c) => { const d = DISEASES.find((x) => x.id === c.s.sick?.id); return Math.round((d?.cost ?? 1000) * (c.has("insurance") ? 0.3 : 1)); },
        bonus: (c) => (c.has("checkup") ? 2 : 0) + (c.s.sick && c.s.sick.since === c.age ? 1 : 0),
        hint: "건강 주사위 · 일찍 발견하면 +",
      }),
      dice("버티면서 지낸다", null, {
        good: R("이상하게 저절로 좋아졌다.", fx({ happy: 2 }, 0, { fn: (c) => c.s.sick && (c.s.sick.sev = Math.max(0, c.s.sick.sev - 1)) })),
        bad: R("병이 깊어졌다.", fx({ health: -4, happy: -2 }, 0, { fn: (c) => c.s.sick && (c.s.sick.sev += 1) })),
      }, { hint: "돈 안 듦 · 운" }),
    ],
  },
  {
    id: "sick_again", a: [0, 120], rep: 4, w: 15, tag: "건강", t: (c) => `${josa(c.s.sick?.name ?? "병", "이")} 다시 말썽이다.`,
    if: (c) => !!c.s.sick && c.s.sick.since < c.age,
    opts: [
      dice("다시 치료받는다", "health", {
        good: R("이번엔 완치됐다.", fx({ health: 4, happy: 3 }, 0, { fn: (c) => (c.s.sick = null) })),
        bad: R("나아지지 않았다.", fx({ health: -2 })),
      }, { cost: (c) => { const d = DISEASES.find((x) => x.id === c.s.sick?.id); return Math.round((d?.cost ?? 1000) * 0.6 * (c.has("insurance") ? 0.3 : 1)); } }),
      pick("받아들이고 산다", R("병과 함께 사는 법을 배웠다.", fx({ happy: 1 }))),
    ],
  },
];
