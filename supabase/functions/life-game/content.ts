// 유진 키우기 v3 콘텐츠 — 집·초점·직업·상점·일상 이벤트·갈림길·병·엔딩. 돈은 만원 단위.
// 글 안의 {p}=연인/배우자, {f}=친구, {c}=막내 아이, {pet}=반려동물, {job}=지금 직업 이름.
import type { Ctx, Daily, Disease, Focus, Fork, Fx, House, Item, Job, Mod, Opt, Out, Special, Text } from "./engine.ts";
import { STAT_LABEL, type Stats, type StatKey, type Tier } from "./types.ts";

// ── 짧게 쓰기 위한 도구 ──
const fx = (s: Partial<Stats> = {}, m?: number, more: Partial<Fx> = {}): Fx => ({ s, m, ...more });
const R = (t: Text, f?: Fx, hl?: boolean): Out => ({ t, fx: f, hl });
const pick = (t: Text, res: Out, more: Partial<Opt> = {}): Opt => ({ t, res, ...more });
const dice = (t: Text, stat: StatKey | null, out: Partial<Record<Tier, Out>>, more: Partial<Opt> = {}): Opt => ({
  t, roll: stat, out, hint: more.hint ?? (stat ? `${STAT_LABEL[stat]} 주사위` : "운 주사위"), ...more,
});
const single = (c: Ctx) => !c.partner();
const hasKid = (c: Ctx) => c.folks("child").length > 0;
const parentOld = (c: Ctx, min: number) => [...c.folks("mom"), ...c.folks("dad")].some((p) => c.age - p.born >= min);
const anyParent = (c: Ctx) => !!(c.person("mom") || c.person("dad"));
const salaried = (c: Ctx) => {
  const j = JOBS.find((x) => x.id === c.s.job);
  return !!j && !j.creator && !j.biz;
};
const creatorJob = (c: Ctx) => !!JOBS.find((x) => x.id === c.s.job)?.creator;
const bizJob = (c: Ctx) => !!JOBS.find((x) => x.id === c.s.job)?.biz;
const inCollege = (c: Ctx) => c.has("in_college");
const homePrice = (c: Ctx) => Math.round(45000 * Math.pow(1.025, Math.max(0, c.age - 30)) / 100) * 100;
const kidsAt = (c: Ctx, a: number, b: number) => c.folks("child").filter((k) => c.age - k.born >= a && c.age - k.born <= b);

