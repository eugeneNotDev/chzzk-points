// 유진 키우기 기본 데이터 — 방송 컨텐츠·태어난 집·투자·올해의 초점·직업·상점·이름·병.
import type { Ctx, Disease, Focus, Fx, House, Item, Job, Show } from "../engine.ts";
import { anyParent, fx, homePrice, kidsAt } from "./util.ts";

export const SHOWS: Show[] = [
  {
    id: "game", name: "게임 방송", hint: "끼 주사위 · 무난하게", stat: "talent",
    great: "아무도 못 깬 보스를 한 번에 잡았다. 이날만큼은 채팅창에 '유능 알파'가 올라왔다.",
    bad: "보스한테 열두 번 죽었다. 채팅창이 '무능 알파'로 도배됐다.", badFx: { s: { happy: -3 }, add: ["yuneung_mock"] },
    dF: { great: 12, good: 5, normal: 1, bad: -3, terrible: -5 },
  },
  {
    id: "chat", name: "저챗", hint: "매력 주사위 · 말발이 중요", stat: "charm",
    great: "저챗에서 한 말이 명언 짤로 돌았다.",
    bad: "저챗에서 한 말이 와전돼서 한동안 시끄러웠다.", badFx: { s: { happy: -5 }, add: ["vt_down"] },
    dF: { great: 11, good: 5, normal: 2, bad: -2, terrible: -9 },
  },
  {
    id: "song", name: "노래 방송", hint: "끼 주사위 −1 · 망해도 웃기면 그만", stat: "talent", bonus: -1,
    great: "노래 방송 도중 기적처럼 음정이 맞았다. 네루들이 녹음 버튼을 눌렀다.",
    bad: "노래 방송에서 음이탈이 났다. 그 클립이 역대 조회수 1위를 찍었다.", badFx: { s: { happy: -1 } },
    dF: { great: 15, good: 3, normal: 0, bad: -2, terrible: 7 },
  },
  {
    id: "radio", name: "미스테리 라디오", hint: "지능 주사위 · 크게 망하진 않음", stat: "intel",
    great: "미스테리 라디오 사연이 소름 돋는다며 커뮤니티에 퍼졌다.",
    bad: "미스테리 라디오 도중 정전이 됐다. 진짜 미스테리였다.", badFx: { s: { happy: -2 } },
    dF: { great: 9, good: 4, normal: 2, bad: -1, terrible: -4 },
  },
];
// ── 태어난 집 ──
export const HOUSES: House[] = [
  { id: "poor", name: "단칸방", allowance: 20, tuition: 0, support: 0, inherit: 0, momBond: 60 },
  { id: "normal", name: "평범한 가정", allowance: 100, tuition: 0.75, support: 3000, inherit: 25000, momBond: 68 },
  { id: "comfy", name: "여유 있는 집", allowance: 150, tuition: 1, support: 6000, inherit: 70000, momBond: 58 },
  { id: "rich", name: "재벌가", allowance: 700, tuition: 1, support: 30000, inherit: 300000, momBond: 48 },
];

// ── 투자 ──
export const FUNDS = [
  { id: "deposit", name: "예금", mean: 0.02, vol: 0, hint: "연 2% · 안전" },
  { id: "bond", name: "채권형 펀드", mean: 0.03, vol: 0.02, hint: "연 3% 안팎 · 조금 출렁" },
  { id: "stock", name: "주식형 펀드", mean: 0.055, vol: 0.06, hint: "연 5% 안팎 · 해마다 크게 출렁" },
  { id: "coin", name: "코인", mean: 0.06, vol: 0.25, hint: "대박 아니면 쪽박" },
] as const;

