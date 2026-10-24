// 유진 키우기 갈림길 — 인생 마디(조건이 맞으면 반드시).
import type { Fork } from "../../engine.ts";
import { badDebt } from "../../types.ts";
import { focusOpts, jobOpts, think, tuitionFx, tuitionOf } from "../forkUtil.ts";
import { R, dice, fx, inCollege, pick, retireFn, wed } from "../util.ts";
import { JOBS } from "../world.ts";

export const milestonesForks: Fork[] = [
  {
    id: "temper", a: [2, 3], mile: true, tag: "인생 마디", t: "두 살 유진, 어떤 기질이 보이기 시작했다.",
    opts: [
      pick("호기심이 많다", R("뭐든 만지고 뜯어보는 아이가 됐다.", fx({ intel: 3 }, 0, { add: ["curious"] })), { hint: "지능 ↑" }),
      pick("활발하다", R("한시도 가만히 있지 않는 아이가 됐다.", fx({ health: 3 }, 0, { add: ["active"] })), { hint: "건강 ↑" }),
      pick("다정하다", R("누구에게나 잘 웃어주는 아이가 됐다.", fx({ charm: 3 }, 0, { add: ["kind"] })), { hint: "매력 ↑" }),
      pick("흥이 많다", R("음악만 나오면 엉덩이를 흔드는 아이가 됐다.", fx({ talent: 3 }, 0, { add: ["groovy"] })), { hint: "끼 ↑" }),
    ],
  },
  think("think5", 5, "다섯 살 유진에게 물었다. 커서 뭐가 되고 싶어?", ["늑대!", "엄마 아빠 같은 어른", "몰라, 그냥 맛있는 거 많이 먹는 사람"]),
  { id: "school_in", a: [8, 9], mile: true, kind: "focus", tag: "인생 마디", t: "초등학교에 입학했다. 어떤 학생으로 키울까?", opts: focusOpts(1) },
  {
    id: "club", a: [13, 14], mile: true, tag: "인생 마디", t: "중학교에 들어가서 동아리를 골라야 한다.",
    opts: [
      pick("방송부", R("점심시간 교내 방송을 맡았다. 목소리가 좋다는 말을 들었다.", fx({ talent: 3 }, 0, { add: ["mic"] })), { hint: "끼 ↑ · 방송 꿈" }),
      pick("축구부", R("매일 운동장을 뛰었다.", fx({ health: 3 }, 0, { add: ["sporty"] })), { hint: "건강 ↑" }),
      pick("독서부", R("책 냄새가 좋아졌다.", fx({ intel: 3 }, 0, { add: ["bookworm"] })), { hint: "지능 ↑" }),
      pick("만화부", R("만화 그리는 친구들과 친해졌다.", fx({ talent: 2, charm: 1 }, 0, { add: ["artsy"] })), { hint: "끼 ↑ · 그림" }),
    ],
  },
  think("think15", 15, "열다섯 살 유진이 일기장에 적었다. 요즘 제일 고민되는 건…", ["진로", "친구 관계", "솔직히 아무 생각 없음"]),
  {
    id: "high", a: [16, 16], mile: true, tag: "인생 마디", t: "고등학교 진학. 어디로 갈까?",
    opts: [
      pick("인문계 고등학교", R("평범하게 인문계 고등학교에 들어갔다.", fx({ intel: 2 }, 0, { fn: (c) => (c.s.school = "고등학생") }))),
      dice("예술고 입시", "talent", {
        good: R("예술고에 합격했다!", fx({ talent: 6, happy: 3 }, 0, { add: ["art_school"], fn: (c) => (c.s.school = "예고생") }), true),
        bad: R("예고 입시에 떨어졌다. 인문계로 갔다.", fx({ happy: -4 }, 0, { fn: (c) => (c.s.school = "고등학생") })),
      }, { hint: "끼 주사위 · 9 이상이면 좋음", if: (c) => c.st("talent") >= 45 }),
      pick("특성화고에 간다", R("특성화고에 들어갔다. 자격증부터 땄다.", fx({ intel: 1 }, 0, { add: ["vocational", "cert"], fn: (c) => { c.s.school = "특성화고생"; c.s.edu = "high"; c.s.until = 19; } })), { hint: "수능 없이 졸업하고 바로 취업" }),
      pick("자퇴하고 방송에 올인", R("학교를 그만두고 방송에 모든 걸 걸었다.", fx({ talent: 4, happy: 2 }, 0, { add: ["dropout", "broadcast", "no_uni"], fn: (c) => { c.s.school = "자퇴생"; c.s.edu = "none"; c.s.until = c.age; } })), {
        hint: "끼 ↑ · 위험한 길", if: (c) => c.has("mic") || c.has("broadcast"),
      }),
    ],
  },
  {
    id: "suneung", a: [18, 21], mile: true, tag: "인생 마디", t: (c) => (c.has("retry") ? "재수 끝에 두 번째 수능 날이 왔다." : "수능 날이 왔다."),
    if: (c) => !c.has("no_uni") && !c.has("vocational") && !c.s.score && !inCollege(c),
    opts: [
      dice("최선을 다한다", "intel", {
        great: R("수능 만점에 가까운 점수가 나왔다!", fx({ happy: 8 }, 0, { fn: (c) => (c.s.score = "top") }), true),
        good: R("기대 이상으로 잘 봤다.", fx({ happy: 4 }, 0, { fn: (c) => (c.s.score = "inseoul") })),
        normal: R("평소만큼 봤다.", fx({}, 0, { fn: (c) => (c.s.score = "local") })),
        bad: R("시험을 망쳤다. 집에 오는 길이 길었다.", fx({ happy: -5 }, 0, { fn: (c) => (c.s.score = "low") })),
      }, { bonus: (c) => (c.has("tutored") ? 1 : 0) + (c.has("retry") ? 1 : 0) + (c.s.focus === "study" ? 2 : 0), hint: "지능 주사위 · 공부 집중 +2 · 과외·재수 +1" }),
      pick("수능은 포기하고 다른 길", R("수능 대신 다른 길을 찾기로 했다.", fx({ happy: 1 }, 0, { add: ["no_uni"], fn: (c) => (c.s.edu = "high") }))),
    ],
  },
  {
    id: "uni", a: [18, 21], mile: true, now: true, tag: "인생 마디", t: "수능 성적표를 받았다. 어떻게 할까?",
    if: (c) => !!c.s.score && !inCollege(c) && c.s.edu !== "top" && c.s.edu !== "inseoul" && c.s.edu !== "local",
    opts: [
      pick("의대에 간다", R("의대에 입학했다. 6년짜리 여정이 시작됐다.", tuitionFx("top", 6, true), true), { if: (c) => c.s.score === "top", hint: "6년 · 등록금 큼" }),
      pick("명문대에 간다", R("명문대에 입학했다.", { ...tuitionFx("top"), s: { happy: 5, intel: 3 } }, true), { if: (c) => c.s.score === "top" }),
      pick("서울에 있는 대학", R("서울에 있는 대학에 입학했다.", { ...tuitionFx("inseoul"), s: { happy: 3, intel: 2 } }), { if: (c) => c.s.score === "top" || c.s.score === "inseoul" }),
      pick("지방 대학", R("지방 대학에 입학했다. 자취를 시작했다.", { ...tuitionFx("local"), s: { happy: 2, intel: 1 } }), { if: (c) => c.s.score !== "low" }),
      pick("재수한다", R("1년 더 공부하기로 했다.", fx({ happy: -3, intel: 2 }, 0, { add: ["retry"], fn: (c) => { c.s.score = null; c.s.school = "재수생"; delete c.s.seen["suneung"]; delete c.s.seen["uni"]; } })), { if: (c) => !c.has("retry") && c.age <= 19, hint: "내년에 수능 다시 · 주사위 +1" }),
      pick("대학은 안 간다", R("대학 대신 사회로 나가기로 했다.", fx({}, 0, { add: ["no_uni"], fn: (c) => { c.s.edu = "high"; c.s.school = "사회 초년생"; } }))),
    ],
  },
  {
    id: "army", a: [20, 28], mile: true, rep: 2, tag: "인생 마디", t: "입영 통지서가 날아왔다.",
    if: (c) => !c.has("army_done") && c.s.army === 0 && c.st("health") >= 25,
    opts: [
      pick("지금 간다", R("머리를 짧게 자르고 입대했다.", fx({ health: 2 }, 0, { fn: (c) => { c.s.army = 2; c.s.school = "군인"; if (inCollege(c)) c.s.until += 2; } }))),
      dice("공군에 지원한다", "intel", {
        good: R("공군에 합격했다. 입대했다.", fx({ intel: 1 }, 0, { fn: (c) => { c.s.army = 2; c.s.school = "공군"; if (inCollege(c)) c.s.until += 2; } })),
        bad: R("공군에 떨어져서 육군으로 입대했다.", fx({ happy: -2 }, 0, { fn: (c) => { c.s.army = 2; c.s.school = "군인"; if (inCollege(c)) c.s.until += 2; } })),
      }),
      pick("조금 미룬다", R("입대를 미뤘다.", fx({ happy: 1 })), { if: (c) => c.age <= 26 }),
    ],
  },
  {
    id: "grad", a: [22, 45], mile: true, rep: 1, tag: "인생 마디", t: (c) => (c.has("med") ? "의대를 졸업하고 국가고시까지 붙었다." : c.has("lawschool") ? "로스쿨을 마치고 변호사 시험에 붙었다." : "대학을 졸업했다. 학사모를 던졌다."),
    if: (c) => inCollege(c) && c.age >= c.s.until && c.s.army === 0,
    opts: [
      pick("바로 취업 준비", R("졸업장을 들고 사회로 나섰다.", fx({ happy: 3 }, 0, { del: ["in_college"], fn: (c) => (c.s.school = "취준생") }))),
      dice("대학원에 간다", "intel", {
        good: R("대학원에 들어갔다. 2년만 더…", fx({ intel: 4 }, 0, { del: ["in_college"], fn: (c) => { c.s.edu = "grad"; c.s.until = c.age + 2; c.s.school = "대학원생"; c.s.debt += Math.round(1500 * (1 - tuitionOf(c))); } })),
        bad: R("대학원 입시에 떨어졌다. 취업 준비를 하기로 했다.", fx({ happy: -3 }, 0, { del: ["in_college"], fn: (c) => (c.s.school = "취준생") })),
      }, { hint: "지능 주사위 · 등록금은 학자금 대출", if: (c) => !c.has("med") && !c.has("lawschool") && c.s.edu !== "grad" }),
    ],
  },
  {
    id: "job_hunt", a: [17, 59], mile: true, rep: 1, tag: "취업", t: (c) => (c.has("worked") ? "새 일자리를 찾아야 한다." : "이제 일을 해야 할 때다. 어디에 도전할까?"),
    if: (c) => !c.s.job && !c.has("retired") && c.s.army === 0 && !inCollege(c) && c.age >= (c.s.until || 0) &&
      (c.has("no_uni") || c.has("vocational") || c.has("college") || c.age >= 21) && (c.age >= 19 || c.has("vocational") || c.has("dropout")),
    make: jobOpts,
    opts: [],
  },
  {
    id: "bankrupt", a: [20, 100], mile: true, rep: 5, tag: "돈", t: "빚이 감당할 수 없을 만큼 불어났다.",
    // 집 대출은 집값만큼 빼고 봄 — 아파트를 샀다고 파산 마디가 뜨거나, 집 대출까지 탕감받지 않게
    if: (c) => { const b = badDebt(c.s); return b >= 10000 && b > Math.max(1000, c.s.income) * 5; },
    opts: [
      pick("개인회생을 신청한다", R("개인회생을 신청했다. 빚의 상당 부분을 탕감받았다.", fx({ happy: -6 }, 0, { add: ["bankrupt"], fn: (c) => (c.s.debt -= Math.round(badDebt(c.s) * 0.75)) }), true)),
      pick("어떻게든 갚아본다", R("투잡을 뛰기 시작했다.", fx({ health: -4, happy: -3 }, 0, { fn: (c) => (c.s.debt -= Math.round(badDebt(c.s) * 0.1)) }))),
    ],
  },
  { id: "adult_focus", a: [19, 23], mile: true, kind: "focus", tag: "인생 마디", t: "어엿한 어른이 됐다. 앞으로 어디에 힘을 쏟을까?", opts: focusOpts(2) },
  think("think30", 30, "서른 살 유진이 혼잣말을 했다. 지금 내 인생은…", ["생각보다 괜찮다", "아직 시작도 안 했다", "어디서부터 잘못된 걸까"]),
  {
    id: "wedding", a: [18, 90], mile: true, now: true, tag: "결혼", t: "{p}와 결혼식을 어떻게 할까?",
    if: (c) => c.has("engaged") && !!c.person("partner"),
    opts: [
      pick("호화로운 결혼식", R("호텔에서 성대한 결혼식을 올렸다.", { s: { happy: 8, charm: 2 }, fn: wed(10) }, true), { cost: 10000 }),
      pick("보통 결혼식", R("가족과 친구들 앞에서 결혼식을 올렸다.", { s: { happy: 6 }, fn: wed(5) }, true), { cost: 3000 }),
      pick("스몰 웨딩", R("가까운 사람들만 모여 작은 결혼식을 올렸다.", { s: { happy: 5 }, fn: wed(3) }, true), { cost: 800 }),
      pick("혼인신고만", R("혼인신고서 한 장으로 부부가 됐다.", { s: { happy: 3 }, fn: wed(-3) })),
    ],
  },
  think("think50", 50, "쉰 살 유진에게 누군가 물었다. 다시 태어나도 지금처럼 살 거야?", ["응, 똑같이", "조금만 다르게", "완전히 다르게"]),
  {
    id: "retire", a: [30, 75], mile: true, rep: 3, tag: "인생 마디", t: (c) => (c.age < 50 ? "현역에서 물러날 때가 왔다." : "정년이 다가왔다. 은퇴할까?"),
    if: (c) => { const j = JOBS.find((x) => x.id === c.s.job); return !!j && !!j.retire && c.age >= j.retire; },
    opts: [
      pick("은퇴한다", R("마지막 출근을 했다. 꽃다발이 무거웠다.", fx({ happy: 5, health: 2 }, 0, { fn: retireFn }), true)),
      pick("조금 더 일한다", R("아직은 일하는 게 좋다.", fx({ intel: 1, health: -1 }))),
    ],
  },
  { id: "old_focus", a: [65, 67], mile: true, kind: "focus", tag: "인생 마디", t: "노년이 시작됐다. 하루를 어떻게 보낼까?", opts: focusOpts(3) },
  think("think70", 70, "일흔 살 유진이 손주에게 해주고 싶은 말은…", ["하고 싶은 건 다 해봐", "건강이 최고다", "사람을 남겨라"]),
];