// ── 태어난 집 ──
export const HOUSES: House[] = [
  { id: "poor", name: "단칸방", allowance: 20, tuition: 0, support: 0, inherit: 0, momBond: 60 },
  { id: "normal", name: "평범한 가정", allowance: 60, tuition: 0.5, support: 1500, inherit: 15000, momBond: 60 },
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
  { id: "parttime", name: "알바", stage: 1, s: { charm: 1 }, side: { intel: -1 }, money: 250, hint: "돈 ↑(15세부터) · 지능 조금 ↓" },
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
const eduRank = (c: Ctx) => ({ none: 0, high: 1, local: 2, inseoul: 3, top: 4, grad: 5 })[c.s.edu];
export const JOBS: Job[] = [
  { id: "alba", name: "편의점 알바", cat: "직장", hint: "누구나 한 번쯤은…", req: (c) => c.age >= 17, roll: "charm", dc: 4, pay: 1600, growth: 0.01, cap: 2200 },
  { id: "delivery", name: "배달 기사", cat: "직장", hint: "돈이 급하면…", req: (c) => c.age >= 19, roll: "health", dc: 5, pay: 3200, growth: 0.01, cap: 4200, fy: { health: -1 } },
  { id: "office", name: "회사원", cat: "직장", hint: "평범하게 공부하면…", req: (c) => eduRank(c) >= 2 || c.st("intel") >= 55, roll: "intel", dc: 7, pay: 3600, growth: 0.04, cap: 9000, retire: 60, fy: { happy: -1 } },
  { id: "bigcorp", name: "대기업 직원", cat: "직장", hint: "좋은 대학을 나오면…", req: (c) => eduRank(c) >= 3, roll: "intel", dc: 10, pay: 5200, growth: 0.05, cap: 15000, retire: 58, fy: { happy: -1, health: -1 } },
  { id: "civil", name: "공무원", cat: "직장", hint: "안정을 원하면…", req: (c) => c.st("intel") >= 45, roll: "intel", dc: 10, pay: 3100, growth: 0.035, cap: 7500, retire: 62 },
  { id: "teacher", name: "선생님", cat: "직장", hint: "대학을 나와서 아이들을 좋아하면…", req: (c) => eduRank(c) >= 2, roll: "intel", dc: 10, pay: 3300, growth: 0.03, cap: 8000, retire: 62, fy: { charm: 1 } },
  { id: "dev", name: "개발자", cat: "직장", hint: "게임도 좋아하고 머리도 좋으면…", req: (c) => c.st("intel") >= 55 && (c.has("game") || c.has("own_pc") || eduRank(c) >= 2), roll: "intel", dc: 9, pay: 4500, growth: 0.05, cap: 14000, retire: 55, fy: { health: -1 } },
  { id: "chef", name: "요리사", cat: "직장", hint: "요리에 눈을 뜨면…", req: (c) => c.has("cook"), roll: "talent", dc: 7, pay: 2800, growth: 0.03, cap: 6500, retire: 65 },
  { id: "doctor", name: "의사", cat: "전문직", hint: "의대에 가면…", req: (c) => c.has("med") && !c.has("in_college"), roll: "intel", dc: 8, pay: 7000, growth: 0.08, cap: 30000, retire: 70 },
  { id: "lawyer", name: "변호사", cat: "전문직", hint: "명문대에서 공부를 아주 잘하면…", req: (c) => eduRank(c) >= 4 && c.st("intel") >= 70, roll: "intel", dc: 12, pay: 7000, growth: 0.06, cap: 25000, retire: 70, fy: { happy: -1 } },
  { id: "professor", name: "교수", cat: "전문직", hint: "대학원까지 가면…", req: (c) => c.s.edu === "grad", roll: "intel", dc: 11, pay: 6000, growth: 0.03, cap: 12000, retire: 65, fy: { intel: 1 } },
  { id: "athlete", name: "운동선수", cat: "전문직", hint: "운동을 잘하고 튼튼하면…", req: (c) => c.has("sporty") && c.st("health") >= 65 && c.age <= 26, roll: "health", dc: 10, pay: 5000, growth: 0.08, cap: 20000, retire: 35 },
  { id: "illustrator", name: "일러스트레이터", cat: "방송·예술", hint: "공책에 낙서를 많이 하면…", req: (c) => c.has("artsy"), roll: "talent", dc: 8, pay: 2400, growth: 0.05, cap: 8000 },
  { id: "voice", name: "성우", cat: "방송·예술", hint: "끼와 매력이 둘 다 있으면…", req: (c) => c.st("talent") >= 55 && c.st("charm") >= 45, roll: "talent", dc: 10, pay: 3000, growth: 0.05, cap: 9000 },
  { id: "vtuber", name: "버튜버", cat: "방송·예술", hint: "방송을 꿈꾸게 되면…", req: (c) => c.has("broadcast"), roll: "talent", dc: 6, pay: 0, creator: 1 },
  { id: "streamer", name: "게임 스트리머", cat: "방송·예술", hint: "게임을 너무 좋아하면…", req: (c) => c.has("game") && c.has("broadcast"), roll: "charm", dc: 7, pay: 0, creator: 0.85 },
  { id: "singer", name: "가수", cat: "방송·예술", hint: "음악을 놓지 않으면…", req: (c) => c.has("music") && c.st("talent") >= 55, roll: "talent", dc: 10, pay: 0, creator: 1.1 },
  { id: "idol", name: "아이돌", cat: "방송·예술", hint: "연습생이 되면…", req: (c) => c.has("trainee") && c.age <= 25, roll: "charm", dc: 10, pay: 0, creator: 1.5, retire: 34 },
  { id: "writer", name: "웹소설 작가", cat: "방송·예술", hint: "책을 많이 읽으면…", req: (c) => c.has("bookworm") && c.st("intel") >= 45, roll: "intel", dc: 8, pay: 0, creator: 0.7 },
  { id: "gukbap", name: "국밥집 사장", cat: "자영업", hint: "요리를 좋아하고 가게를 차리면…", req: () => false, roll: "intel", dc: 0, pay: 0, biz: true },
  { id: "cafe", name: "카페 사장", cat: "자영업", hint: "여유 있게 가게를 차리면…", req: () => false, roll: "intel", dc: 0, pay: 0, biz: true },
  { id: "chicken", name: "치킨집 사장", cat: "자영업", hint: "누구나 한 번은 꿈꾸는…", req: () => false, roll: "intel", dc: 0, pay: 0, biz: true },
  { id: "farmer", name: "귀농 농부", cat: "자영업", hint: "도시가 지칠 때쯤…", req: () => false, roll: "health", dc: 0, pay: 2000, growth: 0.01, cap: 3000, fy: { health: 1, happy: 1 } },
  { id: "ceo", name: "재벌 회장", cat: "자영업", hint: "재벌가에서 회사를 물려받으면…", req: () => false, roll: "intel", dc: 0, pay: 15000, growth: 0.04, cap: 40000, fy: { happy: -1 } },
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

// ── 일상 이벤트(주사위 없이 그냥 일어나는 일) tone: 1 좋은 일 / -1 나쁜 일 ──
const D = (id: string, a: [number, number], t: Text, f?: Fx, more: Partial<Daily> = {}): Daily => ({ id, a, t, fx: f, ...more });
const R1 = (id: string, a: [number, number], t: Text, f: Fx | undefined, hint: string, more: Partial<Daily> = {}): Daily => ({ id, a, t, fx: f, rare: true, hint, ...more });
export const DAILY: Daily[] = [
  // 유아
  D("first_word", [1, 2], "첫 마디가 '엄마'도 '아빠'도 아닌 '밥'이었다.", fx({ happy: 2 })),
  D("first_step", [1, 2], "소파를 붙잡고 첫걸음을 뗐다. 엄마가 울었다.", fx({ health: 1 })),
  D("crayon", [3, 6], "벽에 크레파스로 늑대를 그려서 혼났다.", fx({ talent: 3, happy: -1 })),
  D("kinder_song", [4, 7], "유치원 발표회에서 노래를 불렀다. 박자는 맞지 않았다.", fx({ talent: 2, charm: 1 })),
  D("fever", [0, 7], "열이 펄펄 끓어 밤새 앓았다.", fx({ health: -4 }), { rep: 2, w: 5, tone: -1 }),
  D("hide_seek", [3, 7], "숨바꼭질하다 장롱에서 잠들었다. 온 가족이 찾아다녔다.", fx({ happy: 2 })),
  D("dino", [3, 7], "공룡 이름을 50개 외웠다.", fx({ intel: 2 })),
  D("vegetable", [3, 7], "당근을 몰래 강아지 인형에게 먹였다.", fx({ happy: 1 })),
  D("santa", [5, 8], "산타가 아빠라는 걸 알아버렸다.", fx({ intel: 1, happy: -2 })),
  D("kinder_friend", [4, 7], "유치원에서 처음으로 단짝이 생겼다.", fx({ charm: 2, happy: 2 })),
  D("dad_shoulder", [2, 6], "아빠 목마를 타고 불꽃놀이를 봤다.", fx({ happy: 3 }, 0, { fn: (c) => c.bond(c.person("dad"), 4) }), { tone: 1 }),
  D("mom_lullaby", [0, 5], "엄마가 불러주는 자장가를 따라 흥얼거렸다.", fx({ talent: 1 }, 0, { fn: (c) => c.bond(c.person("mom"), 4) })),
  // 학생
  D("test_good", [8, 19], "시험을 잘 봐서 칭찬받았다.", fx({ intel: 2, happy: 2 }), { rep: 3, w: 8, tone: 1 }),
  D("test_bad", [8, 19], "밤새 게임하다 시험을 망쳤다.", fx({ intel: -2, happy: 1 }, 0, { add: ["game"] }), { rep: 4, w: 6, tone: -1 }),
  D("best_friend", [8, 14], "{f}랑 단짝이 됐다. 하교도 같이, 학원도 같이.", fx({ happy: 4, charm: 2 }, 0, { fn: (c) => { if (!c.person("friend")) c.meet("friend", 65); } }), { w: 14, if: (c) => !c.person("friend") }),
  D("friend_fight", [10, 17], "{f}랑 크게 싸웠지만 다음 날 먼저 사과했다.", fx({ charm: 2 }), { if: (c) => !!c.person("friend") }),
  D("relay", [8, 18], "체육대회 계주에서 역전승을 했다.", fx({ health: 3, happy: 2 }, 0, { add: ["sporty"] }), { tone: 1 }),
  D("guitar_self", [12, 19], "기타를 독학하기 시작했다. 손가락이 아프다.", fx({ talent: 3 }, 0, { add: ["music"] })),
  D("doodle", [10, 19], "공책 귀퉁이마다 그림을 그렸다.", fx({ talent: 3 }, 0, { add: ["artsy"] })),
  D("ramen", [10, 25], "처음 끓인 라면이 기가 막혔다. 요리에 눈을 떴다.", fx({ happy: 2 }, 0, { add: ["cook"] })),
  D("library", [10, 19], "도서관에서 하루 종일 책만 읽었다.", fx({ intel: 3 }, 0, { add: ["bookworm"] })),
  D("cram", [15, 19], "학원 세 군데를 돌며 버텼다.", fx({ intel: 3, health: -2, happy: -2 })),
  D("pimple", [13, 17], "중요한 날 코 끝에 여드름이 났다.", fx({ charm: -1, happy: -1 }), { tone: -1 }),
  D("growth", [12, 16], "1년 사이에 키가 10cm나 컸다.", fx({ health: 2, charm: 2 }), { tone: 1 }),
  D("voice_crack", [13, 15], "변성기가 왔다. 노래방 고음이 안 올라간다.", fx({ talent: -1 })),
  D("late_night_radio", [13, 19], "새벽 라디오에 사연을 보냈는데 읽혔다.", fx({ happy: 4, talent: 1 }), { tone: 1 }),
  D("school_trip", [16, 18], "수학여행에서 밤새 베개 싸움을 했다.", fx({ happy: 4, charm: 1 })),
  D("detention", [12, 18], "수업 시간에 졸다가 벌 청소를 했다.", fx({ happy: -1 }), { tone: -1 }),
  D("allowance_saved", [10, 19], "용돈을 모아 저금통을 깼다.", fx({}, 30), { tone: 1 }),
  D("lost_wallet", [12, 30], "지갑을 잃어버렸다.", fx({ happy: -2 }, -10), { tone: -1, rep: 10 }),
  D("first_game_win", [10, 20], "온라인 게임 랭킹 100위 안에 들었다.", fx({ happy: 3, intel: -1 }, 0, { add: ["game"] }), { if: (c) => c.has("game") }),
  // 대학·청년
  D("mt", [19, 24], "대학 MT에서 장기자랑을 했다. 반응이 뜨거웠다.", fx({ charm: 2, happy: 3 }), { if: inCollege }),
  D("all_nighter_uni", [19, 26], "과제 때문에 밤을 새웠다.", fx({ intel: 2, health: -2 }), { if: inCollege, rep: 2 }),
  D("scholarship", [19, 26], "장학금을 받았다.", fx({ intel: 1, happy: 3 }, 200), { if: (c) => inCollege(c) && c.st("intel") >= 60, tone: 1 }),
  D("first_salary", [18, 35], "첫 월급으로 부모님 내복을 샀다.", fx({ happy: 3 }, -20, { fn: (c) => { c.bond(c.person("mom"), 5); c.bond(c.person("dad"), 5); } }), { if: (c) => !!c.s.job && anyParent(c) }),
  D("indep", [20, 32], "부모님 집에서 나와 첫 자취를 시작했다.", fx({ happy: 2, intel: 1 }), { if: (c) => !!c.s.job }),
  D("convenience_meal", [19, 35], "편의점 도시락으로 일주일을 버텼다.", fx({ health: -1 }), { rep: 5 }),
  // 직장
  D("overtime", [22, 64], "야근이 이어졌다.", fx({ health: -2, happy: -2 }), { if: salaried, rep: 3, w: 5, tone: -1 }),
  D("bonus", [24, 64], "연말 성과급이 나왔다.", fx({ happy: 3 }, 0, { fn: (c) => c.money(Math.round(c.s.salary * 0.15)) }), { if: salaried, rep: 3, w: 5, tone: 1 }),
  D("boss", [22, 60], "부장님 잔소리에 귀에서 피가 날 것 같았다.", fx({ happy: -3 }), { if: salaried, rep: 6, tone: -1 }),
  D("work_award", [25, 60], "올해의 우수 사원으로 뽑혔다.", fx({ happy: 4, charm: 2 }), { if: salaried, tone: 1 }),
  D("team_dinner", [22, 55], "회식 2차, 3차까지 끌려갔다.", fx({ health: -2, charm: 1 }), { if: salaried, rep: 5 }),
  D("raise_special", [26, 60], "연봉 협상이 잘 됐다.", fx({ happy: 3 }, 0, { fn: (c) => (c.s.salary = Math.round(c.s.salary * 1.08)) }), { if: salaried, rep: 6, tone: 1 }),
  D("stream_song", [18, 85], "노래 방송을 했다. 채팅창이 'ㅋㅋㅋ'로 가득 찼다.", fx({ happy: 3, charm: 1 }), { if: creatorJob, rep: 4 }),
  D("stream_long", [18, 70], "12시간 연속 방송을 했다. 다음 날 목소리가 안 나왔다.", fx({ health: -2 }, 0, { fn: (c) => (c.s.fame = Math.min(100, c.s.fame + 3)) }), { if: creatorJob, rep: 5 }),
  D("fan_art", [18, 85], "팬아트가 올라왔다. 실물보다 잘생겼다.", fx({ happy: 4 }), { if: (c) => creatorJob(c) && c.s.fame >= 20, tone: 1 }),
  D("shop_rainy", [28, 75], "장마 내내 손님이 없었다.", fx({ happy: -2 }, 0, { fn: (c) => (c.s.biz = Math.max(0, c.s.biz - 5)) }), { if: bizJob, rep: 4, tone: -1 }),
  D("shop_review", [28, 75], "맛집 블로그에 가게가 소개됐다.", fx({ happy: 3 }, 0, { fn: (c) => (c.s.biz = Math.min(100, c.s.biz + 8)) }), { if: bizJob, tone: 1 }),
  // 돈
  D("refund", [20, 80], "연말정산 환급금이 들어왔다.", fx({ happy: 2 }, 80), { if: salaried, rep: 4, tone: 1 }),
  D("car_scratch", [20, 80], "주차하다 차를 긁었다.", fx({ happy: -2 }, -80), { if: (c) => c.s.assets.some((a) => a.kind === "car"), rep: 5, tone: -1 }),
  D("phone_broke", [15, 70], "스마트폰 액정이 깨졌다.", fx({ happy: -1 }, -30), { rep: 6, tone: -1 }),
  D("found_money", [8, 90], "겨울 외투 주머니에서 5만원을 찾았다.", fx({ happy: 2 }, 5), { rep: 10, tone: 1 }),
  D("fraud_call", [40, 90], "보이스피싱 전화를 받았다. 다행히 눈치챘다.", fx({ intel: 1 })),
  // 사람
  D("partner_cook", [20, 80], "{p}가 미역국을 끓여줬다. 짰지만 다 먹었다.", fx({ happy: 3 }, 0, { fn: (c) => c.bond(c.partner(), 4) }), { if: (c) => !!c.partner(), rep: 5, tone: 1 }),
  D("partner_trip", [20, 75], "{p}와 바다 여행을 다녀왔다.", fx({ happy: 4 }, -100, { fn: (c) => c.bond(c.partner(), 6) }), { if: (c) => !!c.partner(), rep: 4, tone: 1 }),
  D("partner_cold", [20, 75], "{p}와 며칠째 말을 안 했다.", fx({ happy: -3 }, 0, { fn: (c) => c.bond(c.partner(), -8) }), { if: (c) => !!c.partner(), rep: 4, tone: -1 }),
  D("friend_call", [25, 85], "{f}에게 먼저 연락이 왔다. 두 시간을 떠들었다.", fx({ happy: 3 }, 0, { fn: (c) => c.bond(c.person("friend"), 5) }), { if: (c) => !!c.person("friend"), rep: 6, tone: 1 }),
  D("friend_far", [22, 60], "{f}와 연락이 뜸해졌다.", fx({ happy: -1 }, 0, { fn: (c) => c.bond(c.person("friend"), -10) }), { if: (c) => !!c.person("friend"), rep: 8, tone: -1 }),
  D("new_friend", [20, 70], "취미 모임에서 {f}를 만났다. 말이 잘 통했다.", fx({ happy: 3 }, 0, { fn: (c) => { c.meet("friend", 55); } }), { if: (c) => c.folks("friend").length < 2, rep: 10 }),
  D("mom_call", [20, 70], "엄마가 반찬을 바리바리 싸서 보내셨다.", fx({ happy: 3, health: 1 }, 0, { fn: (c) => c.bond(c.person("mom"), 4) }), { if: (c) => !!c.person("mom"), rep: 4, tone: 1 }),
  D("dad_talk", [20, 70], "아빠랑 소주 한잔하며 처음으로 속 깊은 얘기를 했다.", fx({ happy: 3 }, 0, { fn: (c) => c.bond(c.person("dad"), 8) }), { if: (c) => !!c.person("dad"), tone: 1 }),
  D("kid_drawing", [28, 70], "{c}가 아빠 얼굴을 그려줬다. 늑대처럼 생겼다.", fx({ happy: 5 }), { if: (c) => kidsAt(c, 4, 9).length > 0, tone: 1 }),
  D("kid_sick", [26, 70], "{c}가 밤새 열이 나서 응급실에 다녀왔다.", fx({ happy: -2, health: -1 }, -30), { if: (c) => kidsAt(c, 0, 10).length > 0, rep: 3, tone: -1 }),
  D("kid_report", [33, 70], "{c}가 성적표를 숨겼다.", fx({ happy: -1 }), { if: (c) => kidsAt(c, 10, 18).length > 0 }),
  D("kid_gift", [45, 90], "{c}가 첫 월급으로 내복을 사 왔다.", fx({ happy: 6 }), { if: (c) => kidsAt(c, 22, 35).length > 0, tone: 1 }),
  D("grandkid", [52, 95], "손주가 태어났다.", fx({ happy: 6 }, 0, { add: ["grandkid"] }), { if: (c) => kidsAt(c, 26, 45).length > 0, w: 14 }),
  D("pet_walk", [10, 90], "{pet}와 산책하다 동네 사람들과 인사를 나눴다.", fx({ happy: 2, health: 1 }), { if: (c) => !!c.person("pet"), rep: 3, tone: 1 }),
  // 중년
  D("white_hair", [38, 55], "거울을 보다 흰머리를 발견했다.", fx({ happy: -2 })),
  D("class_reunion", [30, 60], "동창회에 나갔다. 다들 많이 변했다.", fx({ charm: 2, happy: 2 })),
  D("back_pain", [38, 75], "허리가 아프기 시작했다.", fx({ health: -3 }), { tone: -1 }),
  D("cold", [20, 100], "독한 감기에 걸려 일주일을 앓았다.", fx({ health: -2 }), { rep: 3, w: 4, tone: -1 }),
  D("cooking_class", [30, 60], "요리 학원에 등록했다.", fx({ happy: 2 }, -50, { add: ["cook"] })),
  D("viral_post", [20, 60], "SNS에 올린 글이 소소하게 화제가 됐다.", fx({ charm: 2, happy: 2 })),
  D("marathon", [25, 60], "마라톤 하프 코스를 완주했다.", fx({ health: 3, happy: 3 }), { if: (c) => c.s.focus === "exercise", tone: 1 }),
  D("gym_pr", [20, 65], "헬스장에서 개인 기록을 깼다.", fx({ health: 2, charm: 1 }), { if: (c) => c.s.focus === "exercise", rep: 4 }),
  D("selfdev_cert", [20, 60], "퇴근 후 공부해서 자격증을 땄다.", fx({ intel: 3 }, 0, { add: ["cert"] }), { if: (c) => c.s.focus === "selfdev", rep: 5, tone: 1 }),
  D("upload", [18, 70], "만든 작품을 인터넷에 올렸다. 댓글이 세 개 달렸다.", fx({ talent: 2, happy: 2 }), { if: (c) => c.s.focus === "create", rep: 3 }),
  D("meet_cafe", [20, 42], "단골 카페에서 자주 마주치던 {p}와 말을 트게 됐다.", fx({ happy: 4 }, 0, { fn: (c) => { c.meet("partner", 45); } }), { if: single, w: 6, rep: 4, tone: 1 }),
  D("blind_luck", [20, 45], "친구 결혼식에서 {p}를 처음 만났다.", fx({ happy: 5 }, 0, { fn: (c) => { c.meet("partner", 50); } }), { if: (c) => single(c) && c.s.focus === "people", w: 12, rep: 6, tone: 1 }),
  // 노년
  D("reading_glasses", [55, 80], "돋보기 안경을 맞췄다.", fx({ intel: 1 })),
  D("smartphone_lesson", [65, 92], "손주에게 스마트폰 쓰는 법을 배웠다.", fx({ intel: 2, happy: 2 }), { if: (c) => c.has("grandkid") }),
  D("long_cold", [70, 100], "감기가 한 달이나 갔다.", fx({ health: -3 }), { rep: 3, w: 4, tone: -1 }),
  D("memoir", [68, 100], "자서전을 쓰기 시작했다.", fx({ intel: 2, happy: 2 })),
  D("old_stream", [65, 100], "은퇴했지만 가끔 방송을 켠다. 네루들은 아직 남아 있다.", fx({ happy: 5 }), { if: (c) => c.s.jobs.some((j) => j.id === "vtuber"), w: 15 }),
  D("hometown", [60, 95], "어릴 적 살던 동네에 가봤다. 놀이터는 그대로였다.", fx({ happy: 3 })),
  D("80th", [80, 80], "팔순 잔치를 했다. 가족들이 다 모였다.", fx({ happy: 5 }), { w: 40 }),
  D("lost_friend", [70, 98], "{f}를 먼저 떠나보냈다.", fx({ happy: -6 }, 0, { fn: (c) => { const f = c.person("friend"); if (f) f.alive = false; } }), { if: (c) => !!c.person("friend"), tone: -1 }),
  D("bingo", [65, 100], "경로당 빙고 대회에서 1등을 했다.", fx({ happy: 3 }), { tone: 1 }),
  D("tv_contest", [60, 90], "노래자랑 예선에 나갔다. 땡이었다.", fx({ happy: 2, charm: 1 })),
  D("walk", [60, 100], "매일 아침 동네 한 바퀴를 걸었다.", fx({ health: 2, happy: 1 }), { rep: 4, w: 4 }),
  D("garden", [60, 100], "텃밭에 상추를 심었다. 잘 자란다.", fx({ happy: 3 })),
  D("fall", [72, 100], "빙판길에서 넘어져 한동안 깁스를 했다.", fx({ health: -5, happy: -2 }), { tone: -1 }),
  // 늑대
  D("wolf1", [12, 25], "늑대 탈을 쓴 꿈을 꿨다. 이상하게 익숙했다.", fx({}, 0, { add: ["wolf_dream1"] }), { w: 1 }),
  D("wolf2", [16, 35], "또 늑대 꿈을 꿨다. 이번엔 누군가 '네루'라고 불렀다.", fx({}, 0, { add: ["wolf_dream2"] }), { w: 2, if: (c) => c.has("wolf_dream1") }),

  // 희귀(도감)
  R1("lottery", [20, 90], "복권 1등에 당첨됐다!!", fx({ happy: 10 }, 100000), "아주 가끔 하늘에서 돈이 떨어지면…", { w: 0.5 }),
  R1("ufo", [10, 85], "밤하늘에서 이상한 빛을 봤다. 아무도 믿어주지 않았다.", fx({ happy: 2 }), "밤하늘을 올려다보면…"),
  R1("viral", [18, 60], "올린 영상이 하룻밤 사이에 백만 조회수를 찍었다.", fx({ charm: 8 }, 300, { add: ["fame"], fn: (c) => (c.s.fame = Math.min(100, c.s.fame + 20)) }), "끼를 세상에 보여주면…", { if: (c) => c.has("mic") || c.has("music") || c.has("artsy") }),
  R1("celeb", [15, 70], "길에서 유명 연예인과 부딪혔다. 사인은 못 받았다.", fx({ happy: 3 }), "번화가를 걷다 보면…"),
  R1("twin", [15, 80], "자신과 똑같이 생긴 사람을 봤다. 다른 평행세계의 유진일까?", fx({ happy: 1 }, 0, { add: ["met_twin"] }), "평행세계가 겹치는 순간이 있다면…"),
  R1("hero", [20, 70], "물에 빠진 아이를 구했다. 뉴스에 나왔다.", fx({ charm: 8, happy: 5 }, 0, { add: ["hero"] }), "용기를 내야 하는 순간이 오면…"),
  R1("ghost", [10, 70], "새벽 3시, 방 안에서 누군가 이름을 불렀다.", fx({ happy: -3, health: -1 }), "미스테리한 밤이 찾아오면…"),
  R1("wolf_moon", [16, 90], "보름달 아래서 늑대 울음소리를 따라 불렀다. 처음으로 음정이 맞았다.", fx({ talent: 10 }), "늑대의 기억을 되찾으면…", { if: (c) => c.has("wolf_dream3") }),
  R1("time_capsule", [25, 60], "초등학교 때 묻은 타임캡슐을 열었다. '미래의 나는 늑대가 되어 있을까?'", fx({ happy: 4 }), "옛날 약속을 기억하면…"),
  R1("stock_10x", [25, 70], "잊고 있던 주식이 10배가 됐다.", fx({ happy: 6 }, 0, { fn: (c) => c.money(Math.max(500, Math.round(c.s.invest * 0.3))) }), "묵혀둔 것이 빛을 보면…", { if: (c) => c.s.invest > 1000 }),
  R1("old_letter", [40, 90], "20년 전 보낸 팬레터에 답장이 왔다.", fx({ happy: 6 }), "오래 좋아한 마음이 닿으면…"),
  R1("meteor", [10, 95], "유성우가 쏟아지는 밤, 소원을 세 번 빌었다.", fx({ happy: 4 }, 0, { fn: (c) => (c.s.luck = 6) }), "별이 쏟아지는 밤에…"),
];

// ── 갈림길(보호자의 선택) ──
// 순서 = 같은 해에 마디가 겹칠 때의 우선순위
const think = (id: string, age: number, q: string, a: [string, string, string]): Fork => ({
  id, a: [age, age + 2], mile: true, kind: "think", tag: "생각 남기기", t: q,
  opts: a.map((x) => pick(x, R("유진은 그렇게 생각하기로 했다.", fx({ happy: 1 })))),
});
const focusOpts = (stage: number): Opt[] => FOCUSES.filter((f) => f.stage === stage).map((f) =>
  pick(f.name, R(`'${f.name}' 위주로 지내기로 했다.`, { fn: (c) => (c.s.focus = f.id) }), { hint: f.hint })
);
const tuitionFx = (edu: "local" | "inseoul" | "top", years = 4, med = false): Fx => ({
  fn: (c) => {
    const h = HOUSES.find((x) => x.id === c.s.house)!;
    const total = (med ? 1500 : 800) * years;
    const loan = Math.round(total * (1 - h.tuition));
    if (loan > 0) c.s.debt += loan;
    c.s.edu = edu;
    c.add("in_college", "college");
    if (med) c.add("med");
    c.s.until = c.age + years;
    c.s.school = med ? "의대생" : "대학생";
  },
});
const meetPartner = (bond = 50): Fx => ({ fn: (c) => { if (!c.partner()) c.meet("partner", bond); } });
const jobOpts = (c: Ctx): Opt[] => {
  const list = JOBS.filter((j) => j.dc > 0 && j.req(c));
  // 맞을 것 같은 순서(능력치 여유가 큰 순)로 4개까지 + 알바
  // 붙을 확률 × 연봉이 큰 순서로 4개
  const scored = list.filter((j) => j.id !== "alba").map((j) => {
    const need = j.dc - Math.max(-3, Math.min(5, Math.round((c.st(j.roll) - 50) / 10)));
    return { j, ev: passP(need) * (j.creator ? 2500 : j.pay) };
  }).sort((a, b) => b.ev - a.ev).slice(0, 4).map((x) => x.j);
  const bonus = (cc: Ctx) => (cc.has("cert") ? 1 : 0) + (cc.s.focus === "selfdev" ? 1 : 0);
  const opts: Opt[] = scored.map((j) => ({
    t: `${j.name}에 도전`,
    arg: j.id,
    roll: j.roll,
    bonus,
    hint: `${STAT_LABEL[j.roll]} 주사위 · ${j.dc} 이상 합격`,
    judge: (cc: Ctx, r) => r.total >= j.dc
      ? R(`${j.name}(으)로 일하게 됐다!`, { s: { happy: 4 }, fn: (x) => { x.hire(j.id, r.tier === "great" ? 1.15 : 1); if (j.creator) x.s.fame = Math.max(x.s.fame, 3); } }, true)
      : R(`${j.name} 도전은 실패했다. 다음 기회를 노리기로 했다.`, { s: { happy: -3 }, fn: (x) => { x.quit("취준생"); x.add("jobless"); } }),
  }));
  opts.push(pick("일단 알바부터 한다", R("편의점 야간 알바를 시작했다.", { fn: (x) => x.hire("alba") }), { arg: "alba", hint: "확실하지만 월급이 적어요" }));
  opts.push(pick("올해는 쉰다", R("올해는 숨 좀 돌리기로 했다.", { s: { happy: 2 }, fn: (x) => x.quit("백수") }), { arg: "rest", hint: "행복 ↑" }));
  return opts;
};

export const FORKS: Fork[] = [
  // ── 인생 마디(조건이 맞으면 반드시) ──
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
      pick("특성화고(일찍 취업)", R("특성화고에 들어갔다. 자격증부터 땄다.", fx({ intel: 1 }, 0, { add: ["vocational", "cert"], fn: (c) => { c.s.school = "특성화고생"; c.s.edu = "high"; c.s.until = 19; } })), { hint: "수능 없이 바로 취업" }),
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
      }, { bonus: (c) => (c.has("tutored") ? 1 : 0) + (c.has("retry") ? 1 : 0) + (c.s.focus === "study" ? 1 : 0), hint: "지능 주사위 · 과외·재수·공부 집중이면 +1" }),
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
    id: "grad", a: [22, 32], mile: true, tag: "인생 마디", t: (c) => (c.has("med") ? "의대를 졸업하고 국가고시까지 붙었다." : "대학을 졸업했다. 학사모를 던졌다."),
    if: (c) => inCollege(c) && c.age >= c.s.until && c.s.army === 0,
    opts: [
      pick("바로 취업 준비", R("졸업장을 들고 사회로 나섰다.", fx({ happy: 3 }, 0, { del: ["in_college"], fn: (c) => (c.s.school = "취준생") }))),
      dice("대학원에 간다", "intel", {
        good: R("대학원에 들어갔다. 2년만 더…", fx({ intel: 4 }, 0, { del: ["in_college"], fn: (c) => { c.s.edu = "grad"; c.s.until = c.age + 2; c.s.school = "대학원생"; } })),
        bad: R("대학원 입시에 떨어졌다. 취업 준비를 하기로 했다.", fx({ happy: -3 }, 0, { del: ["in_college"], fn: (c) => (c.s.school = "취준생") })),
      }, { cost: 1500, if: (c) => !c.has("med") && c.s.edu !== "grad" }),
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
    if: (c) => c.s.debt >= 10000 && c.s.debt > Math.max(1000, c.s.income) * 5,
    opts: [
      pick("개인회생을 신청한다", R("개인회생을 신청했다. 빚의 상당 부분을 탕감받았다.", fx({ happy: -6 }, 0, { add: ["bankrupt"], fn: (c) => (c.s.debt = Math.round(c.s.debt * 0.25)) }), true)),
      pick("어떻게든 갚아본다", R("투잡을 뛰기 시작했다.", fx({ health: -4, happy: -3 }, 0, { fn: (c) => (c.s.debt = Math.round(c.s.debt * 0.9)) }))),
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

  // ── 병(병이 생긴 해에 바로) ──
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
    id: "sick_again", a: [0, 120], rep: 4, w: 15, tag: "건강", t: (c) => `${c.s.sick?.name ?? "병"}이(가) 다시 말썽이다.`,
    if: (c) => !!c.s.sick && c.s.sick.since < c.age,
    opts: [
      dice("다시 치료받는다", "health", {
        good: R("이번엔 완치됐다.", fx({ health: 4, happy: 3 }, 0, { fn: (c) => (c.s.sick = null) })),
        bad: R("나아지지 않았다.", fx({ health: -2 })),
      }, { cost: (c) => { const d = DISEASES.find((x) => x.id === c.s.sick?.id); return Math.round((d?.cost ?? 1000) * 0.6 * (c.has("insurance") ? 0.3 : 1)); } }),
      pick("받아들이고 산다", R("병과 함께 사는 법을 배웠다.", fx({ happy: 1 }))),
    ],
  },

  // ── 어린 시절 ──
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
    id: "audition", a: [13, 19], tag: "꿈", t: "길에서 연예기획사 명함을 받았다. 오디션을 보러 오라고 한다.",
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

  // ── 연애·결혼·가족 ──
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
      }),
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

  // ── 부모님 ──
  {
    id: "par_support", a: [24, 36], tag: "가족", t: "부모님이 결혼·집 자금을 보태주겠다고 하신다.",
    if: (c) => anyParent(c) && (c.s.house === "normal" || c.s.house === "comfy" || c.s.house === "rich"),
    opts: [
      pick("감사히 받는다", R((c) => `부모님께 ${Math.round((HOUSES.find((h) => h.id === c.s.house)!.support) / 100) * 100}만원을 받았다.`, fx({ happy: 2 }, 0, { fn: (c) => c.money(HOUSES.find((h) => h.id === c.s.house)!.support) }))),
      pick("스스로 하겠다며 사양한다", R("부모님이 서운해하시면서도 뿌듯해하셨다.", fx({ charm: 2, happy: 1 }, 0, { fn: (c) => { c.bond(c.person("mom"), 6); c.bond(c.person("dad"), 6); } }))),
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
    id: "par_sick", a: [30, 75], rep: 8, w: 10, tag: "가족", t: (c) => `${parentOld(c, 68) && c.person("mom") && c.age - c.person("mom")!.born >= 68 ? "엄마" : "아빠"}가 쓰러지셨다.`,
    if: (c) => parentOld(c, 68),
    opts: [
      pick("직접 간병한다", R("한동안 병원에서 쪽잠을 잤다.", fx({ happy: -3, health: -3 }, 0, { fn: (c) => { c.bond(c.person("mom"), 12); c.bond(c.person("dad"), 12); } }))),
      pick("좋은 요양병원에 모신다", R("주말마다 찾아뵀다.", fx({ happy: -1 }, 0, { fn: (c) => { c.bond(c.person("mom"), 4); c.bond(c.person("dad"), 4); } })), { cost: 2000 }),
      pick("바빠서 자주 못 간다", R("전화만 드렸다. 마음이 무거웠다.", fx({ happy: -4 }, 0, { fn: (c) => { c.bond(c.person("mom"), -8); c.bond(c.person("dad"), -8); } }))),
    ],
  },
  {
    id: "par_live", a: [38, 62], tag: "가족", t: "부모님을 모시고 살지 고민 중이다.", if: (c) => parentOld(c, 70),
    opts: [
      pick("모시고 산다", R("집이 다시 북적거렸다.", fx({ happy: 3 }, -500, { add: ["filial"], fn: (c) => { c.bond(c.person("mom"), 10); c.bond(c.person("dad"), 10); } }))),
      pick("근처로 이사한다", R("주말마다 반찬을 들고 찾아갔다.", fx({ happy: 2 }, -200, { fn: (c) => { c.bond(c.person("mom"), 5); c.bond(c.person("dad"), 5); } }))),
    ],
  },
  {
    id: "chaebol_heir", a: [30, 55], tag: "가족", t: "회장님(아빠)이 회사를 물려받을 생각이 있냐고 물으신다.", if: (c) => c.s.house === "rich" && !!c.person("dad") && c.s.job !== "ceo",
    opts: [
      dice("물려받겠다고 한다", "intel", {
        good: R("후계자로 인정받았다. 회장 자리에 올랐다.", fx({ happy: 3 }, 0, { fn: (c) => c.hire("ceo") }), true),
        bad: R("이사회가 반대했다. 형제들 눈빛이 차가웠다.", fx({ happy: -5 }, 0, { fn: (c) => c.bond(c.person("dad"), -10) })),
      }),
      pick("내 길을 가겠다고 한다", R("아빠가 한참 말이 없으셨다.", fx({ happy: 2, charm: 1 }, 0, { add: ["disinherit"], fn: (c) => c.bond(c.person("dad"), -10) })), { hint: "유산 ↓" }),
    ],
  },

  // ── 친구 ──
  {
    id: "friend_money", a: [22, 65], tag: "사람", t: "{f}가 급하게 돈을 빌려달라고 한다.", if: (c) => !!c.person("friend"),
    opts: [
      dice("빌려준다", null, {
        good: R("{f}가 1년 만에 이자까지 쳐서 갚았다.", fx({ happy: 3 }, 600, { fn: (c) => c.bond(c.person("friend"), 10) })),
        bad: R("{f}와 연락이 끊겼다.", fx({ happy: -6 }, 0, { fn: (c) => c.drop(c.person("friend")) })),
      }, { cost: 500, bonus: (c) => Math.round(((c.person("friend")?.bond ?? 50) - 50) / 15), hint: "운 주사위 · 친할수록 +" }),
      pick("거절한다", R("{f}와 조금 서먹해졌다.", fx({}, 0, { fn: (c) => c.bond(c.person("friend"), -15) }))),
    ],
  },
  {
    id: "friend_biz", a: [27, 55], tag: "사람", t: "{f}가 같이 사업을 해보자고 한다.", if: (c) => !!c.person("friend"),
    opts: [
      dice("동업한다", "intel", {
        great: R("사업이 대박 났다! 투자금이 몇 배로 돌아왔다.", fx({ happy: 8 }, 15000), true),
        good: R("쏠쏠하게 벌었다.", fx({ happy: 4 }, 4500)),
        bad: R("사업이 망했다. 투자금을 날렸다.", fx({ happy: -6 }, 0, { fn: (c) => c.bond(c.person("friend"), -20) })),
        terrible: R("사업이 망하고 {f}와도 틀어졌다.", fx({ happy: -8 }, -1000, { fn: (c) => c.drop(c.person("friend")) })),
      }, { cost: 3000 }),
      pick("거절한다", R("우정은 우정, 돈은 돈.", fx({}))),
    ],
  },
  {
    id: "friend_wedding", a: [24, 40], tag: "사람", t: "{f}가 결혼식 축가를 부탁했다.", if: (c) => !!c.person("friend"),
    opts: [
      dice("축가를 부른다", "talent", {
        great: R("하객들이 기립박수를 쳤다. 명함을 세 장 받았다.", fx({ charm: 4, happy: 5 }, 0, { fn: (c) => c.bond(c.person("friend"), 10) }), true),
        good: R("무사히 불렀다. {f}가 고마워했다.", fx({ happy: 3 }, 0, { fn: (c) => c.bond(c.person("friend"), 8) })),
        bad: R("고음에서 삑사리가 났다. 영상이 박제됐다.", fx({ happy: -3 }, 0, { fn: (c) => c.bond(c.person("friend"), 3) })),
      }),
      pick("축의금만 두둑이", R("축의금을 두둑이 냈다.", fx({}, -50, { fn: (c) => c.bond(c.person("friend"), 3) }))),
    ],
  },

  // ── 일·돈 ──
  {
    id: "promo", a: [28, 58], rep: 4, w: 14, tag: "일", t: "승진 심사가 다가왔다.", if: salaried,
    opts: [
      dice("밤새 준비한다", "intel", {
        great: R("특진했다! 연봉이 크게 올랐다.", fx({ happy: 6, health: -1 }, 0, { fn: (c) => (c.s.salary = Math.round(c.s.salary * 1.25)) }), true),
        good: R("승진했다.", fx({ happy: 4, health: -1 }, 0, { fn: (c) => (c.s.salary = Math.round(c.s.salary * 1.12)) })),
        bad: R("이번에도 누락됐다.", fx({ happy: -4, health: -1 })),
      }, { bonus: (c) => (c.s.focus === "work" ? 2 : 0) }),
      pick("될 대로 되라", R("결과를 기다렸다.", fx({}, 0, { fn: (c) => { if (c.chance(0.3)) c.s.salary = Math.round(c.s.salary * 1.08); } }))),
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
        great: R("늑대 귀가 달린 아바타로 데뷔했다. 데뷔 방송부터 동접 천 명!", fx({ happy: 6 }, 0, { add: ["debut"], fn: (c) => { c.hire("vtuber"); c.s.fame = Math.max(c.s.fame, 25); } }), true),
        good: R("늑대 귀가 달린 아바타로 데뷔했다.", fx({ happy: 4 }, 0, { add: ["debut"], fn: (c) => { c.hire("vtuber"); c.s.fame = Math.max(c.s.fame, 10); } }), true),
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
        bad: R("사과문이 또 논란이 됐다.", fx({ happy: -6 }, 0, { fn: (c) => (c.s.fame = Math.max(0, c.s.fame - 12)) })),
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
      pick("은퇴한다", R("마지막 방송(영업)을 마쳤다. 고마운 사람이 많았다.", fx({ happy: 5 }, 0, { fn: retireFn }), true)),
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
    id: "wolf", a: [18, 40], w: 4, tag: "???", t: "꿈속 늑대가 '이제 기억났냐'고 묻는다.", if: (c) => c.has("wolf_dream2"),
    opts: [
      pick("기억났다고 대답한다", R("늑대가 웃었다. 무언가 깨어난 기분이다.", fx({ talent: 5 }, 0, { add: ["wolf_dream3"] }), true), { hint: "???" }),
      pick("그냥 꿈이라고 넘긴다", R("그 뒤로 늑대 꿈은 꾸지 않았다.", fx({ happy: 1 }, 0, { del: ["wolf_dream1", "wolf_dream2"] }))),
    ],
  },
];

// 주사위 두 개 합이 n 이상일 확률
function passP(n: number) {
  let k = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b >= n) k++;
  return k / 36;
}
function wed(bond: number) {
  return (c: Ctx) => {
    const p = c.person("partner");
    if (p) {
      p.role = "spouse";
      p.since = c.age;
      c.bond(p, bond);
    }
    c.del("engaged");
    c.add("married");
  };
}
function retireFn(c: Ctx) {
  if (c.age < 50) {
    // 운동선수·아이돌처럼 일찍 그만두는 직업은 새 일을 찾음
    c.quit("새 출발 준비 중");
    c.add("early_retired");
    return;
  }
  if (c.s.job === "civil" || c.s.job === "teacher") c.add("pension_civil");
  c.quit("은퇴");
  c.add("retired");
}
function statModOf(c: Ctx, k: StatKey) {
  return Math.max(-3, Math.min(5, Math.round((c.st(k) - 50) / 10)));
}

