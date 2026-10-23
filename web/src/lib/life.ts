// 유진 키우기 v3 — 서버(life-game 함수) 응답 타입과 호출. 인생 진행·결과는 전부 서버가 정하고, 화면은 받은 기록을 보여주기만 함.
// 돈은 전부 "만원" 단위 정수(1 = 1만원). 포인트로 살 땐 1만원 = 1P.
import { useQuery } from "@tanstack/react-query";
import { API } from "./config";
import { apiFetch, useAuth } from "./auth";

// 베타(/beta/) 빌드에서만 메뉴·주소에 들어감. 실제 사이트에 열 때 true로 바꾸고(유진고사와 같은 방식),
// DB의 life_settings.is_open도 true로 바꾸면 시청자 누구나 플레이(그 전엔 서버가 주인 계정만 허용).
export const LIFE_ENABLED: boolean = import.meta.env.MODE !== "live";

export type StatKey = "health" | "intel" | "charm" | "happy" | "talent";
export type Stats = Record<StatKey, number>;

export const STATS: { key: StatKey; label: string; color: string }[] = [
  { key: "health", label: "건강", color: "var(--c-accent)" },
  { key: "intel", label: "지능", color: "var(--c-blue)" },
  { key: "charm", label: "매력", color: "var(--c-pink)" },
  { key: "happy", label: "행복", color: "var(--c-amber)" },
  { key: "talent", label: "끼", color: "#c9a7ff" },
];

export type Tier = "great" | "good" | "normal" | "bad" | "terrible";
export type Roll = { dice: [number, number]; mod: number; total: number; tier: Tier; stat: StatKey | null };
export const TIER_LABEL: Record<Tier, string> = { great: "대성공", good: "성공", normal: "보통", bad: "실패", terrible: "대실패" };

export type Kind = "life" | "day" | "rare" | "fork" | "pick" | "job" | "money" | "people" | "buy" | "think" | "sick" | "end" | "school";
export type LogEntry = { age: number; k: Kind; t: string; d?: Partial<Stats>; m?: number; roll?: Roll; hl?: boolean };

export type PendingOpt = { key: string; text: string; hint?: string; cost?: number; roll?: StatKey | null; mod?: number; off?: string };
export type Pending = { id: string; kind: "fork" | "mile" | "think" | "focus"; tag?: string; text: string; opts: PendingOpt[] };

export type Person = { id: number; role: "mom" | "dad" | "friend" | "partner" | "spouse" | "child" | "pet"; name: string; age: number; bond: number; alive: boolean };
export type Asset = { id: string; name: string; value: number; kind: "home" | "car" | "thing"; age: number };
export type ShopItem = {
  id: string; name: string; cat: string; price: number; hint: string; child: boolean; off: string | null; cashOk: boolean;
  lv: number | null; maxLv: number | null; cur: string | null; // 업그레이드식 장비면 지금 등급·최고 등급·지금 가진 것
};

export type Ending = {
  title: string; mod: string | null; modId: string | null; job: string; jobId: string; cause: "old" | "sick" | "accident"; causeText: string;
  age: number; specialId: string | null; specialText: string | null; mourners: number; netWorth: number; earned: number; peak: number;
};

export type Run = {
  id: number;
  worldNo: number | null;
  isTest: boolean;
  house: string;
  houseName: string;
  status: "playing" | "ended";
  age: number;
  stats: Stats;
  money: { cash: number; invest: number; fund: string; debt: number; assets: Asset[]; net: number; earned: number; peak: number; income: number; expense: number; ret: number };
  job: string | null;
  jobName: string | null;
  salary: number;
  school: string;
  edu: string;
  fame: number;
  biz: number;
  army: number;
  focus: string;
  focusName: string | null;
  focuses: { id: string; name: string; hint: string }[];
  people: Person[];
  sick: { id: string; name: string; sev: number; since: number } | null;
  luck: number;
  pending: Pending | null;
  // 해마다 [나이, 건강, 지능, 매력, 행복, 끼, 순자산(만원), 올해의 운]
  hist: number[][];
  thoughts: { age: number; q: string; a: string }[];
  shop: ShopItem[];
  pointsUsed: number;
  pointsLimit: number;
  jobs: { id: string; name: string; age: number }[];
  ending: Ending | null;
  logFrom: number;
  log: LogEntry[];
  logCount: number;
};

export type House = { id: string; name: string; price: number; bonus: Partial<Stats>; allowance: number; inherit: number; tuition: number };
export type Fund = { id: string; name: string; hint: string };

export type Lobby = {
  isOpen: boolean;
  isTest: boolean;
  dailyLimit: number;
  usedToday: number;
  itemLimit: number;
  nextWorldNo: number;
  myRuns: number;
  balance: number;
  houses: House[];
  funds: Fund[];
  playing: Run | null;
  last: { id: number; title: string; worldNo: number | null } | null;
  dex: { got: number; total: number };
  today: { id: number; worldNo: number | null; title: string; age: number; special: boolean; channelName: string | null }[];
  todayCount: number;
};

export type DexEntry = { id: string; name: string | null; hint: string | null; gotAt: string | null; category?: string };
export type Dex = { jobs: DexEntry[]; modifiers: DexEntry[]; events: DexEntry[]; specials: DexEntry[] };

export function useLifeLobby() {
  const { isLoggedIn, channelId } = useAuth();
  return useQuery({
    queryKey: ["life-lobby", channelId],
    enabled: isLoggedIn,
    staleTime: 15_000,
    retry: (n, e) => !(e instanceof Error && e.message === "not_open") && n < 2,
    queryFn: () => apiFetch<Lobby>(API.life),
  });
}

