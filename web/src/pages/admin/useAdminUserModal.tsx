// 관리자: 유저 상세 팝업(포인트 내역 · 칭호 관리 · 미니게임 차단) — 관리자 화면(유저 목록)과 랭킹(이름 클릭)이 같이 씀.
// const m = useAdminUserModal(onChanged); m.open(channelId); 화면 어딘가에 {m.element}.
import { useCallback, useState, type ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { UserDetailModal } from "./UserDetailModal";

export function useAdminUserModal(onChanged?: () => void): { open?: (channelId: string) => void; element: ReactNode } {
  const { isAdmin } = useAuth();
  const [channelId, setChannelId] = useState<string | null>(null);
  const open = useCallback((id: string) => setChannelId(id), []);
  if (!isAdmin) return { open: undefined, element: null };
  return {
    open,
    element: <UserDetailModal channelId={channelId} onClose={() => setChannelId(null)} onChanged={onChanged} />,
  };
}
