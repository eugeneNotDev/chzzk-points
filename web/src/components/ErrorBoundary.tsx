// 화면 그리다 오류가 나면 하얀 화면 대신 안내 카드 + 새로고침 버튼.
// AppLayout의 <Outlet /> 둘레에 씌움 — 상단바·메뉴는 그대로 살아 있어서 다른 메뉴로 옮겨갈 수도 있음.
// 주소가 바뀌면(resetKey) 오류 상태를 풀어서 다른 화면은 정상으로 뜨게.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Card } from "./Card";

type Props = { resetKey?: string; children: ReactNode };
type State = { error: Error | null; key?: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[화면 오류]", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <Card title="화면을 불러오지 못했어요">
          <p style={{ margin: "0 0 16px", color: "var(--c-text-2)", lineHeight: 1.6 }}>
            잠깐 문제가 생겼어요. 새로고침하면 대부분 바로 해결돼요.
            <br />
            계속 이러면 스트리머에게 알려 주세요.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
            <RotateCw size={16} aria-hidden="true" />
            새로고침
          </button>
        </Card>
      </div>
    );
  }
}

// 새로 배포하면 예전 화면 조각(lazy chunk) 파일이 사라져서, 열어둔 탭에서 메뉴를 옮길 때 불러오기가 실패함.
// 그때는 한 번만 새로고침해서 새 버전을 받게 — 계속 실패해도 무한 새로고침은 안 되게 sessionStorage로 막음.
const RELOAD_FLAG = "chzzk_points_chunk_reload";
export function setupChunkReload() {
  window.addEventListener("vite:preloadError", (e) => {
    let done = false;
    try {
      done = sessionStorage.getItem(RELOAD_FLAG) === "1";
      if (!done) sessionStorage.setItem(RELOAD_FLAG, "1");
    } catch {
      done = true; // 저장이 막혀 있으면 새로고침 반복을 막을 길이 없으니 안 함(ErrorBoundary가 안내)
    }
    if (done) return;
    e.preventDefault();
    location.reload();
  });
  // 정상으로 뜬 뒤엔 표시를 지워서, 다음 배포 때도 한 번은 자동 새로고침되게
  window.setTimeout(() => {
    try {
      sessionStorage.removeItem(RELOAD_FLAG);
    } catch {
      /* 무시 */
    }
  }, 10_000);
}
