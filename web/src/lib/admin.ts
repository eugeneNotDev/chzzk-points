// 관리자 화면 공용 — admin 함수 호출, 응답 타입, 날짜 표시.
// 서버가 관리자 세션(OWNER_CHANNEL_ID)을 확인하므로 여기선 화면만 담당.
import { apiFetch } from "./auth";
import { API } from "./config";

export const adminCall = <T>(payload: Record<string, unknown>) => apiFetch<T>(API.admin, { body: payload });

export type Paged = { page: number; pageSize: number; totalCount: number; totalPages: number };

export type AdminUser = { channelId: string; channelName: string | null; isPublic: boolean; banned: boolean; balance: number };

export type LogEntry = {
  id: number;
  channelId?: string;
  channelName?: string | null;
  amount: number;
  reason: string | null;
  processed?: boolean;
  adminAction?: boolean;
  undone?: boolean;
  titlePurchase?: boolean;
  createdAt: string;
};

export type OwnedTitle = { id: string; name: string; color: string; kind: string; equipped: boolean };

export type UserDetail = Paged & {
  channelId: string;
  channelName: string | null;
  isPublic: boolean;
  banned: boolean;
  createdAt: string;
  maxBalanceReached: number;
  balance: number;
  attendanceCount: number;
  log: LogEntry[];
  ownedTitles: OwnedTitle[];
};

export type Stats = { userCount: number; bannedCount: number; totalPoints: number; todaySpendCount: number; todayAttendanceCount: number };

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export const num = (n: number) => Number(n).toLocaleString("ko-KR");
