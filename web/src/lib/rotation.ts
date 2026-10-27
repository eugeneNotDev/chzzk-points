// 오늘의 미니게임 — 하루에 한 게임만 열리고 한국 시간 자정마다 다음 게임으로 바뀜.
// 순서·기준일은 서버(supabase/functions/_shared/rotation.ts)와 똑같아야 함. 실제로 막는 건 서버.
export const ROTATION = [
  { id: "roulette", label: "룰렛", pay: "최대 x10" },
  { id: "rps", label: "가위바위보", pay: "x1.9" },
  { id: "odd-even", label: "홀짝", pay: "x1.9" },
  { id: "rocket", label: "양 로켓", pay: "내린 배수만큼" },
] as const;
export type GameId = (typeof ROTATION)[number]["id"];

const DAY_MS = 86_400_000;
const KST_MS = 9 * 3_600_000;
// 2026-10-28(한국 날짜)이 룰렛인 날
const ANCHOR_DAY = Math.floor(Date.UTC(2026, 9, 28) / DAY_MS);

export const kstDay = (now = Date.now()) => Math.floor((now + KST_MS) / DAY_MS);
export const gameOn = (day: number) => ROTATION[(((day - ANCHOR_DAY) % ROTATION.length) + ROTATION.length) % ROTATION.length];
export const todayGame = (now = Date.now()) => gameOn(kstDay(now));
// 다음 자정(한국 시간)까지 남은 ms
export const msToNextChange = (now = Date.now()) => (kstDay(now) + 1) * DAY_MS - KST_MS - now;
export const gameLabel = (id: string) => ROTATION.find((g) => g.id === id)?.label ?? id;

// 오늘부터 n일 — { day, date(한국 날짜 M/D), game }
export function upcoming(n: number, now = Date.now()) {
  const today = kstDay(now);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date((today + i) * DAY_MS);
    return { day: today + i, date: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, game: gameOn(today + i) };
  });
}