export function useLifeDex(enabled: boolean) {
  const { isLoggedIn, channelId } = useAuth();
  return useQuery({
    queryKey: ["life-dex", channelId],
    enabled: isLoggedIn && enabled,
    staleTime: 30_000,
    queryFn: () => apiFetch<Dex>(`${API.life}?view=dex`),
  });
}

const post = <T,>(body: Record<string, unknown>) => apiFetch<T>(API.life, { body });
export const fetchRun = (id: number) => apiFetch<Run>(`${API.life}?view=run&id=${id}`);
export const startLife = (house: string) => post<{ run: Run; balance: number }>({ action: "start", house });
export const advanceLife = (runId: number, from: number, years: number) => post<{ run: Run }>({ action: "advance", runId, from, years });
export const chooseLife = (runId: number, key: string, from: number) => post<{ run: Run; roll: Roll | null }>({ action: "choose", runId, key, from });
export const focusLife = (runId: number, focus: string, from: number) => post<{ run: Run }>({ action: "focus", runId, focus, from });
export const fundLife = (runId: number, fund: string, from: number) => post<{ run: Run }>({ action: "fund", runId, fund, from });
export const buyLife = (runId: number, item: string, pay: "cash" | "points", from: number) =>
  post<{ run: Run; balance?: number }>({ action: "buy", runId, item, pay, from });
export const resetLifeTest = () => post<{ deletedRuns: number }>({ action: "reset" });

export const LIFE_ERRORS: Record<string, string> = {
  not_open: "아직 준비 중이에요.",
  bad_house: "집 정보를 찾지 못했어요. 새로고침해 주세요.",
  user_not_found: "이용할 수 없는 계정이에요.",
  in_progress: "이미 키우고 있는 유진이 있어요.",
  daily_limit: "오늘은 더 키울 수 없어요. 내일 다시 만나요.",
  insufficient_balance: "포인트가 부족해요.",
  no_pending: "이미 고른 선택이에요.",
  bad_choice: "선택지를 찾지 못했어요.",
  bad_item: "지금은 살 수 없는 물건이에요.",
  not_playing: "이미 끝난 인생이에요.",
  item_limit: "이번 판에 포인트로 살 수 있는 횟수를 다 썼어요.",
  too_fast: "너무 빨라요. 잠깐만 기다려 주세요.",
  cant_afford: "유진의 돈이 모자라요.",
  points_only: "어릴 땐 보호자가 포인트로만 사줄 수 있어요.",
  busy: "다른 창에서 진행 중이에요. 새로고침해 주세요.",
  too_young: "15세부터 돈을 굴릴 수 있어요.",
  bought: "지금은 다시 살 수 없어요.",
  bad_focus: "지금 나이에는 고를 수 없는 초점이에요.",
  bad_fund: "돈을 굴릴 곳을 찾지 못했어요.",
  has_pending: "먼저 지금 결정을 골라 주세요.",
};

export function lifeErrorText(e: unknown) {
  const code = (e as { body?: { error?: string } })?.body?.error;
  return (code && LIFE_ERRORS[code]) || "잠시 후 다시 시도해 주세요.";
}

// 만원 단위 → "1억 2,300만원"
export function won(m: number, short = false) {
  const neg = m < 0;
  const v = Math.abs(Math.round(m));
  const eok = Math.floor(v / 10000);
  const man = v % 10000;
  let s: string;
  if (eok > 0 && short) s = `${(v / 10000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, "")}억`;
  else if (eok > 0) s = man ? `${eok.toLocaleString("ko-KR")}억 ${man.toLocaleString("ko-KR")}만원` : `${eok.toLocaleString("ko-KR")}억원`;
  else s = short ? `${man.toLocaleString("ko-KR")}만` : `${man.toLocaleString("ko-KR")}만원`;
  return (neg ? "-" : "") + s;
}

export function statChips(d: Partial<Stats> | null | undefined) {
  return STATS.filter((s) => d && typeof d[s.key] === "number" && d[s.key] !== 0).map((s) => ({
    label: `${s.label} ${d![s.key]! > 0 ? "+" : "−"}${Math.abs(d![s.key]!)}`,
    up: d![s.key]! > 0,
  }));
}

export function lifeStage(age: number) {
  if (age < 8) return 0;
  if (age < 19) return 1;
  if (age < 40) return 2;
  if (age < 65) return 3;
  return 4;
}
export const STAGES = ["유년", "학생", "청년", "중년", "노년"];

// hist 한 줄 → 능력치
export function histStats(row: number[] | undefined, fallback: Stats): Stats {
  if (!row || row.length < 6) return fallback;
  return { health: row[1], intel: row[2], charm: row[3], happy: row[4], talent: row[5] };
}

// 한국어 조사(서버 josa.ts와 같은 규칙): 받침 있으면 을/으로, 없으면 를/로
export function josa(w: string, j: "을" | "로" | "와" | "가") {
  const ch = w.charCodeAt(w.length - 1);
  const jong = ch >= 0xac00 && ch <= 0xd7a3 ? (ch - 0xac00) % 28 : 0;
  if (j === "로") return w + (jong !== 0 && jong !== 8 ? "으로" : "로");
  const pair = { 을: ["을", "를"], 와: ["과", "와"], 가: ["이", "가"] }[j];
  return w + (jong !== 0 ? pair[0] : pair[1]);
}
