// 새로 만든 화면 목록(주소 → 화면). 여기 등록된 메뉴만 실제 화면이 뜨고, 나머지는 "준비 중".
// 화면마다 따로 불러와서(lazy) 처음 접속할 때 받는 양을 줄임.
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export const PAGES: Record<string, LazyExoticComponent<ComponentType>> = {
  "notice.html": lazy(() => import("./pages/notice/Notice")),
  "schedule.html": lazy(() => import("./pages/schedule/Schedule")),
  "attendance.html": lazy(() => import("./pages/attendance/Attendance")),
  "ranking.html": lazy(() => import("./pages/Ranking")),
  "freebox.html": lazy(() => import("./pages/Freebox")),
};

export const isReady = (path: string) => path === "" || path in PAGES;
