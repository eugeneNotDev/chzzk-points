// 새로 만든 화면 목록(주소 → 화면). 여기 등록된 메뉴만 실제 화면이 뜨고, 나머지는 "준비 중".
// 화면마다 따로 불러와서(lazy) 처음 접속할 때 받는 양을 줄이고, 첫 화면이 뜬 뒤 한가할 때 나머지 화면도
// 미리 받아둠(preloadPages) — 메뉴를 옮길 때 "불러오는 중"이 깜빡이지 않고 바로 넘어가게.
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { QUIZ_ENABLED } from "./lib/quiz";
import { LIFE_ENABLED } from "./lib/life";

type Loader = () => Promise<{ default: ComponentType }>;
const LOADERS: Record<string, Loader> = {
  "notice.html": () => import("./pages/notice/Notice"),
  "schedule.html": () => import("./pages/schedule/Schedule"),
  "attendance.html": () => import("./pages/attendance/Attendance"),
  "ranking.html": () => import("./pages/Ranking"),
  "freebox.html": () => import("./pages/Freebox"),
  "mypage.html": () => import("./pages/mypage/MyPage"),
  "shop.html": () => import("./pages/shop/Shop"),
  "titles.html": () => import("./pages/shop/Titles"),
  "predict.html": () => import("./pages/predict/Predict"),
  // 유진고사 — 베타 빌드에서만(lib/quiz.ts QUIZ_ENABLED)
  ...(QUIZ_ENABLED ? { "quiz.html": () => import("./pages/quiz/Quiz") } : {}),
  "roulette.html": () => import("./pages/games/Roulette"),
  "rps.html": () => import("./pages/games/Rps"),
  "oddeven.html": () => import("./pages/games/OddEven"),
  // 유진 키우기 — 베타 빌드에서만(lib/life.ts LIFE_ENABLED)
  ...(LIFE_ENABLED ? { "life.html": () => import("./pages/life/Life") } : {}),
  "board-free.html": () => import("./pages/board/Board").then((m) => ({ default: m.FreeBoard })),
  "board-review.html": () => import("./pages/board/Board").then((m) => ({ default: m.ReviewBoard })),
  "songs.html": () => import("./pages/songs/Songs"),
  "draw.html": () => import("./pages/draw/Draw"),
  "admin.html": () => import("./pages/admin/Admin"),
};

export const PAGES: Record<string, LazyExoticComponent<ComponentType>> = Object.fromEntries(
  Object.entries(LOADERS).map(([k, load]) => [k, lazy(load)]),
);

// 관리자 화면은 관리자일 때만 미리 받음(일반 시청자는 열 일이 없는데 받는 양만 늘어서)
const ADMIN_ONLY = new Set(["admin.html"]);
export function preloadPages(isAdmin = false) {
  const run = () =>
    Object.entries(LOADERS)
      .filter(([k]) => isAdmin || !ADMIN_ONLY.has(k))
      .forEach(([, load]) => load().catch(() => undefined));
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (ric) ric(run);
  else setTimeout(run, 1500);
}

export const isReady = (path: string) => path === "" || path in PAGES;
