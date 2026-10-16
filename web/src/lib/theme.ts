import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { STORAGE } from "./config";
import { writeStorage } from "./storage";

export type Theme = "dark" | "light";

const listeners = new Set<() => void>();
const current = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  writeStorage(STORAGE.theme, theme);
  listeners.forEach((l) => l());
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    current,
  );
  return { theme, toggle: (e?: { clientX: number; clientY: number; currentTarget: EventTarget | null }) => switchTheme(theme === "dark" ? "light" : "dark", e) };
}

type VTDoc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> } };

// 테마 바꾸기 — 누른 자리에서 새 테마가 원으로 번져 나감(브라우저 View Transitions).
// 지원 안 하는 브라우저·"동작 줄이기" 설정이면 그냥 바로 바뀜.
function switchTheme(next: Theme, e?: { clientX: number; clientY: number; currentTarget: EventTarget | null }) {
  const d = document as VTDoc;
  if (!d.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setTheme(next);
    return;
  }
  // 누른 위치(키보드로 눌렀으면 버튼 가운데)
  let x = e?.clientX ?? window.innerWidth - 40;
  let y = e?.clientY ?? 40;
  const el = e?.currentTarget as HTMLElement | null;
  if (el && (!e?.clientX && !e?.clientY)) {
    const r = el.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const root = document.documentElement;
  root.classList.add("theme-switching"); // 색 전환 애니메이션은 잠깐 꺼서 원 안쪽이 한 번에 새 색으로 보이게
  const t = d.startViewTransition(() => flushSync(() => setTheme(next)));
  t.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: "cubic-bezier(0.4, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => undefined);
  t.finished.finally(() => root.classList.remove("theme-switching"));
}
