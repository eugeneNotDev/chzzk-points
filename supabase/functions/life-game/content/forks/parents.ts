// 우진 키우기 갈림길 — 부모님.
import type { Ctx, Fork } from "../../engine.ts";
import { josa } from "../../josa.ts";
import { R, anyParent, dice, fx, parentOld, parentsTitle, pick } from "../util.ts";
import { HOUSES } from "../world.ts";

// 쓰러지실 부모님 — 68세 이상이고 아직 쓰러진 적 없는 분(엄마 먼저)
function sickParent(c: Ctx): "mom" | "dad" | null {
  for (const w of ["mom", "dad"] as const) {
    const p = c.person(w);
    if (p && c.age - p.born >= 68 && !c.has(`par_sick_${w}`)) return w;
  }
  return null;
}
function markParentSick(c: Ctx) {
  const w = sickParent(c);
  if (w) c.add(`par_sick_${w}`);
  return w;
}

export const parentsForks: Fork[] = [
  {
    id: "par_support", a: [24, 36], tag: "가족", t: (c) => `${josa(parentsTitle(c), "이")} 결혼·집 자금을 보태주겠다고 하신다.`,
    if: (c) => anyParent(c) && (c.s.house === "normal" || c.s.house === "comfy" || c.s.house === "rich"),
    opts: [
      pick("감사히 받는다", R((c) => `${parentsTitle(c)}께 ${Math.round((HOUSES.find((h) => h.id === c.s.house)!.support) / 100) * 100}만원을 받았다.`, fx({ happy: 2 }, 0, { fn: (c) => c.money(HOUSES.find((h) => h.id === c.s.house)!.support) }))),
      pick("스스로 하겠다며 사양한다", R((c) => `${josa(parentsTitle(c), "이")} 서운해하시면서도 뿌듯해하셨다.`, fx({ charm: 2, happy: 1 }, 0, { fn: (c) => { c.bond(c.person("mom"), 6); c.bond(c.person("dad"), 6); } }))),
    ],
  },
  {
    id: "par_trouble", a: [22, 50], tag: "가족", t: "아빠 가게가 어려워졌다고 한다.", if: (c) => !!c.person("dad") && (c.s.house === "poor" || c.s.house === "normal"),
    opts: [
      pick("돈을 보태드린다", R("아빠가 아무 말 없이 어깨를 두드렸다.", fx({ happy: 2 }, 0, { fn: (c) => c.bond(c.person("dad"), 15) })), { cost: 1000 }),
      pick("마음만 전한다", R("미안한 마음에 밤잠을 설쳤다.", fx({ happy: -3 }))),
    ],
  },
  {
    // 부모님마다 한 번만(전엔 rep 8이라 요양병원에 모신 엄마가 8년 뒤 또 쓰러지는 일이 있었음)
    id: "par_sick", a: [30, 75], rep: 2, w: 10, tag: "가족", t: (c) => `${sickParent(c) === "mom" ? "엄마" : "아빠"}가 쓰러지셨다.`,
    if: (c) => !!sickParent(c),
    opts: [
      pick("직접 간병한다", R("한동안 병원에서 쪽잠을 잤다.", fx({ happy: -3, health: -3 }, 0, { fn: (c) => { const w = markParentSick(c); if (w) c.bond(c.person(w), 12); } }))),
      pick("좋은 요양병원에 모신다", R("주말마다 찾아뵀다.", fx({ happy: -1 }, 0, { fn: (c) => { const w = markParentSick(c); if (w) c.bond(c.person(w), 4); } })), { cost: 2000 }),
      pick("바빠서 자주 못 간다", R("전화만 드렸다. 마음이 무거웠다.", fx({ happy: -4 }, 0, { fn: (c) => { const w = markParentSick(c); if (w) c.bond(c.person(w), -8); } }))),
    ],
  },
  {
    id: "par_live", a: [38, 62], tag: "가족", t: (c) => `${josa(parentsTitle(c), "을")} 모시고 살지 고민 중이다.`, if: (c) => parentOld(c, 70),
    opts: [
      pick("모시고 산다", R("집이 다시 북적거렸다.", fx({ happy: 3 }, -500, { add: ["filial"], fn: (c) => { c.bond(c.person("mom"), 10); c.bond(c.person("dad"), 10); } }))),
      pick("근처로 이사한다", R("주말마다 반찬을 들고 찾아갔다.", fx({ happy: 2 }, -200, { fn: (c) => { c.bond(c.person("mom"), 5); c.bond(c.person("dad"), 5); } }))),
    ],
  },
  {
    id: "chaebol_heir", a: [30, 55], tag: "가족", t: "회장님인 아빠가 회사를 물려받을 생각이 있냐고 물으셨다.", if: (c) => c.s.house === "rich" && !!c.person("dad") && c.s.job !== "ceo" && !c.has("in_college"),
    opts: [
      dice("물려받겠다고 한다", "intel", {
        good: R("후계자로 인정받았다. 아빠 밑에서 경영 수업이 시작됐다.", fx({ happy: 3 }, 0, { fn: (c) => c.hire("ceo") }), true),
        bad: R("이사회가 반대했다. 형제들 눈빛이 차가웠다.", fx({ happy: -5 }, 0, { fn: (c) => c.bond(c.person("dad"), -10) })),
      }),
      pick("내 길을 가겠다고 한다", R("아빠가 한참 말이 없으셨다.", fx({ happy: 2, charm: 1 }, 0, { add: ["disinherit"], fn: (c) => c.bond(c.person("dad"), -10) })), { hint: "유산 ↓" }),
    ],
  },
];
