// 유진 키우기 갈림길 — 늦깎이 전문직 루트(수능을 놓쳐도 노리면 닿게).
import type { Fork } from "../../engine.ts";
import { lateBonus, tuitionFx, tuitionOf } from "../forkUtil.ts";
import { R, dice, fx, inCollege, pick, statModOf } from "../util.ts";
import { eduRank } from "../world.ts";

export const lateCareerForks: Fork[] = [
  {
    id: "med_late", a: [22, 32], w: 20, tag: "공부", t: "의학전문대학원에 도전해볼까? 다시 4년을 공부해야 한다.",
    if: (c) => eduRank(c) >= 2 && c.st("intel") >= 62 && !c.has("med") && !inCollege(c) && c.s.army === 0,
    opts: [
      dice("도전한다", "intel", {
        good: R("의학전문대학원에 합격했다! 다시 학생이 됐다.", { s: { happy: 5 }, fn: (c) => { c.quit("의대생"); tuitionFx("top", 4, true).fn!(c); } }, true),
        bad: R("의학전문대학원 시험에 떨어졌다.", fx({ happy: -3 })),
      }, { bonus: lateBonus, hint: "지능 주사위 · 자기계발 집중·자격증이면 +1" }),
      pick("지금 하던 걸 계속한다", R("의사의 꿈은 접어두기로 했다.", fx({}))),
    ],
  },
  {
    id: "law_school", a: [22, 34], w: 20, tag: "공부", t: "로스쿨에 도전해볼까? 3년 동안 법전과 씨름해야 한다.",
    if: (c) => eduRank(c) >= 2 && c.st("intel") >= 60 && !c.has("lawschool") && !c.has("med") && !inCollege(c) && c.s.army === 0 && c.s.job !== "lawyer",
    opts: [
      dice("도전한다", "intel", {
        good: R("로스쿨에 합격했다. 법전이 베개보다 두꺼웠다.", fx({ intel: 2, happy: 3 }, 0, { add: ["lawschool", "in_college"], fn: (c) => { c.quit("로스쿨생"); c.s.until = c.age + 3; c.s.debt += Math.round(2400 * (1 - tuitionOf(c))); } }), true),
        bad: R("로스쿨 입시에 떨어졌다.", fx({ happy: -3 })),
      }, { bonus: lateBonus, hint: "지능 주사위 · 등록금은 학자금 대출" }),
      pick("지금 하던 걸 계속한다", R("법조인의 꿈은 접어두기로 했다.", fx({}))),
    ],
  },
  {
    id: "late_grad", a: [25, 45], w: 15, tag: "공부", t: "공부를 더 하고 싶다는 생각이 든다. 대학원에 가볼까?",
    if: (c) => eduRank(c) >= 2 && c.s.edu !== "grad" && c.st("intel") >= 58 && !c.has("med") && !inCollege(c) && c.s.army === 0,
    opts: [
      dice("대학원에 간다", "intel", {
        good: R("대학원에 합격했다. 다시 연구실 생활이다.", fx({ intel: 4 }, 0, { fn: (c) => { c.quit("대학원생"); c.s.edu = "grad"; c.s.until = c.age + 2; c.s.debt += Math.round(1500 * (1 - tuitionOf(c))); } }), true),
        bad: R("대학원 입시에 떨어졌다.", fx({ happy: -2 })),
      }, { bonus: lateBonus, hint: "지능 주사위 · 등록금은 학자금 대출" }),
      pick("지금도 충분하다", R("공부는 취미로 하기로 했다.", fx({ happy: 1 }))),
    ],
  },
  {
    id: "idol_debut", a: [16, 24], mile: true, tag: "꿈", t: "연습생 생활 끝에 데뷔 평가 날이 왔다.",
    if: (c) => c.has("trainee") && !c.s.job,
    opts: [
      dice("무대에 오른다", "charm", {
        great: R("데뷔조 센터로 확정됐다! 데뷔 무대부터 화제가 됐다.", fx({ happy: 8 }, 0, { fn: (c) => { c.hire("idol"); c.s.fame = Math.max(c.s.fame, 20); } }), true),
        good: R("데뷔조에 들었다. 드디어 데뷔다.", fx({ happy: 6 }, 0, { fn: (c) => { c.hire("idol"); c.s.fame = Math.max(c.s.fame, 8); } }), true),
        bad: R("데뷔조에서 떨어졌다. 그래도 아직 기회는 있다.", fx({ happy: -4 })),
      }, { bonus: (c) => statModOf(c, "talent"), hint: "매력 주사위 · 끼가 높으면 보정" }),
      pick("연습생을 그만둔다", R("연습실 문을 마지막으로 닫았다.", fx({ happy: -1 }, 0, { del: ["trainee"] }))),
    ],
  },
];