// ── 올해의 초점(언제든 바꿀 수 있음, 다음 해부터 적용) ──
export const FOCUSES: Focus[] = [
  { id: "play", name: "마음껏 놀기", stage: 0, s: { happy: 2 }, side: { intel: -1 }, hint: "행복 ↑" },
  { id: "read", name: "그림책 읽기", stage: 0, s: { intel: 2 }, hint: "지능 ↑" },
  { id: "outside", name: "밖에서 뛰놀기", stage: 0, s: { health: 2 }, hint: "건강 ↑" },
  { id: "art", name: "노래·그림 놀이", stage: 0, s: { talent: 2 }, hint: "끼 ↑" },
  { id: "study", name: "공부", stage: 1, s: { intel: 2 }, side: { happy: -1 }, hint: "지능 ↑ · 행복 조금 ↓" },
  { id: "sports", name: "운동", stage: 1, s: { health: 2 }, hint: "건강 ↑" },
  { id: "friends", name: "친구", stage: 1, s: { charm: 2 }, side: { intel: -1 }, hint: "매력 ↑ · 지능 조금 ↓" },
  { id: "hobby", name: "예체능", stage: 1, s: { talent: 2 }, hint: "끼 ↑" },
  { id: "rest", name: "쉬엄쉬엄", stage: 1, s: { happy: 2 }, hint: "행복 ↑" },
  { id: "parttime", name: "알바", stage: 1, min: 15, s: { charm: 1 }, side: { intel: -1 }, money: 250, hint: "돈 ↑ · 지능 조금 ↓" },
  { id: "work", name: "일·저축", stage: 2, s: {}, side: { happy: -1, health: -1 }, hint: "월급·승진 ↑ · 행복·건강 조금 ↓" },
  { id: "selfdev", name: "자기계발", stage: 2, s: { intel: 2 }, side: { happy: -1 }, hint: "지능 ↑ · 행복 조금 ↓" },
  { id: "exercise", name: "운동", stage: 2, s: { health: 2 }, hint: "건강 ↑" },
  { id: "people", name: "연애·사람", stage: 2, s: { charm: 2, happy: 1 }, hint: "매력·행복 ↑ · 인연 ↑" },
  { id: "create", name: "창작·방송", stage: 2, s: { talent: 2 }, hint: "끼 ↑ · 방송 인지도 ↑" },
  { id: "chill", name: "쉬엄쉬엄", stage: 2, s: { happy: 2 }, side: { health: 1 }, hint: "행복 ↑" },
  { id: "family", name: "가족과 시간", stage: 3, s: { happy: 2 }, hint: "행복 ↑ · 가족 사이 ↑" },
  { id: "health", name: "건강 관리", stage: 3, s: { health: 2 }, hint: "건강 ↑" },
  { id: "hobby_old", name: "취미 생활", stage: 3, s: { happy: 1, talent: 1 }, hint: "행복·끼 ↑" },
  { id: "volunteer", name: "봉사", stage: 3, s: { charm: 2 }, hint: "매력 ↑" },
];

