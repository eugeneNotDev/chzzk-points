// 유진 키우기 갈림길 — 연애·결혼·가족.
import type { Fork } from "../../engine.ts";
import { meetPartner } from "../forkUtil.ts";
import { R, anyParent, dice, fx, kidsAt, pick, single } from "../util.ts";

export const familyForks: Fork[] = [
  {
    id: "blind_date", a: [20, 48], rep: 3, w: 14, tag: "연애", t: "친구가 소개팅을 잡아줬다.", if: single,
    opts: [
      dice("나간다", "charm", {
        great: R("첫눈에 반했다. {p}와 사귀게 됐다!", { s: { happy: 7 }, ...meetPartner(65) }, true),
        good: R("대화가 잘 통했다. {p}와 만나기 시작했다.", { s: { happy: 4 }, ...meetPartner(50) }),
        bad: R("밥만 먹고 헤어졌다. 연락은 오지 않았다.", fx({ happy: -2 })),
        terrible: R("소개팅 상대가 전 여친의 친구였다.", fx({ happy: -4 })),
      }, { cost: 10, bonus: (c) => (c.s.focus === "people" ? 1 : 0) }),
      pick("나중에 한다", R("이번엔 사양했다.", fx({}))),
    ],
  },
  {
    id: "coworker_love", a: [23, 50], tag: "연애", t: "같이 일하는 동료가 자꾸 커피를 사다 준다.", if: (c) => single(c) && !!c.s.job,
    opts: [
      dice("저녁을 먹자고 한다", "charm", {
        good: R("사내 연애가 시작됐다. {p}와 비밀 연애 중.", { s: { happy: 5 }, ...meetPartner(55) }),
        bad: R("그냥 원래 친절한 사람이었다.", fx({ happy: -2 })),
      }),
      pick("선을 긋는다", R("일과 사랑은 섞지 않기로 했다.", fx({}))),
    ],
  },
  {
    id: "confess_recv", a: [16, 45], rep: 6, tag: "연애", t: "누군가 유진에게 고백했다!", if: (c) => single(c) && c.st("charm") >= 45,
    opts: [
      pick("받아준다", R("{p}와 사귀게 됐다.", { s: { happy: 5 }, ...meetPartner(55) })),
      pick("정중히 거절한다", R("고맙지만 마음이 없었다.", fx({ charm: 1 }))),
    ],
  },
  {
    id: "love_fight", a: [16, 80], rep: 4, tag: "연애", t: "{p}와 크게 다퉜다.", if: (c) => !!c.partner(),
    opts: [
      pick("먼저 사과한다", R("먼저 손을 내밀었다. {p}가 웃었다.", fx({ happy: 1 }, 0, { fn: (c) => c.bond(c.partner(), 8) }))),
      dice("끝까지 이야기한다", "charm", {
        good: R("밤새 이야기하고 더 단단해졌다.", fx({ happy: 3 }, 0, { fn: (c) => c.bond(c.partner(), 12) })),
        bad: R("말이 엇나가서 더 크게 싸웠다.", fx({ happy: -4 }, 0, { fn: (c) => c.bond(c.partner(), -15) })),
      }),
      pick("헤어지자고 한다", R("{p}와 헤어졌다.", fx({ happy: -6 }, 0, { fn: (c) => { const p = c.person("partner"); if (p) c.drop(p); } })), { if: (c) => !!c.person("partner") }),
    ],
  },
  {
    id: "propose", a: [23, 60], rep: 2, w: 45, tag: "연애", t: "{p}와 만난 지 꽤 됐다. 청혼할까?",
    if: (c) => { const p = c.person("partner"); return !!p && c.age - p.since >= 1 && p.bond >= 40; },
    opts: [
      dice("반지를 준비해서 청혼한다", "charm", {
        great: R("{p}가 울면서 고개를 끄덕였다!", fx({ happy: 8 }, 0, { add: ["engaged"] }), true),
        good: R("{p}가 좋다고 했다!", fx({ happy: 6 }, 0, { add: ["engaged"] })),
        bad: R("{p}가 아직은 아니라고 했다.", fx({ happy: -5 }, 0, { fn: (c) => c.bond(c.partner(), -12) })),
      }, { cost: 300, bonus: (c) => Math.round(((c.person("partner")?.bond ?? 50) - 50) / 10) }),
      pick("아직 이르다", R("조금 더 연애하기로 했다.", fx({}, 0, { fn: (c) => c.bond(c.partner(), -3) }))),
      pick("헤어진다", R("{p}와 헤어졌다.", fx({ happy: -6 }, 0, { fn: (c) => c.drop(c.person("partner")) }))),
    ],
  },
  {
    id: "kids", a: [25, 46], rep: 2, w: 90, tag: "가족", t: "{p}가 아이 이야기를 꺼냈다.",
    if: (c) => { const s = c.person("spouse"); return !!s && c.age - s.since >= 1 && !c.has("nokids") && c.folks("child").length < 3; },
    opts: [
      dice("아이를 갖자", "health", {
        great: R("쌍둥이가 태어났다!", fx({ happy: 10 }, 0, { fn: (c) => { c.meet("child", 90); c.meet("child", 90); } }), true),
        good: R("{c}가 태어났다. 작은 손이 손가락을 꽉 잡았다.", fx({ happy: 8 }, 0, { fn: (c) => { c.meet("child", 90); } }), true),
        bad: R("아직 소식이 없다.", fx({ happy: -2 })),
      }, { bonus: () => 2 }),
      pick("둘이서 살자", R("둘이서 오순도순 살기로 했다.", fx({ happy: 1 }, 0, { add: ["nokids"] }))),
      pick("나중에", R("조금 더 생각해 보기로 했다.", fx({}))),
    ],
  },
  {
    id: "divorce", a: [28, 85], rep: 4, tag: "가족", t: "{p}와 사이가 많이 멀어졌다.", if: (c) => { const s = c.person("spouse"); return !!s && s.bond < 30; },
    opts: [
      dice("부부 상담을 받는다", "charm", {
        good: R("다시 서로를 보게 됐다.", fx({ happy: 4 }, 0, { fn: (c) => c.bond(c.person("spouse"), 30) })),
        bad: R("상담실에서도 싸웠다.", fx({ happy: -3 }, 0, { fn: (c) => c.bond(c.person("spouse"), -5) })),
      }, { cost: 200 }),
      pick("이혼한다", R("{p}와 이혼했다. 집이 조용해졌다.", fx({ happy: -8 }, 0, { add: ["divorced"], fn: (c) => { const sp = c.person("spouse"); c.drop(sp); c.s.cash -= Math.round(Math.max(0, c.s.cash + c.s.invest) * 0.3); } })), { hint: "재산 일부를 나눔" }),
      pick("참고 산다", R("아무 말 없이 저녁을 먹었다.", fx({ happy: -3 }))),
    ],
  },
  {
    id: "anniv", a: [18, 90], rep: 5, tag: "연애", t: "{p}와의 기념일이다.", if: (c) => !!c.partner(),
    opts: [
      pick("비싼 선물을 한다", R("{p}가 깜짝 놀랐다.", fx({ happy: 3 }, 0, { fn: (c) => c.bond(c.partner(), 12) })), { cost: 200 }),
      dice("손편지를 쓴다", "talent", {
        good: R("{p}가 편지를 읽다가 울었다.", fx({ happy: 4 }, 0, { fn: (c) => c.bond(c.partner(), 15) })),
        bad: R("맞춤법을 지적받았다.", fx({ happy: -1 }, 0, { fn: (c) => c.bond(c.partner(), 3) })),
      }),
      pick("깜빡한다", R("{p}가 하루 종일 말을 안 했다.", fx({ happy: -2 }, 0, { fn: (c) => c.bond(c.partner(), -12) }))),
    ],
  },
  {
    id: "marry_nag", a: [28, 42], tag: "가족", t: "명절마다 결혼은 언제 하냐는 잔소리를 듣는다.", if: (c) => single(c) && anyParent(c),
    opts: [
      dice("소개를 받아본다", "charm", {
        good: R("엄마 친구 딸 {p}를 만났다. 의외로 잘 맞았다.", { s: { happy: 4 }, ...meetPartner(50) }),
        bad: R("어색한 식사만 하고 끝났다.", fx({ happy: -2 })),
      }),
      pick("흘려듣는다", R("귀에 이어폰을 꽂았다.", fx({ happy: 1 }, 0, { fn: (c) => c.bond(c.person("mom"), -4) }))),
    ],
  },
  {
    id: "old_love", a: [62, 90], tag: "연애", t: "노인정에서 마음 맞는 사람을 만났다.", if: single,
    opts: [
      pick("용기 내서 산책을 청한다", R("매일 아침 {p}와 산책하게 됐다.", { s: { happy: 7 }, ...meetPartner(60) })),
      pick("이 나이에 무슨…", R("마음만 두근거렸다.", fx({ happy: 1 }))),
    ],
  },
  {
    id: "kid_teen", a: [35, 70], tag: "가족", t: "사춘기 {c}가 방문을 쾅 닫았다.", if: (c) => kidsAt(c, 13, 17).length > 0,
    opts: [
      dice("조용히 대화를 청한다", "charm", {
        good: R("{c}가 처음으로 속마음을 털어놨다.", fx({ happy: 4 }, 0, { fn: (c) => c.bond(kidsAt(c, 13, 17)[0], 10) })),
        bad: R("'아빠가 뭘 알아!' 소리만 들었다.", fx({ happy: -3 })),
      }),
      pick("크게 혼낸다", R("집 안 공기가 얼어붙었다.", fx({ happy: -2 }, 0, { fn: (c) => c.bond(kidsAt(c, 13, 17)[0], -8) }))),
    ],
  },
  {
    id: "kid_dream", a: [40, 75], tag: "가족", t: "{c}가 방송을 하고 싶다고 한다. 어디서 많이 본 장면이다.", if: (c) => kidsAt(c, 14, 20).length > 0,
    opts: [
      pick("장비를 사준다", R("{c}의 첫 방송에 몰래 들어가 채팅을 쳤다.", fx({ happy: 5 }, 0, { fn: (c) => c.bond(kidsAt(c, 14, 20)[0], 12) })), { cost: 300 }),
      pick("공부부터 하라고 한다", R("{c}가 예전의 나처럼 한숨을 쉬었다.", fx({ happy: -2 }))),
    ],
  },
  {
    id: "kid_wedding", a: [50, 85], tag: "가족", t: "{c1}가 결혼한다고 한다.", if: (c) => c.folks("child").some((k) => c.age - k.born >= 27),
    opts: [
      pick("결혼 자금을 보태준다", R("{c1}에게 결혼 자금을 건넸다.", fx({ happy: 6 }, 0, { fn: (c) => c.bond(c.folks("child")[0], 15) })), { cost: 5000 }),
      pick("마음만 보탠다", R("눈물 나는 축사를 했다.", fx({ happy: 5, charm: 1 }))),
    ],
  },
  {
    id: "grandkid_care", a: [56, 80], tag: "가족", t: "자식이 손주를 봐달라고 한다.", if: (c) => c.has("grandkid"),
    opts: [
      pick("봐준다", R("손주 덕에 하루가 짧아졌다.", fx({ happy: 5, health: -2 }))),
      pick("내 인생도 있다고 한다", R("대신 용돈을 두둑이 보냈다.", fx({ health: 2 }, -300))),
    ],
  },
];
