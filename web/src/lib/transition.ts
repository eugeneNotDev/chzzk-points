// 화면 전환 애니메이션 — 브라우저의 View Transitions 기능으로 이전 화면이 스르륵 사라지고 새 화면이 떠오르게.
// 지원 안 하는 브라우저(일부 사파리·파이어폭스)는 그냥 바로 바뀌고, 대신 새 화면 페이드(.pageFade)만 보임.
// "동작 줄이기" 설정이면 애니메이션 없이.
import { useEffect } from "react";
import { flushSync } from "react-dom";
import { useNavigate, type NavigateOptions, type To } from "react-router-dom";

type VTDocument = Document & { startViewTransition?: (cb: () => void | Promise<void>) => unknown };

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function withTransition(update: () => void) {
  const d = document as VTDocument;
  if (!d.startViewTransition || reduced()) {
    update();
    return;
  }
  // 전환 중엔 대신 쓰는 페이드(.pageFade)를 꺼서 두 번 겹치지 않게(뒤로가기처럼 전환 없이 바뀔 땐 페이드가 보임)
  const root = document.documentElement;
  root.dataset.vt = "1";
  const t = d.startViewTransition(() => {
    flushSync(update);
  }) as { finished?: Promise<unknown> } | undefined;
  const done = () => delete root.dataset.vt;
  if (t?.finished) t.finished.then(done, done);
  else setTimeout(done, 600);
}

// navigate() 대신 쓰는 것 — 버튼으로 화면을 옮길 때(페이지 번호, 목록으로 등)
export function useTNavigate() {
  const nav = useNavigate();
  return (to: To | number, opts?: NavigateOptions) =>
    withTransition(() => {
      if (typeof to === "number") nav(to);
      else nav(to, opts);
    });
}

// 사이트 안의 모든 링크(<Link>, <NavLink>) 클릭을 가로채서 전환 애니메이션과 함께 이동.
// 새 탭(Ctrl/⌘·가운데 클릭), 다운로드, 바깥 사이트 링크는 그대로 둠.
export function useLinkTransitions() {
  const nav = useNavigate();
  useEffect(() => {
    const d = document as VTDocument;
    if (!d.startViewTransition) return;
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (base && !url.pathname.startsWith(base + "/") && url.pathname !== base) return;
      const to = url.pathname.slice(base.length) + url.search + url.hash;
      const here = location.pathname.slice(base.length) + location.search + location.hash;
      // 기본 이동만 막음(Link는 defaultPrevented면 스스로 이동 안 함) — 링크에 붙은 다른 onClick(창 닫기 등)은 그대로 실행
      e.preventDefault();
      if (to === here) return;
      withTransition(() => nav(to || "/"));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [nav]);
}
