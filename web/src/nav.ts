// 사이트 메뉴 구조 — 사이드바, 모바일 더보기 시트, 라우터가 전부 이 목록 하나를 봄.
// 메뉴를 추가/이름 변경할 땐 여기만 고치면 됨.
// path는 기존 사이트 주소(xxx.html)와 똑같이 둬서 교체 후에도 즐겨찾기·링크가 그대로 동작함.
// 실제 화면이 있는지는 routes.ts에 등록됐는지로 판단(없으면 "준비 중").
import {
  CalendarDays,
  ChartColumn,
  CircleCheck,
  Crown,
  Dices,
  Disc3,
  Gift,
  Hand,
  House,
  Megaphone,
  MessageSquare,
  Music,
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
};

export type NavGroup = { title: string | null; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
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
      { path: "shop.html", label: "포인트 상점", icon: Store },
      { path: "titles.html", label: "칭호 상점", icon: Crown },
      { path: "predict.html", label: "투표", icon: ChartColumn },
      { path: "ranking.html", label: "랭킹", icon: Trophy },
    ],
  },
  {
    title: "미니게임",
    items: [
      { path: "freebox.html", label: "무료 뽑기", icon: Gift },
      { path: "roulette.html", label: "룰렛", icon: Disc3 },
      { path: "rps.html", label: "가위바위보", icon: Hand },
      { path: "oddeven.html", label: "홀짝", icon: Dices },
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

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

// 모바일 하단 탭바 — 자주 쓰는 4개 + 더보기
export const MOBILE_TABS = ["", "attendance.html", "shop.html", "freebox.html"];
