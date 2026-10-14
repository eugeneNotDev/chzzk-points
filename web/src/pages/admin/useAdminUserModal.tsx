// 관리자: 유저 상세 팝업(내역·칭호·미니게임 차단). 관리자 화면 작업 때 채울 자리.
// 지금은 비어 있어서 랭킹에서 이름을 눌러도 아무 일도 안 일어남.
import type { ReactNode } from "react";

export function useAdminUserModal(): { open?: (channelId: string) => void; element: ReactNode } {
  return { open: undefined, element: null };
}