// ── 엔딩 수식어(높은 pr부터) ──
const kids = (c: Ctx) => c.s.people.filter((p) => p.role === "child").length;
export const MODS: Mod[] = [
  { id: "billion", text: "100억을 모은", hint: "재산을 아주 크게 모으면…", pr: 40, if: (c) => c.net() >= 1000000 },
  { id: "debt", text: "빚에 쫓기던", hint: "빚이 산더미처럼 쌓이면…", pr: 35, if: (c) => c.s.debt >= 20000 && c.net() < 0 },
  { id: "rich_lonely", text: "돈은 많지만 외로운", hint: "돈은 넘치는데 곁에 아무도 없으면…", pr: 32, if: (c) => c.net() >= 100000 && !c.person("spouse") && c.folks("friend").length === 0 },
  { id: "famous", text: "모두가 아는", hint: "아주 유명해지면…", pr: 31, if: (c) => c.s.fame >= 70 },
  { id: "poor_happy", text: "가난해도 웃음 많은", hint: "가진 건 없어도 행복하면…", pr: 30, if: (c) => c.net() <= 2000 && c.st("happy") >= 75 },
  { id: "rags_up", text: "고생 끝에 낙이 온", hint: "단칸방에서 시작해 자리를 잡으면…", pr: 28, if: (c) => c.s.house === "poor" && c.net() >= 50000 },
  { id: "big_family", text: "대가족을 이룬", hint: "아이를 셋 넘게 키우면…", pr: 27, if: (c) => kids(c) >= 3 },
  { id: "smart_awkward", text: "머리는 좋았지만 사회생활은 서툰", hint: "공부만 하고 사람은 어려워하면…", pr: 25, if: (c) => c.st("intel") >= 80 && c.st("charm") <= 35 },
  { id: "loved", text: "모두에게 사랑받은", hint: "매력이 넘치면…", pr: 25, if: (c) => c.st("charm") >= 88 },
  { id: "hidden_genius", text: "세상이 몰라본 천재", hint: "재능은 넘치는데 돈이 없으면…", pr: 24, if: (c) => c.st("intel") >= 80 && c.st("talent") >= 70 && c.net() < 5000 },
  { id: "dreamer", text: "끝까지 꿈을 좇은", hint: "회사를 박차고 나와 꿈을 따라가면…", pr: 20, if: (c) => c.has("dream") && !salaried(c) },
  { id: "family", text: "가족밖에 모르던", hint: "가정을 꾸리고 행복하면…", pr: 18, if: (c) => !!c.person("spouse") && kids(c) >= 1 && c.st("happy") >= 55 },
  { id: "lonely", text: "혼자가 편했던", hint: "평생 혼자 지내면…", pr: 17, if: (c) => !c.s.people.some((p) => p.role === "spouse") && !c.has("married") && c.folks("friend").length === 0 },
  { id: "wanderer", text: "세상을 떠돌던", hint: "해외로 떠나면…", pr: 16, if: (c) => c.has("travel") && (c.has("abroad_work") || c.has("abroad")) },
  { id: "rich", text: "부자가 된", hint: "재산을 크게 모으면…", pr: 20, if: (c) => c.net() >= 300000 },
  { id: "happy", text: "행복하게 산", hint: "아주 행복하면…", pr: 19, if: (c) => c.st("happy") >= 85 },
  { id: "healthy", text: "끝까지 정정했던", hint: "나이 들어서도 튼튼하면…", pr: 15, if: (c) => c.st("health") >= 60 && c.age >= 85 },
  { id: "kind_soul", text: "베풀 줄 알았던", hint: "기부를 하면…", pr: 14, if: (c) => c.has("donor") },
  { id: "carefree", text: "철없는", hint: "공부와 담을 쌓으면…", pr: 12, if: (c) => c.st("intel") <= 30 },
  { id: "ordinary", text: "평범하지만 단단한", hint: "누구나 한 번쯤은…", pr: 0, if: () => true },
];

