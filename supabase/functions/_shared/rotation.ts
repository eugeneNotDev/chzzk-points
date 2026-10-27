// 오늘의 미니게임 — 하루에 한 게임만 열리고 한국 시간 자정마다 다음 게임으로 바뀜.
// 순서·기준일은 web/src/lib/rotation.ts와 똑같아야 함(화면은 그쪽으로 계산, 서버는 여기로 막음).
// 무료 뽑기는 로테이션과 상관없이 매일 열림. 주인 계정은 테스트용으로 아무 게임이나 할 수 있음.
import { OWNER_CHANNEL_ID } from "./config.ts";
import { json } from "./http.ts";

export const ROTATION = ["roulette", "rps", "odd-even", "rocket"] as const;
export type GameId = (typeof ROTATION)[number];

const DAY_MS = 86_400_000;
const KST_MS = 9 * 3_600_000;
// 2026-10-28(한국 날짜)이 룰렛인 날
const ANCHOR_DAY = Math.floor(Date.UTC(2026, 9, 28) / DAY_MS);

export const kstDay = (now = Date.now()) => Math.floor((now + KST_MS) / DAY_MS);
export const gameOn = (day: number): GameId => ROTATION[(((day - ANCHOR_DAY) % ROTATION.length) + ROTATION.length) % ROTATION.length];
export const todayGame = (now = Date.now()) => gameOn(kstDay(now));
export const nextChangeAt = (now = Date.now()) => new Date((kstDay(now) + 1) * DAY_MS - KST_MS).toISOString();

// 오늘 게임이 아니면 403 응답, 맞으면 null
export function notToday(game: GameId, channelId: string): Response | null {
  if (channelId === OWNER_CHANNEL_ID) return null;
  const today = todayGame();
  return today === game ? null : json({ error: "not_today", today, nextChangeAt: nextChangeAt() }, 403);
}
