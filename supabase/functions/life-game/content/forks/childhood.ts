// 유진 키우기 갈림길 — 어린 시절.
import type { Fork } from "../../engine.ts";
import { meetPartner } from "../forkUtil.ts";
import { R, dice, fx, pick, single, statModOf } from "../util.ts";

export const childhoodForks: Fork[] = [
  {
    id: "kinder_dream", a: [5, 7], tag: "꿈", t: "유치원에서 장래희망을 물어봤다.",
    opts: [
      pick("가수라고 한다", R("유진은 가수가 되고 싶다고 했다.", fx({ talent: 3 }))),
      pick("의사라고 한다", R("유진은 의사가 되고 싶다고 했다.", fx({ intel: 3 }))),
      pick("늑대라고 한다", R("선생님이 한참 웃었다.", fx({ happy: 3, charm: 1 })), { hint: "???" }),
    ],
  },
  {
    id: "bike", a: [5, 9], t: "보조 바퀴 없이 자전거를 타보겠다고 한다.",
    opts: [
      dice("손 놓고 밀어준다", "health", {
        good: R("한 번에 쌩 하고 달려나갔다!", fx({ health: 3, happy: 4 })),
        bad: R("화단에 처박혔다. 무릎이 까졌다.", fx({ health: -2, happy: -1 })),
      }),
      pick("아직 위험하다고 말린다", R("보조 바퀴를 1년 더 달았다.", fx({ happy: -2 }))),
    ],
  },
  {
    id: "lost_mart", a: [4, 8], t: "마트에서 유진이 사라졌다!",
    opts: [
      dice("방송으로 찾는다", null, {
        good: R("과자 코너에서 시식하고 있었다.", fx({ happy: 2 })),
        bad: R("한 시간 만에 주차장에서 찾았다. 둘 다 울었다.", fx({ happy: -3 }, 0, { fn: (c) => c.bond(c.person("mom"), 5) })),
      }),
    ],
  },
  {
    id: "pet_beg", a: [6, 12], t: "강아지를 키우고 싶다고 조른다.", if: (c) => !c.person("pet"),
    opts: [
      pick("키우게 해준다", R("{pet}가 식구가 됐다.", fx({ happy: 6 }, 0, { fn: (c) => { c.meet("pet", 80); } }))),
      pick("안 된다고 한다", R("유진은 밤새 삐졌다.", fx({ happy: -3 }))),
    ],
  },
  {
    id: "academy", a: [9, 12], t: "친구들이 다 학원에 다닌다고 한다.",
    opts: [
      pick("학원에 보낸다", R("학원 가방이 무거워졌다.", fx({ intel: 4, happy: -2 }))),
      pick("실컷 놀게 둔다", R("해 질 때까지 놀이터에 있었다.", fx({ happy: 4, charm: 1 }))),
    ],
  },
  {
    id: "phone_kid", a: [10, 13], t: "스마트폰을 사달라고 한다.",
    opts: [
      pick("사준다", R("게임 앱이 열 개가 됐다.", fx({ happy: 3, intel: -1 }, 0, { add: ["game"] }))),
      pick("아직 이르다", R("대신 책을 한 권 더 읽었다.", fx({ intel: 2, happy: -2 }))),
    ],
  },
  {
    id: "class_rep", a: [9, 17], rep: 4, tag: "학교", t: "반장 선거에 나가보겠다고 한다.",
    opts: [
      dice("공약을 같이 짜준다", "charm", {
        great: R("몰표로 반장이 됐다!", fx({ charm: 4, happy: 5 }, 0, { add: ["leader"] }), true),
        good: R("반장이 됐다.", fx({ charm: 3, happy: 3 }, 0, { add: ["leader"] })),
        bad: R("두 표 차이로 떨어졌다.", fx({ happy: -3 })),
        terrible: R("자기 이름도 안 썼는데 0표가 나왔다.", fx({ happy: -5, charm: -1 })),
      }),
      pick("굳이 나가지 말라고 한다", R("조용히 박수만 쳤다.", fx({}))),
    ],
  },
  {
    id: "talent_show", a: [8, 18], rep: 5, tag: "학교", t: "학교 장기자랑에 나가게 됐다.",
    opts: [
      dice("노래를 부른다", "talent", {
        great: R("전교생이 떼창을 했다. 학교 스타가 됐다!", fx({ talent: 3, charm: 5, happy: 5 }, 0, { add: ["school_star"] }), true),
        good: R("박수를 많이 받았다.", fx({ talent: 2, charm: 2, happy: 3 })),
        bad: R("가사를 까먹었다. 3초 정적이 흘렀다.", fx({ happy: -4 })),
      }),
      dice("개그를 한다", "charm", {
        good: R("강당이 뒤집어졌다.", fx({ charm: 4, happy: 3 })),
        bad: R("아무도 웃지 않았다. 선생님만 웃었다.", fx({ happy: -3 })),
      }),
      pick("구경만 한다", R("친구 무대를 열심히 응원했다.", fx({ happy: 1 }))),
    ],
  },
  {
    id: "make_friend", a: [8, 15], tag: "사람", t: "전학 온 아이가 혼자 밥을 먹고 있다.", if: (c) => c.folks("friend").length < 2,
    opts: [
      dice("먼저 말을 건다", "charm", {
        good: R("{f}와 금방 친해졌다. 평생 친구가 될 것 같다.", fx({ happy: 4, charm: 2 }, 0, { fn: (c) => { c.meet("friend", 70); } })),
        bad: R("어색하게 인사만 하고 끝났다.", fx({ charm: 1 })),
      }, { bonus: (c) => (c.has("kind") ? 1 : 0) }),
      pick("지켜본다", R("다음에 말 걸어보기로 했다.", fx({}))),
    ],
  },
  {
    id: "bully", a: [10, 17], tag: "학교", t: "반 친구가 괴롭힘당하는 걸 봤다.",
    opts: [
      dice("직접 막아선다", "health", {
        good: R("괴롭히던 애들이 슬금슬금 물러났다. 반 분위기가 바뀌었다.", fx({ charm: 5, happy: 3 }, 0, { add: ["brave"] }), true),
        bad: R("같이 맞았다. 그래도 후회는 없다.", fx({ health: -4, charm: 3 }, 0, { add: ["brave"] })),
      }),
      pick("선생님께 알린다", R("선생님이 해결해 주셨다.", fx({ intel: 1, charm: 1 }))),
      pick("모른 척한다", R("며칠 동안 마음이 무거웠다.", fx({ happy: -3 }))),
    ],
  },
  {
    id: "cheat", a: [12, 18], tag: "학교", t: "시험 전날, 친구가 답지를 구했다며 보여주겠다고 한다.",
    opts: [
      dice("본다", null, {
        good: R("시험을 잘 봤다. 그런데 마음 한구석이 찜찜하다.", fx({ intel: -1, happy: 1 })),
        bad: R("걸렸다. 부모님이 학교에 불려 오셨다.", fx({ happy: -6, charm: -2 }, 0, { fn: (c) => c.bond(c.person("mom"), -8) })),
      }),
      pick("안 본다", R("정직하게 시험을 봤다.", fx({ intel: 1, charm: 1 }))),
    ],
  },
  {
    id: "audition_fest", a: [15, 18], mile: true, tag: "꿈", t: "학교 축제 무대가 끝나자 연예기획사 사람이 찾아왔다. 오디션을 보러 오라고 한다.",
    if: (c) => c.st("charm") >= 62 && c.st("talent") >= 55 && !c.has("trainee") && c.s.seen["audition"] === undefined,
    opts: [
      dice("오디션을 본다", "charm", {
        great: R("그 자리에서 연습생 계약을 했다!", fx({ charm: 3, talent: 3, happy: 5 }, 0, { add: ["trainee"] }), true),
        good: R("연습생이 됐다. 새벽까지 춤 연습이다.", fx({ talent: 3, health: -1 }, 0, { add: ["trainee"] })),
        bad: R("떨어졌다. 그래도 좋은 경험이었다.", fx({ happy: -2, charm: 1 })),
      }, { bonus: (c) => statModOf(c, "talent") }),
      pick("공부가 먼저다", R("명함은 서랍 속에 들어갔다.", fx({}))),
    ],
  },
  {
    id: "audition", a: [13, 19], rep: 3, w: 14, tag: "꿈", t: "길에서 연예기획사 명함을 받았다. 오디션을 보러 오라고 한다.",
    opts: [
      dice("오디션을 본다", "charm", {
        great: R("그 자리에서 연습생 계약을 했다!", fx({ charm: 3, talent: 3, happy: 5 }, 0, { add: ["trainee"] }), true),
        good: R("연습생이 됐다. 새벽까지 춤 연습이다.", fx({ talent: 3, health: -1 }, 0, { add: ["trainee"] })),
        bad: R("떨어졌다. 그래도 좋은 경험이었다.", fx({ happy: -2, charm: 1 })),
      }, { bonus: (c) => statModOf(c, "talent") }),
      pick("수상하다며 거절한다", R("명함은 서랍 속에 들어갔다.", fx({}))),
    ],
  },
  {
    id: "broadcast_start", a: [14, 24], tag: "꿈", t: "유진이 방송을 해보고 싶다며 조심스럽게 말을 꺼낸다.", if: (c) => !c.has("broadcast") && c.st("talent") >= 35,
    opts: [
      pick("장비를 사준다", R("새 마이크로 첫 방송을 켰다. 시청자는 세 명이었다.", fx({ talent: 3, happy: 5 }, 0, { add: ["mic", "broadcast"] })), { cost: 150 }),
      pick("공부부터 하라고 한다", R("방송은 대학 가서 하기로 했다.", fx({ intel: 3, happy: -4 }))),
      pick("몰래 응원만 한다", R("핸드폰으로 몰래 첫 방송을 켰다.", fx({ happy: 3 }, 0, { add: ["broadcast", "secret_support"] })), { hint: "???" }),
    ],
  },
  {
    id: "game_contest", a: [12, 22], tag: "꿈", t: "게임 대회에 나가보겠다고 한다.", if: (c) => c.has("game"),
    opts: [
      dice("나가 본다", "intel", {
        great: R("우승했다! 상금도 받았다.", fx({ happy: 6 }, 100, { add: ["gamer_pro"] }), true),
        good: R("8강까지 갔다.", fx({ happy: 3 })),
        bad: R("1회전 탈락. 상대가 초등학생이었다.", fx({ happy: -3 })),
      }),
      pick("게임은 취미로만", R("게임은 주말에만 하기로 했다.", fx({ intel: 1 }))),
    ],
  },
  {
    id: "runaway", a: [14, 18], tag: "가족", t: "부모님과 크게 싸운 유진이 가출하겠다고 한다.",
    opts: [
      pick("먼저 사과한다", R("부모님이 먼저 안아주셨다.", fx({ happy: 3 }, 0, { fn: (c) => { c.bond(c.person("mom"), 8); c.bond(c.person("dad"), 8); } }))),
      dice("진짜 나간다", null, {
        good: R("{f}네 집에서 하룻밤 자고 들어왔다. 밥이 맛있었다.", fx({ happy: 2 }, 0, { fn: (c) => c.bond(c.person("friend"), 5) })),
        bad: R("밤새 PC방을 전전했다. 다음 날 크게 혼났다.", fx({ happy: -4, health: -2 }, 0, { fn: (c) => { c.bond(c.person("mom"), -6); c.bond(c.person("dad"), -6); } })),
      }),
    ],
  },
  {
    id: "abroad_study", a: [13, 17], tag: "학교", t: "해외로 조기 유학을 가볼까?", if: (c) => c.s.house === "comfy" || c.s.house === "rich",
    opts: [
      dice("간다", "charm", {
        good: R("해외 생활에 금방 적응했다. 영어가 술술 나온다.", fx({ intel: 5, charm: 3 }, 0, { add: ["abroad", "english"] })),
        bad: R("외로워서 많이 울었다. 그래도 버텼다.", fx({ intel: 4, happy: -5 }, 0, { add: ["abroad", "english"] })),
      }),
      pick("한국에서 지낸다", R("친구들과 함께 있는 게 좋았다.", fx({ happy: 2 }))),
    ],
  },
  {
    id: "teen_job", a: [16, 19], t: "편의점 알바 자리가 났다.", if: (c) => !c.s.job,
    opts: [
      pick("한다", R("주말 알바를 시작했다. 첫 월급 30만원!", fx({ charm: 1, intel: -1 }, 300))),
      pick("공부에 집중한다", R("알바는 나중에 하기로 했다.", fx({ intel: 1 }))),
    ],
  },
  {
    id: "first_love", a: [15, 19], tag: "연애", t: "같은 반 친구가 자꾸 눈에 밟힌다.", if: single,
    opts: [
      dice("고백한다", "charm", {
        great: R("{p}도 같은 마음이었다! 첫 연애가 시작됐다.", { s: { happy: 8 }, ...meetPartner(65) }, true),
        good: R("{p}와 사귀게 됐다.", { s: { happy: 5 }, ...meetPartner(55) }),
        bad: R("차였다. 이불을 차며 잠들었다.", fx({ happy: -5, charm: 1 })),
      }),
      pick("마음만 간직한다", R("졸업할 때까지 말하지 못했다.", fx({ happy: -1, talent: 1 }))),
    ],
  },
  {
    id: "smoke", a: [17, 30], t: "친구가 담배를 권한다.",
    opts: [
      pick("거절한다", R("단호하게 거절했다.", fx({ health: 1 }))),
      pick("한 대 피워본다", R("콜록거렸다. 그런데 자꾸 생각난다.", fx({ health: -2 }, 0, { add: ["smoker"] })), { hint: "건강 ↓ ↓" }),
    ],
  },
];