// ── 직업 ──
export const eduRank = (c: Ctx) => ({ none: 0, high: 1, local: 2, inseoul: 3, top: 4, grad: 5 })[c.s.edu];
export const JOBS: Job[] = [
  { id: "alba", name: "편의점 알바", cat: "직장", hint: "누구나 한 번쯤은…", req: (c) => c.age >= 17, roll: "charm", dc: 4, pay: 1600, growth: 0.01, cap: 2200 , ranks: ["편의점 알바생", "고참 알바생", "편의점 매니저"] },
  { id: "delivery", name: "배달 기사", cat: "직장", hint: "돈이 급하면…", req: (c) => c.age >= 19, roll: "health", dc: 5, pay: 3200, growth: 0.01, cap: 4200, fy: { health: -1 } , ranks: ["초보 배달 기사", "배달 기사", "베테랑 배달 기사", "배달의 신"] },
  { id: "office", name: "회사원", cat: "직장", hint: "평범하게 공부하면…", req: (c) => eduRank(c) >= 2 || c.st("intel") >= 55, roll: "intel", dc: 7, pay: 3600, growth: 0.04, cap: 9000, retire: 60, fy: { happy: -1 } , ranks: ["인턴", "사원", "대리", "과장", "차장", "부장", "임원"] },
  { id: "bigcorp", name: "대기업 직원", cat: "직장", hint: "좋은 대학을 나오면…", req: (c) => eduRank(c) >= 3, roll: "intel", dc: 10, pay: 5200, growth: 0.05, cap: 15000, retire: 58, fy: { happy: -1, health: -1 } , ranks: ["대기업 신입사원", "대기업 대리", "대기업 과장", "대기업 차장", "대기업 부장", "대기업 상무", "대기업 사장"] },
  { id: "civil", name: "공무원", cat: "직장", hint: "안정을 원하면…", req: (c) => c.st("intel") >= 45, roll: "intel", dc: 10, pay: 3100, growth: 0.035, cap: 7500, retire: 62 , ranks: ["9급 공무원", "7급 공무원", "6급 주무관", "5급 사무관", "4급 서기관", "3급 국장"] },
  { id: "teacher", name: "선생님", cat: "직장", hint: "대학을 나와서 아이들을 좋아하면…", req: (c) => eduRank(c) >= 2, roll: "intel", dc: 10, pay: 3300, growth: 0.03, cap: 8000, retire: 62, fy: { charm: 1 } , ranks: ["기간제 교사", "정교사", "부장 교사", "교감 선생님", "교장 선생님"] },
  { id: "dev", name: "개발자", cat: "직장", hint: "게임도 좋아하고 머리도 좋으면…", req: (c) => c.st("intel") >= 55 && (c.has("game") || c.has("own_pc") || eduRank(c) >= 2), roll: "intel", dc: 9, pay: 4500, growth: 0.05, cap: 14000, retire: 55, fy: { health: -1 } , ranks: ["주니어 개발자", "개발자", "시니어 개발자", "테크 리드", "CTO"] },
  { id: "chef", name: "요리사", cat: "직장", hint: "요리에 눈을 뜨면…", req: (c) => c.has("cook"), roll: "talent", dc: 7, pay: 2800, growth: 0.03, cap: 6500, retire: 65 , ranks: ["막내 요리사", "라인 쿡", "부주방장", "수석 셰프", "스타 셰프"] },
  { id: "doctor", name: "의사", cat: "전문직", hint: "의대에 가면…", req: (c) => c.has("med") && !c.has("in_college"), roll: "intel", dc: 8, pay: 7000, growth: 0.08, cap: 30000, retire: 70 , ranks: ["인턴 의사", "레지던트", "전문의", "의대 교수", "병원장"] },
  { id: "lawyer", name: "변호사", cat: "전문직", hint: "명문대에서 공부를 아주 잘하면…", req: (c) => (eduRank(c) >= 4 && c.st("intel") >= 70) || (c.has("lawschool") && !c.has("in_college")), roll: "intel", dc: 12, pay: 7000, growth: 0.06, cap: 25000, retire: 70, fy: { happy: -1 } , ranks: ["신입 변호사", "어소시에이트 변호사", "파트너 변호사", "대표 변호사"] },
  { id: "professor", name: "교수", cat: "전문직", hint: "대학원까지 가면…", req: (c) => c.s.edu === "grad", roll: "intel", dc: 11, pay: 6000, growth: 0.03, cap: 12000, retire: 65, fy: { intel: 1 } , ranks: ["시간강사", "조교수", "부교수", "정교수", "총장"] },
  { id: "athlete", name: "운동선수", cat: "전문직", hint: "운동을 잘하고 튼튼하면…", req: (c) => c.has("sporty") && c.st("health") >= 65 && c.age <= 26, roll: "health", dc: 10, pay: 5000, growth: 0.08, cap: 20000, retire: 35 , ranks: ["2군 선수", "1군 선수", "주전 선수", "국가대표", "레전드 선수"] },
  { id: "illustrator", name: "일러스트레이터", cat: "방송·예술", hint: "공책에 낙서를 많이 하면…", req: (c) => c.has("artsy"), roll: "talent", dc: 8, pay: 2400, growth: 0.05, cap: 8000 , ranks: ["습작 일러스트레이터", "프리랜서 일러스트레이터", "인기 일러스트레이터", "스타 일러스트레이터"] },
  { id: "voice", name: "성우", cat: "방송·예술", hint: "끼와 매력이 둘 다 있으면…", req: (c) => c.st("talent") >= 55 && c.st("charm") >= 45, roll: "talent", dc: 10, pay: 3000, growth: 0.05, cap: 9000 , ranks: ["신인 성우", "조연 성우", "주연 성우", "국민 성우"] },
  { id: "vtuber", name: "버튜버", cat: "방송·예술", hint: "방송을 꿈꾸게 되면…", req: (c) => c.has("broadcast"), roll: "talent", dc: 6, pay: 0, creator: 1 , ranks: ["갓 데뷔한 버튜버", "하꼬 버튜버", "중소 버튜버", "중견 버튜버", "대형 버튜버", "레전드 버튜버"], rankAt: [0, 8, 22, 40, 62, 85] },
  { id: "streamer", name: "게임 스트리머", cat: "방송·예술", hint: "게임을 너무 좋아하면…", req: (c) => c.has("game") && c.has("broadcast"), roll: "charm", dc: 7, pay: 0, creator: 0.85 , ranks: ["하꼬 스트리머", "중소 스트리머", "중견 스트리머", "대형 스트리머", "탑 스트리머"], rankAt: [0, 15, 35, 60, 85] },
  { id: "singer", name: "가수", cat: "방송·예술", hint: "음악을 놓지 않으면…", req: (c) => c.has("music") && c.st("talent") >= 55, roll: "talent", dc: 10, pay: 0, creator: 1.1 , ranks: ["무명 가수", "인디 가수", "라이징 가수", "인기 가수", "국민 가수"], rankAt: [0, 15, 35, 60, 85] },
  { id: "idol", name: "아이돌", cat: "방송·예술", hint: "연습생이 되면…", req: (c) => c.has("trainee") && c.age <= 25, roll: "charm", dc: 10, pay: 0, creator: 1.5, retire: 34 , ranks: ["데뷔조 아이돌", "신인 아이돌", "라이징 아이돌", "인기 아이돌", "월드스타"], rankAt: [0, 10, 30, 55, 80] },
  { id: "writer", name: "웹소설 작가", cat: "방송·예술", hint: "책을 많이 읽으면…", req: (c) => c.has("bookworm") && c.st("intel") >= 45, roll: "intel", dc: 8, pay: 0, creator: 0.7 , ranks: ["무료연재 작가", "유료연재 작가", "인기 작가", "베스트셀러 작가", "대작가"], rankAt: [0, 15, 35, 60, 85] },
  { id: "youtuber", name: "유튜버", cat: "방송·예술", hint: "버튜버를 졸업하고 얼굴을 공개하면…", req: () => false, roll: "charm", dc: 0, pay: 0, creator: 0.9, ranks: ["새내기 유튜버", "실버 버튼 유튜버", "골드 버튼 유튜버", "다이아 버튼 유튜버"], rankAt: [0, 25, 55, 80] },
  { id: "gukbap", name: "국밥집 사장", cat: "자영업", hint: "요리를 좋아하고 가게를 차리면…", req: () => false, roll: "intel", dc: 0, pay: 0, biz: true , ranks: ["동네 국밥집 사장", "맛집 국밥집 사장", "국밥 체인 대표", "국밥 프랜차이즈 회장"], rankAt: [0, 58, 80, 95] },
  { id: "cafe", name: "카페 사장", cat: "자영업", hint: "여유 있게 가게를 차리면…", req: () => false, roll: "intel", dc: 0, pay: 0, biz: true , ranks: ["동네 카페 사장", "핫플 카페 사장", "카페 체인 대표", "카페 프랜차이즈 회장"], rankAt: [0, 58, 80, 95] },
  { id: "chicken", name: "치킨집 사장", cat: "자영업", hint: "누구나 한 번은 꿈꾸는…", req: () => false, roll: "intel", dc: 0, pay: 0, biz: true , ranks: ["동네 치킨집 사장", "맛집 치킨집 사장", "치킨 체인 대표", "치킨 브랜드 회장"], rankAt: [0, 58, 80, 95] },
  { id: "farmer", name: "귀농 농부", cat: "자영업", hint: "도시가 지칠 때쯤…", req: () => false, roll: "health", dc: 0, pay: 2000, growth: 0.01, cap: 3000, fy: { health: 1, happy: 1 } , ranks: ["초보 농부", "베테랑 농부", "스마트팜 대표"] },
  { id: "ceo", name: "재벌 회장", cat: "자영업", hint: "재벌가에서 회사를 물려받으면…", req: () => false, roll: "intel", dc: 0, pay: 15000, growth: 0.04, cap: 40000, fy: { happy: -1 } , ranks: ["재벌 후계자", "재벌 부회장", "재벌 회장"] },
];

