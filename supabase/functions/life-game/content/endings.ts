// 유진 키우기 엔딩 — 수식어, 특수 엔딩.
import type { Ctx, Mod, Special } from "../engine.ts";
import { creatorJob, salaried } from "./util.ts";

// ── 엔딩 수식어(높은 pr부터) ──
const kids = (c: Ctx) => c.s.people.filter((p) => p.role === "child").length;
// 평생 가장 높았던 능력치(hist: [나이, 건강, 지능, 매력, 행복, 끼, …]) — 죽을 땐 다들 늙어서 낮아지니까 엔딩은 최고점으로 봄
const peak = (c: Ctx, i: number) => c.s.hist.reduce((m, r) => Math.max(m, r[i] ?? 0), 0);
export const MODS: Mod[] = [
  { id: "vt_grad", text: "아름답게 졸업한", hint: "버튜버로 지내다 졸업 방송을 하면…", pr: 21, if: (c) => c.has("vt_graduated") && !c.has("vt_convert") },
  { id: "vt_convert", text: "두 번째 방송 인생을 연", hint: "버튜버를 졸업하고 다른 방송으로 전향하면…", pr: 22, if: (c) => c.has("vt_convert") },
  { id: "yuneung", text: "무능 알파에서 유능 알파가 된", hint: "'무능 알파' 소리를 실력으로 뒤집으면…", pr: 33, if: (c) => c.has("yuneung_real") },
  { id: "billion", text: "100억을 모은", hint: "재산을 아주 크게 모으면…", pr: 40, if: (c) => c.net() >= 1000000 },
  { id: "debt", text: "빚에 쫓기던", hint: "빚이 산더미처럼 쌓이면…", pr: 35, if: (c) => c.s.debt >= 20000 && c.net() < 0 },
  { id: "rich_lonely", text: "돈은 많지만 외로운", hint: "돈은 넘치는데 곁에 아무도 없으면…", pr: 32, if: (c) => c.net() >= 100000 && !c.person("spouse") && c.folks("friend").length === 0 },
  { id: "famous", text: "모두가 아는", hint: "아주 유명해지면…", pr: 31, if: (c) => c.s.fame >= 70 || c.has("gold_button") },
  { id: "poor_happy", text: "가난해도 웃음 많은", hint: "가진 건 없어도 행복하면…", pr: 30, if: (c) => c.net() <= 2000 && c.st("happy") >= 75 },
  { id: "rags_up", text: "고생 끝에 낙이 온", hint: "단칸방에서 시작해 자리를 잡으면…", pr: 28, if: (c) => c.s.house === "poor" && c.net() >= 50000 },
  { id: "big_family", text: "대가족을 이룬", hint: "아이를 셋 넘게 키우면…", pr: 27, if: (c) => kids(c) >= 3 },
  { id: "smart_awkward", text: "머리는 좋았지만 사회생활은 서툰", hint: "공부만 하고 사람은 어려워하면…", pr: 25, if: (c) => peak(c, 2) >= 80 && peak(c, 3) <= 60 },
  { id: "loved", text: "모두에게 사랑받은", hint: "매력이 넘치면…", pr: 25, if: (c) => peak(c, 3) >= 88 },
  { id: "hidden_genius", text: "세상이 몰라본 천재", hint: "재능은 넘치는데 돈이 없으면…", pr: 24, if: (c) => peak(c, 2) >= 75 && peak(c, 5) >= 70 && c.net() < 10000 },
  { id: "dreamer", text: "끝까지 꿈을 좇은", hint: "회사를 박차고 나와 꿈을 따라가면…", pr: 20, if: (c) => c.has("dream") && !salaried(c) },
  { id: "family", text: "가족밖에 모르던", hint: "가정을 꾸리고 행복하면…", pr: 18, if: (c) => !!c.person("spouse") && kids(c) >= 1 && c.st("happy") >= 55 },
  { id: "lonely", text: "혼자가 편했던", hint: "평생 혼자 지내면…", pr: 17, if: (c) => !c.s.people.some((p) => p.role === "spouse") && !c.has("married") && c.folks("friend").length === 0 },
  { id: "wanderer", text: "세상을 떠돌던", hint: "해외로 떠나면…", pr: 16, if: (c) => c.has("travel") && (c.has("abroad_work") || c.has("abroad")) },
  { id: "rich", text: "부자가 된", hint: "재산을 크게 모으면…", pr: 20, if: (c) => c.net() >= 300000 },
  { id: "happy", text: "행복하게 산", hint: "아주 행복하면…", pr: 19, if: (c) => c.st("happy") >= 85 },
  { id: "healthy", text: "끝까지 정정했던", hint: "나이 들어서도 튼튼하면…", pr: 15, if: (c) => c.age >= 85 && c.s.hist.some((r) => r[0] === 85 && r[1] >= 55) },
  { id: "kind_soul", text: "베풀 줄 알았던", hint: "기부를 하면…", pr: 14, if: (c) => c.has("donor") },
  { id: "carefree", text: "철없는", hint: "공부와 담을 쌓으면…", pr: 12, if: (c) => peak(c, 2) <= 50 },
  { id: "ordinary", text: "평범하지만 단단한", hint: "누구나 한 번쯤은…", pr: 0, if: () => true },
];

