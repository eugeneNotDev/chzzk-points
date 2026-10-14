// 새로 만든 화면 목록(주소 → 화면). 여기 등록된 메뉴만 실제 화면이 뜨고, 나머지는 "준비 중".
// 화면마다 따로 불러와서(lazy) 처음 접속할 때 받는 양을 줄임.
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export const PAGES: Record<string, LazyExoticComponent<ComponentType>> = {
  "notice.html": lazy(() => import("./pages/notice/Notice")),
  "schedule.html": lazy(() => import("./pages/schedule/Schedule")),
  "attendance.html": lazy(() => import("./pages/attendance/Attendance")),
  "ranking.html": lazy(() => import("./pages/Ranking")),
  "freebox.html": lazy(() => import("./pages/Freebox")),
  "mypage.html": lazy(() => import("./pages/mypage/MyPage")),
  "shop.html": lazy(() => import("./pages/shop/Shop")),
  "titles.html": lazy(() => import("./pages/shop/Titles")),
  "predict.html": lazy(() => import("./pages/predict/Predict")),
  "roulette.html": lazy(() => import("./pages/games/Roulette")),
  "rps.html": lazy(() => import("./pages/games/Rps")),
  "oddeven.html": lazy(() => import("./pages/games/OddEven")),
  "board-free.html": lazy(() => import("./pages/board/Board").then((m) => ({ default: m.FreeBoard }))),
  "board-review.html": lazy(() => import("./pages/board/Board").then((m) => ({ default: m.ReviewBoard }))),
  "songs.html": lazy(() => import("./pages/songs/Songs")),
  "admin.html": lazy(() => import("./pages/admin/Admin")),
};

export const isReady = (path: string) => path === "" || path in PAGES;
