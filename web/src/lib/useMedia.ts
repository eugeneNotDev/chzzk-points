// 화면 너비 조건(matchMedia)을 React 값으로 — 창 크기를 바꾸면 바로 다시 그려짐.
import { useSyncExternalStore } from "react";

const cache = new Map<string, MediaQueryList>();
function mq(query: string) {
  let m = cache.get(query);
  if (!m) {
    m = window.matchMedia(query);
    cache.set(query, m);
  }
  return m;
}

export function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = mq(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => mq(query).matches,
    () => false,
  );
}

/** 2단 배치가 켜지는 너비(components.css .split과 같은 값) */
export const SPLIT_QUERY = "(min-width: 1200px)";