// ── 특수 엔딩 ──
export const SPECIALS: Special[] = [
  { id: "neru_raised", title: "네루가 키운 버튜버 유진", text: "후원 알림 하나하나가 유진을 여기까지 데려왔어요. 이 세계의 유진은 그걸 한 번도 잊지 않았어요.", hint: "방송인 유진을 아낌없이 응원하면…", pr: 85, if: (c) => c.s.jobs.some((j) => j.id === "vtuber") && (c.s.donated ?? 0) >= 1000 },
  { id: "baji_boss", title: "바지 사장에서 진짜 사장이 된 유진", text: "'바지 사장' 소리를 듣던 그 유진이 결국 진짜 사장님이 됐어요.", hint: "바지 사장이라는 별명이 생긴 뒤 진짜 가게를 차리면…", pr: 78, if: (c) => c.has("baji") && c.s.jobs.some((j) => ["gukbap", "cafe", "chicken", "ceo"].includes(j.id)) },
  { id: "grandpa_vt", title: "진짜 할아버지가 된 할아버지 유진", text: "'할아버지' 소리를 듣던 방송인은 정말 할아버지가 될 때까지 방송을 켰어요.", hint: "'할아버지' 소리를 들으면서도 끝까지 방송을 하면…", pr: 77, if: (c) => c.has("halabeoji") && creatorJob(c) && c.age >= 75 },
  { id: "wolf", title: "아무도 몰랐던 늑대 유진", text: "평생 사람인 척 살았지만, 마지막 보름달 아래서 유진은 원래 모습으로 돌아갔어요.", hint: "늑대 꿈을 끝까지 따라가면…", pr: 100, if: (c) => c.has("wolf_dream3") },
  { id: "true_vtuber", title: "진짜 버튜버가 된 유진", text: "네루들과 함께한 방송이 평생의 자랑이 됐어요.", hint: "방송을 놓지 않고 팬들에게 이름을 붙여주면…", pr: 80, if: (c) => c.s.jobs.some((j) => j.id === "vtuber") && c.has("yangs") && (c.s.fame >= 55 || c.has("fame55")) },
  { id: "centenarian", title: "백 살 유진", text: "한 세기를 꽉 채워 살았어요. 생일 케이크 초가 모자랐어요.", hint: "아주아주 오래 살면…", pr: 75, if: (c) => c.age >= 100 },
  { id: "prodigal", title: "재벌가의 탕아 유진", text: "모든 걸 가지고 태어났지만, 모든 걸 잃고 떠났어요.", hint: "모든 걸 가지고 태어나 모든 걸 잃으면…", pr: 70, if: (c) => c.s.house === "rich" && c.net() < 0 },
  { id: "rags_riches", title: "단칸방에서 빌딩까지 올라간 유진", text: "단칸방 창문으로 보던 빌딩이 결국 유진의 것이 됐어요.", hint: "가장 낮은 곳에서 가장 높은 곳으로 가면…", pr: 70, if: (c) => c.s.house === "poor" && c.net() >= 300000 },
  { id: "hero", title: "모두의 영웅 유진", text: "그날 물에 뛰어든 용기를 사람들은 오래 기억했어요.", hint: "용기를 내야 하는 순간이 오면…", pr: 60, if: (c) => c.has("hero") && c.has("brave") },
  { id: "lottery_life", title: "인생 역전 유진", text: "복권 한 장이 인생을 바꿨어요. 정말로요.", hint: "아주 운이 좋으면…", pr: 55, if: (c) => !!c.s.seen["lottery"] },
];
