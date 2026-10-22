// 유진 키우기 — 서버(life-game 함수) 응답 타입과 호출. 인생 진행은 전부 서버가 하고, 화면은 받은 기록을 보여주기만 함.
import { useQuery } from "@tanstack/react-query";
import { API } from "./config";
import { apiFetch, useAuth } from "./auth";

// 베타(/beta/) 빌드에서만 메뉴·주소에 들어감. 실제 사이트에 열 때 true로 바꾸고(유진고사와 같은 방식),
// DB의 life_settings.is_open도 true로 바꾸면 시청자 누구나 플레이(그 전엔 서버가 주인 계정만 허용).
export const LIFE_ENABLED: boolean = import.meta.env.MODE !== "live";

export type StatKey = "health" | "intel" | "charm" | "wealth" | "happy" | "talent";
export type Stats = Record<StatKey, number>;

export const STATS: { key: StatKey; label: string; color: string }[] = [
  { key: "health", label: "건강", color: "var(--c-accent)" },
  { key: "intel", label: "지능", color: "var(--c-blue)" },
  { key: "charm", label: "매력", color: "var(--c-pink)" },
  { key: "wealth", label: "재산", color: "var(--c-gold)" },
  { key: "happy", label: "행복", color: "var(--c-amber)" },
  { key: "talent", label: "끼", color: "#c9a7ff" },
];

export type LogEntry = {
  age: number;
  kind: "life" | "daily" | "rare" | "choice" | "job" | "item" | "plan" | "end";
  text: string;
  delta: string;
  d?: Partial<Stats>; // 이 기록으로 바뀐 능력치
  st?: Stats; // 이 기록 직후 능력치
  hl: boolean;
};
// kind: plan = 5년 계획(집중) 고르기 / event = 갈림길
export type Pending = { kind?: "plan" | "event"; id: string; text: string; choices: { key: string; text: string; hint: string; cur?: boolean }[] };
export type Ending = {
  title: string;
  age: number;
  cause: string;
  modifierId: string | null;
  modifier: string | null;
  jobId: string;
  job: string;
  finaleId: string | null;
  finale: string;
  specialId: string | null;
  specialText: string | null;
  moments: LogEntry[];
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
  job: string | null;
  jobName: string | null;
  focus: string | null;
  focusName: string | null;
  // 해마다 능력치 [나이, 건강, 지능, 매력, 재산, 행복, 끼]
  history: number[][];
  itemsUsed: number;
  spent: number;
  logFrom: number;
  log: LogEntry[];
  logCount: number;
  pending: Pending | null;
  ending: Ending | null;
  jobHistory: { id: string; name: string; age: number }[];
  diary: { age: number; text: string }[] | null;
};

export type House = { id: string; name: string; price: number; bonus: Partial<Stats> };
export type Item = { id: string; name: string; price: number; effects: Partial<Stats> };

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
  items: Item[];
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

export const fetchRun = (id: number) => apiFetch<Run>(`${API.life}?view=run&id=${id}`);
export const startLife = (house: string) => apiFetch<{ run: Run; balance: number }>(API.life, { body: { action: "start", house } });
export const chooseLife = (runId: number, key: string, from: number) => apiFetch<{ run: Run }>(API.life, { body: { action: "choose", runId, key, from } });
export const applyLifeItem = (runId: number, item: string, from: number) =>
  apiFetch<{ run: Run; balance: number }>(API.life, { body: { action: "item", runId, item, from } });
export const resetLifeTest = () => apiFetch<{ deletedRuns: number }>(API.life, { body: { action: "reset" } });

export const LIFE_ERRORS: Record<string, string> = {
  not_open: "아직 준비 중이에요.",
  bad_house: "집 정보를 찾지 못했어요. 새로고침해 주세요.",
  user_not_found: "이용할 수 없는 계정이에요.",
  in_progress: "이미 키우고 있는 유진이 있어요.",
  daily_limit: "오늘은 더 키울 수 없어요. 내일 다시 만나요.",
  insufficient_balance: "포인트가 부족해요.",
  no_pending: "이미 선택한 갈림길이에요.",
  bad_choice: "선택지를 찾지 못했어요.",
  bad_item: "아이템을 찾지 못했어요.",
  not_playing: "이미 끝난 인생이에요.",
  item_limit: "이번 판의 보호자 아이템을 다 썼어요.",
  too_fast: "너무 빨라요. 잠깐만 기다려 주세요.",
};

export function lifeErrorText(e: unknown) {
  const code = (e as { body?: { error?: string } })?.body?.error;
  return (code && LIFE_ERRORS[code]) || "잠시 후 다시 시도해 주세요.";
}

// "재산 +25 · 지능 +5" 처럼 보정값을 칩으로 보여줄 때
export function statChips(d: Partial<Stats> | null | undefined) {
  return STATS.filter((s) => d && typeof d[s.key] === "number" && d[s.key] !== 0).map((s) => ({
    label: `${s.label} ${d![s.key]! > 0 ? "+" : "−"}${Math.abs(d![s.key]!)}`,
    up: d![s.key]! > 0,
  }));
}

export function lifeStage(age: number) {
  if (age < 8) return 0;
  if (age < 20) return 1;
  if (age < 40) return 2;
  if (age < 65) return 3;
  return 4;
}
export const STAGES = ["유년", "청소년", "청년", "중년", "노년"];

// history 한 줄 → 능력치
export function histStats(row: number[] | undefined, fallback: Stats): Stats {
  if (!row || row.length < 7) return fallback;
  return { health: row[1], intel: row[2], charm: row[3], wealth: row[4], happy: row[5], talent: row[6] };
}
