// 글 화면을 목록을 거치지 않고 바로 열었을 때(홈 미리보기·알림·주소로 들어옴) 브라우저 뒤로가기가
// 목록이 아니라 홈 등으로 가버리는 문제 → 처음 열릴 때 방문 기록을 [목록, 글]로 바꿔 둠.
// 그러면 마우스 뒤로가기·브라우저 뒤로가기·"← 목록" 모두 목록으로 감(목록에서 한 번 더 뒤로 가면 원래 있던 곳).
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export type ListState = { fromList?: boolean } | null;

export function useListUnderneath(listPath: string, enabled = true) {
  const nav = useNavigate();
  const loc = useLocation();
  const fromList = !!(loc.state as ListState)?.fromList;
  const done = useRef(false);
  useEffect(() => {
    if (!enabled || fromList || done.current) return;
    done.current = true;
    const here = loc.pathname + loc.search + loc.hash;
    nav(listPath, { replace: true });
    nav(here, { state: { fromList: true } });
    // 처음 열릴 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return fromList;
}
