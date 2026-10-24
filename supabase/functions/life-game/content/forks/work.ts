// 유진 키우기 갈림길 — 일·돈.
import type { Fork } from "../../engine.ts";
import { R, creatorJob, dice, fx, pick, salaried } from "../util.ts";
import { JOBS } from "../world.ts";

export const workForks: Fork[] = [
  {
    id: "promo", a: [28, 58], rep: 4, w: 14, tag: "일", t: "승진 심사가 다가왔다.", if: (c) => salaried(c) && (c.s.rank ?? 0) < (JOBS.find((j) => j.id === c.s.job)?.ranks?.length ?? 1) - 1,
    opts: [
      dice("밤새 준비한다", "intel", {
        great: R("특진 심사를 통과했다!", fx({ happy: 2, health: -1 }, 0, { fn: (c) => { if (!c.promote(2)) c.s.salary = Math.round(c.s.salary * 1.2); } }), true),
        good: R("심사를 통과했다.", fx({ health: -1 }, 0, { fn: (c) => { if (!c.promote(1)) c.s.salary = Math.round(c.s.salary * 1.1); } })),
        bad: R("이번에도 누락됐다.", fx({ happy: -4, health: -1 })),
      }, { bonus: (c) => (c.s.focus === "work" ? 2 : 0) }),
      pick("될 대로 되라", R("결과를 기다렸다.", fx({}, 0, { fn: (c) => { if (c.chance(0.3)) c.promote(1); } }))),
    ],
  },
  {
    id: "layoff", a: [38, 60], tag: "일", t: "회사가 구조조정을 한다. 명단에 이름이 올랐다는 소문이 돈다.", if: (c) => salaried(c) && c.s.job !== "civil" && c.s.job !== "teacher",
    opts: [
      dice("버틴다", "charm", {
        good: R("살아남았다.", fx({ happy: -1 })),
        bad: R("결국 권고사직을 당했다.", fx({ happy: -8 }, 1500, { fn: (c) => { c.quit("실직자"); c.add("jobless"); } })),
      }),
      pick("희망퇴직을 신청한다", R("두둑한 위로금을 받고 나왔다.", fx({ happy: -2 }, 0, { fn: (c) => { c.money(Math.round(c.s.salary * 1.5)); c.quit("백수"); } }))),
    ],
  },
  {
    id: "scout", a: [27, 52], tag: "일", t: "다른 회사에서 스카우트 제안이 왔다.", if: salaried,
    opts: [
      pick("옮긴다", R("연봉이 올랐다. 일도 늘었다.", fx({ happy: -1 }, 0, { fn: (c) => (c.s.salary = Math.round(c.s.salary * 1.2)) }))),
      pick("남는다", R("익숙한 자리가 편했다.", fx({ happy: 3 }))),
    ],
  },
  {
    id: "career_up", a: [21, 50], rep: 4, w: 16, tag: "일", t: "이대로 계속 {job}만 해도 괜찮을까?", if: (c) => c.s.job === "alba" || c.s.job === "delivery",
    opts: [
      pick("다시 제대로 취업 준비를 한다", R("일을 그만두고 공부를 시작했다.", fx({ intel: 3 }, 0, { add: ["cert"], fn: (c) => c.quit("취준생") }))),
      pick("지금이 편하다", R("익숙한 하루를 이어갔다.", fx({ happy: 1 }))),
    ],
  },
  {
    id: "quit_dream", a: [25, 50], w: 6, tag: "일", t: "회사를 그만두고 하고 싶은 걸 하고 싶다고 한다.", if: salaried,
    opts: [
      pick("응원한다", R("사표를 냈다. 속이 시원했다.", fx({ happy: 6 }, 0, { add: ["dream"], fn: (c) => c.quit("꿈을 좇는 중") }))),
      pick("현실을 생각하라고 한다", R("한숨을 쉬고 다시 출근했다.", fx({ happy: -4 }))),
    ],
  },
  {
    id: "vtuber_offer", a: [19, 40], tag: "꿈", t: "버추얼 소속사에서 데뷔 제안이 들어왔다.", if: (c) => c.has("broadcast") && c.s.job !== "vtuber",
    opts: [
      dice("데뷔한다", "talent", {
        great: R("버추얼 아바타로 데뷔했다. 데뷔 방송부터 동접 천 명!", fx({ happy: 6 }, 0, { add: ["debut"], fn: (c) => { c.hire("vtuber"); c.s.fame = Math.max(c.s.fame, 25); } }), true),
        good: R("버추얼 아바타로 데뷔했다.", fx({ happy: 4 }, 0, { add: ["debut"], fn: (c) => { c.hire("vtuber"); c.s.fame = Math.max(c.s.fame, 10); } }), true),
        bad: R("데뷔는 했지만 시청자가 다섯 명이었다.", fx({ happy: 1 }, 0, { add: ["debut"], fn: (c) => { c.hire("vtuber"); c.s.fame = Math.max(c.s.fame, 2); } })),
      }),
      pick("거절한다", R("방송은 추억으로 남기기로 했다.", fx({ happy: -2 }))),
    ],
  },
  {
    id: "collab", a: [18, 70], rep: 3, tag: "방송", t: "큰 방송인에게서 합방 제안이 왔다.", if: creatorJob,
    opts: [
      dice("한다", "charm", {
        great: R("합방이 레전드로 남았다. 클립이 사방에 퍼졌다.", fx({ happy: 5 }, 0, { fn: (c) => (c.s.fame = Math.min(100, c.s.fame + 15)) }), true),
        good: R("재밌게 끝났다. 시청자가 늘었다.", fx({ happy: 3 }, 0, { fn: (c) => (c.s.fame = Math.min(100, c.s.fame + 6)) })),
        bad: R("긴장해서 한마디도 못 했다.", fx({ happy: -3 }, 0, { fn: (c) => (c.s.fame = Math.max(0, c.s.fame - 2)) })),
      }),
      pick("내 페이스대로 간다", R("늘 하던 대로 방송했다.", fx({ happy: 1 }))),
    ],
  },
  {
    id: "controversy", a: [18, 70], rep: 6, tag: "방송", t: "방송에서 한 말이 논란이 됐다.", if: (c) => creatorJob(c) && c.s.fame >= 25,
    opts: [
      dice("사과 방송을 한다", "charm", {
        good: R("진심이 전해졌다. 오히려 팬이 늘었다.", fx({ charm: 2 }, 0, { fn: (c) => (c.s.fame = Math.min(100, c.s.fame + 3)) })),
        bad: R("사과문이 또 논란이 됐다.", fx({ happy: -6 }, 0, { add: ["vt_down"], fn: (c) => (c.s.fame = Math.max(0, c.s.fame - 12)) })),
      }),
      pick("잠시 쉰다", R("한 달 동안 방송을 쉬었다.", fx({ happy: -2, health: 2 }, 0, { fn: (c) => (c.s.fame = Math.max(0, c.s.fame - 6)) }))),
    ],
  },
  {
    id: "fan_letter", a: [20, 80], rep: 6, tag: "방송", t: "시청자에게 긴 편지를 받았다.", if: (c) => creatorJob(c) && c.s.fame >= 10,
    opts: [
      pick("방송에서 읽어준다", R("편지를 읽다가 목이 메었다.", fx({ charm: 3, happy: 4 }, 0, { add: ["yangs"] }))),
      pick("혼자 몰래 읽는다", R("편지를 지갑에 넣고 다녔다.", fx({ happy: 5 }))),
    ],
  },
];