// ── 상점(돈쓰기) — 15세 전은 보호자가 포인트로만 ──
const giveParents: Fx = {
  s: { happy: 2 },
  fn: (c) => {
    c.bond(c.person("mom"), 10);
    c.bond(c.person("dad"), 10);
  },
};
function setCar(c: Ctx, name: string, value: number) {
  c.s.assets = c.s.assets.filter((a) => a.kind !== "car");
  c.s.assets.push({ id: "car", name, value, kind: "car", age: c.age });
}
export const ITEMS: Item[] = [
  { id: "toy", name: "장난감 세트", cat: "보호자 지원", a: [0, 9], price: 50, t: "새 장난감을 받았다. 하루 종일 가지고 놀았다.", fx: fx({ happy: 4 }), hint: "행복 ↑", child: true },
  { id: "picturebook", name: "그림책 전집", cat: "보호자 지원", a: [1, 8], price: 30, t: "그림책 전집이 생겼다.", fx: fx({ intel: 3 }), hint: "지능 ↑", child: true },
  { id: "eng_kinder", name: "영어 유치원", cat: "보호자 지원", a: [4, 7], price: 600, t: "영어 유치원에 다니게 됐다. 'Hello'를 열 번 외쳤다.", fx: fx({ intel: 5, charm: 2 }), hint: "지능·매력 ↑", child: true },
  { id: "taekwondo", name: "태권도 1년", cat: "보호자 지원", a: [5, 14], price: 100, t: "태권도장에 다녔다. 기합 소리가 커졌다.", fx: fx({ health: 4 }, 0, { add: ["sporty"] }), hint: "건강 ↑", child: true },
  { id: "piano", name: "피아노 학원 1년", cat: "보호자 지원", a: [6, 14], price: 150, t: "피아노 학원에 다녔다. 체르니 30번까지 갔다.", fx: fx({ talent: 4 }, 0, { add: ["music"] }), hint: "끼 ↑", child: true },
  { id: "drawing", name: "미술 학원 1년", cat: "보호자 지원", a: [6, 14], price: 120, t: "미술 학원에 다녔다. 스케치북이 금방 찼다.", fx: fx({ talent: 4 }, 0, { add: ["artsy"] }), hint: "끼 ↑", child: true },
  { id: "tutor_kid", name: "과외 1년", cat: "보호자 지원", a: [8, 14], price: 300, t: "과외 선생님이 생겼다.", fx: fx({ intel: 6, happy: -1 }), hint: "지능 ↑", child: true },
  { id: "camp", name: "여름 캠프", cat: "보호자 지원", a: [8, 14], price: 80, t: "여름 캠프에서 친구를 잔뜩 사귀었다.", fx: fx({ charm: 3, happy: 3 }), hint: "매력·행복 ↑", child: true },
  { id: "doctor_kid", name: "큰 병원 진료", cat: "보호자 지원", a: [0, 14], price: 200, t: "보호자 손에 이끌려 큰 병원에 다녀왔다.", fx: fx({ health: 10 }, 0, { fn: (c) => (c.s.sick = null) }), hint: "건강 ↑ · 병 치료", child: true },

  // 장비는 업그레이드식 — 살 때마다 다음 등급으로(최고 등급이면 끝)
  {
    id: "phone", cool: 2, name: "스마트폰", cat: "물건", a: [12, 95], price: 0, t: "", hint: "",
    tiers: [
      { name: "중고 스마트폰", price: 40, t: "중고 스마트폰이 생겼다. 액정에 금이 하나 있다.", fx: fx({ happy: 2 }), hint: "행복 ↑" },
      { name: "최신 스마트폰", price: 150, t: "최신 스마트폰으로 바꿨다.", fx: fx({ happy: 3, charm: 1 }), hint: "행복·매력 ↑" },
      { name: "폴더블 폰", price: 250, t: "폴더블 폰으로 바꿨다. 괜히 접었다 폈다 한다.", fx: fx({ happy: 3, charm: 2 }), hint: "행복·매력 ↑" },
    ],
  },
  {
    id: "pc", cool: 2, name: "컴퓨터", cat: "물건", a: [12, 85], price: 0, t: "", hint: "",
    tiers: [
      { name: "보급형 PC", price: 100, t: "보급형 PC를 장만했다. 게임은 옵션을 낮춰야 돌아간다.", fx: fx({ happy: 2, intel: 1 }, 0, { add: ["game", "own_pc"] }), hint: "행복 ↑ · 게임" },
      { name: "게이밍 PC", price: 250, t: "게이밍 PC로 업그레이드했다. 팬 소리가 비행기 같다.", fx: fx({ happy: 4 }, 0, { add: ["game", "own_pc"] }), hint: "행복 ↑" },
      { name: "하이엔드 PC", price: 600, t: "하이엔드 PC를 맞췄다. 방 온도가 2도 올랐다.", fx: fx({ happy: 4, talent: 1 }, 0, { add: ["game", "own_pc"] }), hint: "행복·끼 ↑" },
    ],
  },
  {
    id: "mic", cool: 1, name: "방송 장비", cat: "물건", a: [13, 90], price: 0, t: "", hint: "",
    tiers: [
      { name: "입문용 마이크", price: 40, t: "입문용 마이크를 샀다. 자기 목소리가 낯설다.", fx: fx({ talent: 2 }, 0, { add: ["mic"] }), hint: "끼 ↑" },
      { name: "방송 장비 세트", price: 300, t: "방송 장비를 장만했다. 첫 방송 버튼 앞에서 한참 망설였다.", fx: fx({ talent: 3 }, 0, { add: ["mic", "broadcast"] }), hint: "끼 ↑ · 방송 가능" },
      { name: "스튜디오 장비", price: 1200, t: "방을 스튜디오처럼 꾸몄다. 방음재가 벽을 덮었다.", fx: fx({ talent: 3, happy: 2 }, 0, { add: ["mic", "broadcast"], fn: (c) => { if (c.s.fame > 0) c.s.fame = Math.min(100, c.s.fame + 5); } }), hint: "끼 ↑ · 방송 인지도 ↑" },
    ],
  },
  {
    id: "guitar", cool: 2, name: "악기", cat: "물건", a: [12, 90], price: 0, t: "", hint: "",
    tiers: [
      { name: "통기타", price: 60, t: "통기타를 샀다. 손가락이 아프다.", fx: fx({ talent: 2 }, 0, { add: ["music"] }), hint: "끼 ↑ · 음악" },
      { name: "일렉 기타", price: 200, t: "일렉 기타를 샀다. 이웃이 벽을 두드렸다.", fx: fx({ talent: 3, happy: 1 }, 0, { add: ["music"] }), hint: "끼 ↑" },
      { name: "홈레코딩 장비", price: 500, t: "홈레코딩 장비를 들였다. 자작곡을 녹음하기 시작했다.", fx: fx({ talent: 3, happy: 2 }, 0, { add: ["music"] }), hint: "끼·행복 ↑" },
    ],
  },
  {
    id: "watch", cool: 5, name: "시계", cat: "물건", a: [18, 95], price: 0, t: "", hint: "",
    tiers: [
      { name: "패션 시계", price: 30, t: "패션 시계를 샀다.", fx: fx({ charm: 1 }), hint: "매력 ↑" },
      { name: "명품 시계", price: 1200, t: "명품 시계를 샀다. 자꾸 손목을 보게 된다.", fx: fx({ charm: 3, happy: 2 }), hint: "매력·행복 ↑" },
      { name: "한정판 시계", price: 5000, t: "한정판 시계를 손에 넣었다. 모임에서 다들 손목만 봤다.", fx: fx({ charm: 3, happy: 2 }), hint: "매력·행복 ↑" },
    ],
  },
  {
    id: "car", cool: 3, name: "자동차", cat: "물건", a: [20, 85], price: 0, t: "", hint: "",
    tiers: [
      { name: "중고차", price: 1000, t: "중고차를 샀다. 가끔 시동이 한 번에 안 걸린다.", fx: fx({ happy: 3 }, 0, { fn: (c) => setCar(c, "중고차", 800) }), hint: "행복 ↑ · 유지비" },
      { name: "새 차", price: 3500, t: "새 차로 바꿨다.", fx: fx({ happy: 4 }, 0, { fn: (c) => setCar(c, "새 차", 3000) }), hint: "행복 ↑ · 유지비" },
      { name: "외제차", price: 9000, t: "외제차를 뽑았다. 주차할 때마다 손이 떨린다.", fx: fx({ happy: 4, charm: 2 }, 0, { fn: (c) => setCar(c, "외제차", 8000) }), hint: "행복·매력 ↑ · 유지비" },
    ],
  },
  { id: "books", name: "책 한 무더기", cat: "물건", a: [10, 100], price: 20, t: "책을 한 무더기 사서 읽었다.", fx: fx({ intel: 2 }, 0, { add: ["bookworm"] }), hint: "지능 ↑" },
  {
    id: "home", name: "아파트 계약금(20%)", cat: "집", a: [26, 90], price: (c) => Math.round(homePrice(c) * 0.2), hint: "나머지 80%는 대출 · 월세 없음",
    t: (c) => `${Math.round(homePrice(c) / 10000)}억짜리 아파트를 샀다. 대출도 생겼다.`,
    fx: fx({ happy: 6 }, 0, { fn: (c) => { const p = homePrice(c); c.s.assets.push({ id: "home", name: "아파트", value: p, kind: "home", age: c.age }); c.s.debt += Math.round(p * 0.8); } }),
    if: (c) => !c.s.assets.some((a) => a.kind === "home"),
  },
  { id: "tutor_teen", name: "수능 과외 1년", cat: "공부", a: [15, 19], price: 500, t: "수능 과외를 받았다.", fx: fx({ intel: 5, happy: -1 }, 0, { add: ["tutored"] }), hint: "지능 ↑ · 수능 주사위 +1" },
  { id: "cert", cool: 2, name: "자격증 학원", cat: "공부", a: [18, 65], price: 300, t: "자격증 학원에 등록했다.", fx: fx({ intel: 4 }, 0, { add: ["cert"] }), hint: "지능 ↑ · 취업 주사위 +1" },
  { id: "gym", name: "헬스장 1년", cat: "건강", a: [16, 95], price: 80, t: "헬스장을 1년 끊었다. 이번엔 진짜 간다.", fx: fx({ health: 4 }), hint: "건강 ↑" },
  { id: "checkup", name: "종합 건강검진", cat: "건강", a: [25, 100], price: 50, t: "종합 건강검진을 받았다.", fx: fx({ health: 1 }, 0, { add: ["checkup"] }), hint: "올해 병을 일찍 발견" },
  { id: "insurance", name: "건강보험 가입", cat: "건강", a: [20, 70], price: 150, t: "건강보험에 가입했다. 해마다 보험료가 나간다.", fx: fx({}, 0, { add: ["insurance"] }), hint: "치료비 70% 보장", once: true },
  { id: "hospital", name: "큰 병원 진료", cat: "건강", a: [15, 100], price: 300, t: "큰 병원에서 제대로 진료를 받았다.", fx: fx({ health: 8 }, 0, { fn: (c) => { if (c.s.sick) c.s.sick.sev = Math.max(0, c.s.sick.sev - 1); if (c.s.sick && c.s.sick.sev === 0) c.s.sick = null; } }), hint: "건강 ↑ · 병 완화" },
  { id: "skin", cool: 2, name: "피부과 관리", cat: "건강", a: [18, 90], price: 200, t: "피부과 관리를 받았다. 거울 보는 시간이 늘었다.", fx: fx({ charm: 3 }), hint: "매력 ↑" },
  { id: "trip_kr", name: "국내 여행", cat: "경험", a: [15, 100], price: 50, t: "훌쩍 국내 여행을 다녀왔다.", fx: fx({ happy: 4 }), hint: "행복 ↑" },
  { id: "trip_world", cool: 2, name: "해외여행", cat: "경험", a: [18, 95], price: 400, t: "해외여행을 다녀왔다. 시차 적응에 사흘이 걸렸다.", fx: fx({ happy: 8, charm: 1 }, 0, { add: ["travel"] }), hint: "행복 ↑↑" },
  { id: "concert", name: "콘서트 티켓", cat: "경험", a: [12, 95], price: 15, t: "좋아하는 가수 콘서트에 다녀왔다. 목이 쉬었다.", fx: fx({ happy: 3 }), hint: "행복 ↑" },
  { id: "pet", name: "반려견 입양", cat: "가족", a: [10, 85], price: 50, t: "{pet}를 입양했다. 집에 온 첫날부터 소파를 차지했다.", fx: fx({ happy: 6 }, 0, { fn: (c) => { c.meet("pet", 80); } }), hint: "행복 ↑", if: (c) => !c.person("pet") },
  { id: "gift_parents", name: "부모님 용돈", cat: "가족", a: [20, 80], price: 300, t: "부모님께 두둑하게 용돈을 드렸다.", fx: giveParents, hint: "부모님 사이 ↑", if: anyParent },
  { id: "parents_trip", name: "부모님 효도 여행", cat: "가족", a: [25, 80], price: 600, t: "부모님을 해외여행 보내드렸다. 사진이 백 장 넘게 왔다.", fx: { ...giveParents, s: { happy: 4 } }, hint: "부모님 사이 ↑↑", if: anyParent },
  { id: "date", name: "데이트 코스", cat: "연애", a: [15, 95], price: 30, t: "{p}와 근사한 데이트를 했다.", fx: fx({ happy: 2 }, 0, { fn: (c) => c.bond(c.partner(), 6) }), hint: "연인 사이 ↑", if: (c) => !!c.partner() },
  { id: "gift_partner", name: "연인 선물", cat: "연애", a: [15, 95], price: 120, t: "{p}에게 선물을 했다. 한참 웃었다.", fx: fx({ happy: 2 }, 0, { fn: (c) => c.bond(c.partner(), 12) }), hint: "연인 사이 ↑↑", if: (c) => !!c.partner() },
  { id: "kid_academy", name: "아이 학원비 1년", cat: "가족", a: [25, 75], price: 600, t: "{c}를 학원에 보냈다.", fx: fx({}, 0, { fn: (c) => { const k = c.folks("child").slice(-1)[0]; c.bond(k, 3); c.add("kid_edu"); } }), hint: "아이 공부 ↑", if: (c) => kidsAt(c, 7, 18).length > 0 },
  { id: "donation", name: "기부", cat: "경험", a: [20, 100], price: 1000, t: "익명으로 1,000만원을 기부했다.", fx: fx({ charm: 3, happy: 4 }, 0, { add: ["donor"] }), hint: "매력·행복 ↑" },
];

