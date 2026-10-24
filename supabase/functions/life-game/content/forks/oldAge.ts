// 유진 키우기 갈림길 — 노년 갈림길.
import type { Fork } from "../../engine.ts";
import { wasJob } from "../forkUtil.ts";
import { R, bizJob, creatorJob, dice, fx, homePrice, pick, retireFn, statModOf } from "../util.ts";
import { JOBS } from "../world.ts";

export const oldAgeForks: Fork[] = [
  {
    id: "old_trip", a: [65, 88], rep: 6, tag: "노년", t: "기운이 남아 있을 때 여행을 가볼까?",
    opts: [
      pick("가족이랑 다 같이 간다", R("온 가족이 함께 바닷가 여행을 갔다. 손주가 모래성을 쌓았다.", fx({ happy: 7 }, 0, { fn: (c) => { for (const k of c.folks("child")) c.bond(k, 4); c.bond(c.person("spouse"), 4); } }), true), { cost: 500, if: (c) => !!c.person("spouse") || c.folks("child").length > 0 }),
      dice("혼자 배낭을 멘다", "health", {
        good: R("혼자 기차를 타고 전국을 돌았다. 젊어진 기분이었다.", fx({ happy: 7, health: 1 })),
        bad: R("여행 사흘째에 몸살이 나서 돌아왔다.", fx({ health: -3, happy: 1 })),
      }, { cost: 300 }),
      pick("집이 최고다", R("여행은 TV로 보기로 했다.", fx({ happy: 1 }))),
    ],
  },
  {
    id: "old_learn", a: [65, 85], tag: "노년", t: "새로운 걸 하나 배워볼까?",
    opts: [
      pick("그림을 배운다", R("복지관 그림 교실에 다녔다. 첫 작품은 냉장고에 붙었다.", fx({ talent: 3, happy: 3 })), { cost: 100 }),
      pick("컴퓨터를 배운다", R("컴퓨터 교실에 다녔다. 이제 영상 통화도 혼자 건다.", fx({ intel: 3, happy: 2 })), { cost: 100 }),
      pick("춤을 배운다", R("복지관 댄스 교실에 다녔다. 무릎이 좀 아프지만 신난다.", fx({ health: 2, charm: 2, happy: 2 })), { cost: 100 }),
      pick("배우긴 뭘 배워", R("늘 하던 대로 지냈다.", fx({}))),
    ],
  },
  {
    id: "grandkid_dream", a: [65, 95], kind: "think", tag: "생각 남기기", t: "손주가 묻는다. 할아버지는 어릴 때 꿈이 뭐였어?",
    if: (c) => c.has("grandkid"),
    opts: [
      pick("늑대였지", R("손주가 깔깔 웃었다. 진짜인데.", fx({ happy: 3 }))),
      pick("지금 너 같은 아이였지", R("손주가 무슨 뜻이냐며 고개를 갸웃했다.", fx({ happy: 3 }))),
      pick((c) => (c.s.jobs.length ? wasJob(c.s.jobs[c.s.jobs.length - 1].name) : "그냥 행복하게 사는 거였지"), R("손주가 고개를 끄덕였다.", fx({ happy: 2 }))),
    ],
  },
  {
    id: "bucket_list", a: [75, 95], tag: "노년", t: "버킷리스트 마지막 줄이 아직 비어 있다.",
    opts: [
      dice("스카이다이빙을 한다", "health", {
        great: R("하늘에서 소리를 질렀다. 인생 최고의 1분이었다.", fx({ happy: 10 }), true),
        good: R("무사히 착지했다. 다리가 후들거렸지만 웃음이 멈추지 않았다.", fx({ happy: 7 })),
        bad: R("착지하다 발목을 삐었다. 그래도 후회는 없다.", fx({ health: -5, happy: 3 })),
      }, { cost: 100 }),
      pick("가족사진을 찍는다", R("온 가족이 사진관에 모였다. 액자가 거실 한가운데 걸렸다.", fx({ happy: 6 })), { if: (c) => !!c.person("spouse") || c.folks("child").length > 0 }),
      pick("옛 친구에게 편지를 쓴다", R("수십 년 만에 쓴 편지에 답장이 왔다.", fx({ happy: 5 }))),
      pick("그냥 비워 둔다", R("빈칸도 나쁘지 않다.", fx({ happy: 1 }))),
    ],
  },
  {
    id: "startup", a: [28, 58], tag: "일", t: "가게를 차려볼까?", if: (c) => !bizJob(c) && (c.has("cook") || c.has("dream") || !c.s.job || c.age >= 45),
    opts: [
      pick("국밥집", R("작은 국밥집을 열었다.", fx({ happy: 3 }, 0, { fn: (c) => { c.hire("gukbap"); c.s.biz = 30 + statModOf(c, "intel") * 3 + (c.has("cook") ? 10 : 0); } })), { cost: 7000, if: (c) => c.has("cook") }),
      pick("카페", R("예쁜 카페를 열었다.", fx({ happy: 4 }, 0, { fn: (c) => { c.hire("cafe"); c.s.biz = 25 + statModOf(c, "charm") * 3; } })), { cost: 9000 }),
      pick("치킨집", R("치킨집을 열었다. 결국 치킨이다.", fx({ happy: 2 }, 0, { fn: (c) => { c.hire("chicken"); c.s.biz = 30 + statModOf(c, "intel") * 2; } })), { cost: 6000 }),
      pick("하던 대로 산다", R("가게는 꿈으로 남겨두었다.", fx({}))),
    ],
  },
  {
    id: "biz_expand", a: [30, 70], tag: "일", t: "가게가 잘된다. 2호점을 낼까?", if: (c) => bizJob(c) && c.s.biz >= 55,
    opts: [
      dice("낸다", "intel", {
        great: R("2호점도 대박이 났다!", fx({ happy: 5 }, 0, { fn: (c) => (c.s.biz = Math.min(100, c.s.biz + 25)) }), true),
        good: R("2호점도 자리를 잡았다.", fx({ happy: 3 }, 0, { fn: (c) => (c.s.biz = Math.min(100, c.s.biz + 12)) })),
        bad: R("2호점이 발목을 잡았다.", fx({ happy: -4 }, 0, { fn: (c) => (c.s.biz = Math.max(0, c.s.biz - 15)) })),
      }, { cost: 8000 }),
      pick("지금이 좋다", R("한 가게에 집중하기로 했다.", fx({ happy: 1 }))),
    ],
  },
  {
    id: "biz_close", a: [28, 80], rep: 3, tag: "일", t: "장사가 너무 안 된다. 가게를 접을까?", if: (c) => bizJob(c) && c.s.biz < 18,
    opts: [
      pick("접는다", R("가게 셔터를 내렸다. 마지막 손님에게 서비스를 줬다.", fx({ happy: -5 }, 1000, { fn: (c) => c.quit("백수") }))),
      dice("한 번만 더 버틴다", "intel", {
        good: R("새 메뉴가 히트를 쳤다. 살아났다!", fx({ happy: 5 }, 0, { fn: (c) => (c.s.biz += 30) }), true),
        bad: R("적자가 더 쌓였다.", fx({ happy: -4 }, -1500)),
      }),
    ],
  },
  {
    id: "coin", a: [20, 60], tag: "돈", t: "주변에서 다들 코인으로 돈을 벌었다고 한다.", if: (c) => c.s.cash + c.s.invest >= 500,
    opts: [
      dice("1,000만원을 넣는다", null, {
        great: R("코인이 10배가 됐다!!", fx({ happy: 8 }, 10000), true),
        good: R("두 배로 불렸다.", fx({ happy: 4 }, 2000)),
        normal: R("본전에 겨우 뺐다.", fx({}, 1000)),
        bad: R("반토막이 났다.", fx({ happy: -4 }, 500)),
        terrible: R("상장폐지됐다. 전부 날렸다.", fx({ happy: -8 })),
      }, { cost: 1000 }),
      pick("관심 없다", R("남의 돈은 남의 돈.", fx({ intel: 1 }))),
    ],
  },
  {
    id: "stock_tip", a: [25, 70], tag: "돈", t: "지인이 '확실한' 주식 정보를 알려줬다.", if: (c) => c.s.cash + c.s.invest >= 1000,
    opts: [
      dice("믿고 산다", "intel", {
        great: R("진짜였다! 세 배가 됐다.", fx({ happy: 6 }, 6000), true),
        good: R("조금 벌었다.", fx({ happy: 2 }, 2600)),
        bad: R("물렸다. 손절했다.", fx({ happy: -4 }, 800)),
        terrible: R("작전주였다. 거의 다 잃었다.", fx({ happy: -7 }, 100)),
      }, { cost: 2000 }),
      pick("흘려듣는다", R("세상에 확실한 건 없다.", fx({ intel: 1 }))),
    ],
  },
  {
    id: "buy_home", a: [28, 60], rep: 6, w: 18, tag: "돈", t: (c) => `내 집 마련을 해볼까? 요즘 아파트는 ${Math.round(homePrice(c) / 10000)}억 정도 한다.`,
    if: (c) => !c.s.assets.some((a) => a.kind === "home") && c.s.cash + c.s.invest >= homePrice(c) * 0.2,
    opts: [
      pick("영끌해서 산다", R("내 집이 생겼다. 대출도 생겼다.", fx({ happy: 6 }, 0, { fn: (c) => { const p = homePrice(c); c.s.assets.push({ id: "home", name: "아파트", value: p, kind: "home", age: c.age }); c.s.debt += Math.round(p * 0.8); } })), { cost: (c) => Math.round(homePrice(c) * 0.2), hint: "계약금 20% · 나머지 대출" }),
      pick("작은 빌라를 산다", R("작은 빌라를 샀다. 그래도 내 집이다.", fx({ happy: 4 }, 0, { fn: (c) => { const p = Math.round(homePrice(c) * 0.45); c.s.assets.push({ id: "home", name: "빌라", value: p, kind: "home", age: c.age }); c.s.debt += Math.round(p * 0.6); } })), { cost: (c) => Math.round(homePrice(c) * 0.45 * 0.4) }),
      pick("조금 더 지켜본다", R("집값이 떨어지길 기다렸다.", fx({}))),
    ],
  },
  {
    id: "abroad_work", a: [24, 40], tag: "일", t: "해외에서 일해볼 기회가 생겼다.", if: (c) => !!c.s.job && !c.has("abroad_work"),
    opts: [
      dice("떠난다", "charm", {
        great: R("해외에서 승승장구했다. 연봉이 크게 올랐다.", fx({ happy: 5, intel: 3 }, 0, { add: ["abroad_work", "travel"], fn: (c) => (c.s.salary = Math.round(c.s.salary * 1.5)) }), true),
        good: R("해외 생활에 적응했다.", fx({ happy: 3, intel: 2 }, 0, { add: ["abroad_work", "travel"], fn: (c) => (c.s.salary = Math.round(c.s.salary * 1.2)) })),
        bad: R("향수병에 걸려 1년 만에 돌아왔다.", fx({ happy: -4 }, -500, { add: ["abroad_work"] })),
      }, { bonus: (c) => (c.has("english") ? 2 : 0) }),
      pick("한국이 좋다", R("익숙한 곳에 남기로 했다.", fx({ happy: 1 }))),
    ],
  },
  {
    id: "burnout", a: [24, 62], tag: "일", t: "아침마다 출근하기가 너무 싫다. 번아웃인 것 같다.", if: (c) => !!c.s.job && c.st("happy") < 45,
    opts: [
      pick("휴직하고 쉰다", R("반년을 푹 쉬었다. 다시 웃음이 났다.", fx({ happy: 8, health: 3 }, 0, { fn: (c) => c.money(-Math.round(c.s.salary * 0.4)) }))),
      pick("버틴다", R("꾸역꾸역 버텼다.", fx({ health: -3, happy: -2 }))),
      pick("상담을 받는다", R("상담 선생님 앞에서 처음으로 울었다.", fx({ happy: 5 })), { cost: 100 }),
    ],
  },
  {
    id: "mid_crisis", a: [40, 55], tag: "인생", t: "갑자기 인생이 허무하게 느껴진다.",
    opts: [
      pick("오토바이를 산다", R("바람을 가르며 달렸다. 가족들은 반대했다.", fx({ happy: 6, health: -1 })), { cost: 2000 }),
      dice("밴드를 결성한다", "talent", {
        good: R("동네 축제에서 공연했다. 살아있는 기분이었다.", fx({ happy: 7, talent: 3 }, 0, { add: ["music"] })),
        bad: R("합주실 월세만 내다 해체했다.", fx({ happy: -2 }, -200)),
      }),
      pick("마라톤을 시작한다", R("매일 새벽에 달리기 시작했다.", fx({ health: 5, happy: 3 }))),
    ],
  },
  {
    id: "health_warning", a: [32, 70], rep: 8, tag: "건강", t: "건강검진에서 '관리가 필요하다'는 말을 들었다.", if: (c) => c.st("health") < 55,
    opts: [
      dice("운동을 시작한다", "health", {
        good: R("몸이 몰라보게 좋아졌다.", fx({ health: 8, happy: 2 })),
        bad: R("첫날 무리하다 근육통으로 일주일을 누웠다.", fx({ health: 2, happy: -2 })),
      }),
      pick("술·담배를 끊는다", R("독하게 마음먹고 끊었다.", fx({ health: 6, happy: -2 }, 0, { del: ["smoker"] })), { if: (c) => c.has("smoker") }),
      pick("식단을 바꾼다", R("싱겁게 먹기 시작했다.", fx({ health: 4, happy: -1 }))),
      pick("하던 대로 산다", R("인생 뭐 있나 싶었다.", fx({ happy: 2, health: -3 }))),
    ],
  },
  {
    id: "insure_pitch", a: [26, 55], tag: "돈", t: "보험 설계사가 된 동창이 보험 가입을 권한다.", if: (c) => !c.has("insurance"),
    opts: [
      pick("가입한다", R("보험에 가입했다. 큰 병에 걸려도 치료비 걱정은 덜었다.", fx({}, 0, { add: ["insurance"] })), { hint: "해마다 150만원 · 치료비 70% 보장" }),
      pick("거절한다", R("건강에는 자신 있다.", fx({}))),
    ],
  },
  {
    id: "lottery_buy", a: [20, 90], rep: 6, w: 4, tag: "돈", t: "꿈에 돼지가 나왔다. 복권을 살까?",
    opts: [
      dice("산다", null, {
        great: R("3등에 당첨됐다! 150만원!", fx({ happy: 5 }, 150), true),
        good: R("5천원 당첨. 다시 복권으로 바꿨다.", fx({ happy: 1 })),
        bad: R("꽝이었다. 돼지는 돼지였다.", fx({})),
      }, { cost: 1 }),
      pick("돼지꿈은 돼지꿈일 뿐", R("돼지고기를 먹었다.", fx({ happy: 1 }))),
    ],
  },
  {
    id: "donate_big", a: [50, 95], tag: "돈", t: "모은 재산 일부를 기부할까?", if: (c) => c.net() >= 30000,
    opts: [
      pick("크게 기부한다", R("장학재단을 만들었다. 아이들의 편지가 쌓였다.", fx({ charm: 6, happy: 6 }, 0, { add: ["donor"] }), true), { cost: 10000 }),
      pick("조금만", R("동네 복지관에 기부했다.", fx({ charm: 2, happy: 2 })), { cost: 500 }),
      pick("자식들에게 물려준다", R("재산은 그대로 두었다.", fx({}))),
    ],
  },
  {
    id: "retire_free", a: [60, 88], rep: 5, tag: "인생", t: "이제 일을 내려놓을 때가 된 것 같다.", if: (c) => !!c.s.job && !JOBS.find((j) => j.id === c.s.job)?.retire,
    opts: [
      pick("은퇴한다", R((c) => (JOBS.find((j) => j.id === c.s.job)?.biz ? "마지막으로 가게 셔터를 내렸다. 단골들이 꽃을 들고 왔다." : "마지막 방송을 마쳤다. 고마운 사람이 많았다."), fx({ happy: 5 }, 0, { fn: retireFn }), true)),
      pick("아직 할 수 있다", R("조금만 더 해보기로 했다.", fx({ health: -1, happy: 1 }))),
    ],
  },
  {
    id: "retire_life", a: [60, 80], tag: "인생", t: "은퇴 후 뭘 하면서 지낼까?", if: (c) => c.has("retired"),
    opts: [
      pick("노래 교실에 다닌다", R("노래 교실에 등록했다. 선생님이 한숨을 쉬었다.", fx({ happy: 5, talent: 2 }))),
      pick("세계 일주를 떠난다", R("배낭 하나 메고 떠났다.", fx({ happy: 8 }, 0, { add: ["travel"] })), { cost: 2000 }),
      pick("시골로 내려간다", R("귀농해서 텃밭을 일궜다.", fx({ health: 3, happy: 3 }, 0, { fn: (c) => { c.hire("farmer"); } }))),
      pick("집에서 푹 쉰다", R("드디어 늦잠을 잤다.", fx({ health: 3, happy: 2 }))),
    ],
  },
  {
    id: "silver_stream", a: [63, 90], tag: "꿈", t: "손주가 할아버지도 방송 한번 해보라고 한다.", if: (c) => !creatorJob(c),
    opts: [
      dice("해본다", "talent", {
        great: R("'늑대 할아버지' 채널이 대박이 났다!", fx({ happy: 8 }, 0, { add: ["broadcast"], fn: (c) => { c.hire("vtuber"); c.s.fame = 35; } }), true),
        good: R("소소하게 구독자가 생겼다. 매일이 즐겁다.", fx({ happy: 5 }, 0, { add: ["broadcast"] })),
        bad: R("마이크를 거꾸로 들고 30분을 떠들었다.", fx({ happy: 2 })),
      }),
      pick("이 나이에 무슨…", R("손주가 실망한 눈치였다.", fx({}))),
    ],
  },
  {
    id: "surgery", a: [70, 98], rep: 6, tag: "건강", t: "의사가 큰 수술을 권한다.", if: (c) => c.st("health") < 45,
    opts: [
      dice("수술을 받는다", "health", {
        good: R("수술이 잘 됐다. 몇 년은 더 거뜬하다.", fx({ health: 12, happy: 3 })),
        bad: R("회복이 더뎠다.", fx({ health: -4 })),
        terrible: R("수술 후 한동안 깨어나지 못했다.", fx({ health: -12 })),
      }, { cost: 1500, bonus: () => 1 }),
      pick("받지 않는다", R("남은 시간을 편하게 보내기로 했다.", fx({ happy: 3 }))),
    ],
  },
  {
    id: "will", a: [75, 95], tag: "인생", t: "유언장을 쓸까 고민 중이다.",
    opts: [
      pick("쓴다", R("하고 싶은 말을 꾹꾹 눌러 적었다. 고마운 사람이 생각보다 많았다.", fx({ happy: 3 }))),
      pick("아직 멀었다", R("아직 할 게 많다며 웃었다.", fx({ happy: 3 }))),
    ],
  },
  {
    id: "wolf", a: [18, 60], w: 4, tag: "???", rep: 6, t: "꿈속 늑대가 '이제 기억났냐'고 묻는다.", if: (c) => c.has("wolf_dream2"),
    opts: [
      pick("기억났다고 대답한다", R("늑대가 웃었다. 무언가 깨어난 기분이다.", fx({ talent: 5 }, 0, { add: ["wolf_dream3"] }), true), { hint: "???" }),
      pick("그냥 꿈이라고 넘긴다", R("그 뒤로 늑대 꿈은 꾸지 않았다.", fx({ happy: 1 }, 0, { del: ["wolf_dream1", "wolf_dream2"] }))),
    ],
  },
];
