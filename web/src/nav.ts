// 사이트 메뉴 구조 — 사이드바, 모바일 더보기 시트, 라우터가 전부 이 목록 하나를 봄.
// 메뉴를 추가/이름 변경할 땐 여기만 고치면 됨.
// path는 기존 사이트 주소(xxx.html)와 똑같이 둬서 교체 후에도 즐겨찾기·링크가 그대로 동작함.
// 화면은 routes.ts에 등록.
import { LIFE_ENABLED } from "./lib/life";
import {
  CalendarDays,
  ChartColumn,
  CircleCheck,
  Crown,
  Gamepad2,
  Gift,
  House,
  Megaphone,
  NotebookPen,
  MessageSquare,
  Music,
  Sprout,
  ShieldCheck,
  Star,
  Store,
  Trophy,
  UserRound,
  type LucideIcon, Palette } from "lucide-react";

export type NavItem = {
  path: string; // "freebox.html" — 앞에 / 없이(beta/교체 후 둘 다 base 기준)
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  // 퀴즈 — 진행 중인 회차가 있을 때만(관리자는 항상) 메뉴에 보임
  quiz?: boolean;
  // 유진 키우기 — 테스트 중이라 베타 빌드에서만, 관리자에게만 보임(lib/life.ts LIFE_ENABLED)
  life?: boolean;
};

export type NavGroup = { title: string | null; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    title: null,
    items: [
      { path: "", label: "홈", icon: House },
      { path: "notice.html", label: "공지사항", icon: Megaphone },
      { path: "schedule.html", label: "방송 스케줄", icon: CalendarDays },
    ],
  },
  {
    title: "포인트",
    items: [
      { path: "attendance.html", label: "출석체크", icon: CircleCheck },
      { path: "ranking.html", label: "랭킹", icon: Trophy },
      { path: "shop.html", label: "포인트 상점", icon: Store },
      { path: "titles.html", label: "칭호 상점", icon: Crown },
      { path: "predict.html", label: "투표", icon: ChartColumn },
      { path: "quiz.html", label: "퀴즈", icon: NotebookPen, quiz: true },
    ],
  },
  {
    title: "미니게임",
    items: [
      { path: "freebox.html", label: "무료 뽑기", icon: Gift },
      { path: "minigame.html", label: "오늘의 미니게임", icon: Gamepad2 },
      { path: "life.html", label: "유진 키우기", icon: Sprout, adminOnly: true, life: true },
    ],
  },
  {
    title: "커뮤니티",
    items: [
      { path: "board-free.html", label: "자유게시판", icon: MessageSquare },
      { path: "board-review.html", label: "방송 후기", icon: Star },
      { path: "songs.html", label: "방종곡 신청", icon: Music },
      { path: "draw.html", label: "그림 후원", icon: Palette },
    ],
  },
  {
    title: "내 정보",
    items: [
      { path: "mypage.html", label: "마이페이지", icon: UserRound },
      { path: "admin.html", label: "관리자", icon: ShieldCheck, adminOnly: true },
    ],
  },
];

// 실제 사이트 빌드에선 유진 키우기를 메뉴·주소에서 뺌
export const NAV_GROUPS: NavGroup[] = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => LIFE_ENABLED || !i.life) }));
// 옛 주소(룰렛·가위바위보·홀짝이 따로 있던 때) → 오늘의 미니게임으로 넘김(main.tsx). copy-routes도 이 줄을 읽어서 주소를 만들어 둠.
export const LEGACY_PATHS = [{ path: "roulette.html" }, { path: "rps.html" }, { path: "oddeven.html" }].map((p) => p.path);
export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

// 모바일 하단 탭바 — 자주 쓰는 4개 + 더보기
export const MOBILE_TABS = ["", "attendance.html", "shop.html", "freebox.html"];