// ── 이름 ──
export const NAMES = {
  partner: ["서연", "지우", "하은", "민지", "수아", "예린", "채원", "다인", "윤서", "소희", "지안", "나연", "혜원", "유나", "가은", "세아", "주하", "아린", "보람", "은솔"],
  friend: ["민준", "도윤", "현우", "지호", "태민", "준서", "건우", "시우", "동현", "재원", "승민", "우진"],
  child: ["하준", "서아", "도하", "이안", "로아", "은우", "시아", "유찬", "하린", "다온", "율", "봄"],
  pet: ["콩이", "보리", "두부", "구름이", "라떼", "몽이"],
};

// ── 병 ──
export const DISEASES: Disease[] = [
  { id: "disc", name: "허리 디스크", sev: 1, cost: 500, a: 30 },
  { id: "gastritis", name: "위궤양", sev: 1, cost: 300, a: 30 },
  { id: "diabetes", name: "당뇨", sev: 2, cost: 800, a: 40 },
  { id: "heart", name: "심장병", sev: 3, cost: 3000, a: 45 },
  { id: "stomach_cancer", name: "위암", sev: 3, cost: 4000, a: 40 },
  { id: "lung_cancer", name: "폐암", sev: 4, cost: 6000, a: 50 },
  { id: "dementia", name: "치매 초기", sev: 2, cost: 2000, a: 70 },
];