// ── 특수 엔딩 ──
export const SPECIALS: Special[] = [
  { id: "wolf", title: "아무도 몰랐던 늑대 유진", text: "평생 사람인 척 살았지만, 마지막 보름달 아래서 유진은 원래 모습으로 돌아갔어요.", hint: "늑대 꿈을 끝까지 따라가면…", pr: 100, if: (c) => c.has("wolf_dream3") },
  { id: "true_vtuber", title: "진짜 버튜버가 된 유진", text: "네루들과 함께한 방송이 평생의 자랑이 됐어요.", hint: "방송을 놓지 않고 팬들에게 이름을 붙여주면…", pr: 80, if: (c) => c.s.jobs.some((j) => j.id === "vtuber") && c.has("yangs") && c.s.fame >= 55 },
  { id: "centenarian", title: "백 살 유진", text: "한 세기를 꽉 채워 살았어요. 생일 케이크 초가 모자랐어요.", hint: "아주아주 오래 살면…", pr: 75, if: (c) => c.age >= 100 },
  { id: "prodigal", title: "재벌가의 탕아 유진", text: "모든 걸 가지고 태어났지만, 모든 걸 잃고 떠났어요.", hint: "모든 걸 가지고 태어나 모든 걸 잃으면…", pr: 70, if: (c) => c.s.house === "rich" && c.net() < 0 },
  { id: "rags_riches", title: "단칸방에서 빌딩까지 올라간 유진", text: "단칸방 창문으로 보던 빌딩이 결국 유진의 것이 됐어요.", hint: "가장 낮은 곳에서 가장 높은 곳으로 가면…", pr: 70, if: (c) => c.s.house === "poor" && c.net() >= 300000 },
  { id: "hero", title: "모두의 영웅 유진", text: "그날 물에 뛰어든 용기를 사람들은 오래 기억했어요.", hint: "용기를 내야 하는 순간이 오면…", pr: 60, if: (c) => c.has("hero") && c.has("brave") },
  { id: "lottery_life", title: "인생 역전 유진", text: "복권 한 장이 인생을 바꿨어요. 정말로요.", hint: "아주 운이 좋으면…", pr: 55, if: (c) => !!c.s.seen["lottery"] },
];
