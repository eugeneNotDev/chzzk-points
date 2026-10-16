// Lucian UX/UI Prompt #212 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#212
// 상단바 스크롤 동작 — #212 "내리면 숨고 올리면 돌아오는 헤더".
// 맨 위에선 투명, 조금 내리면 흐림 배경 + 아래 가는 막대(읽은 만큼 차오름).
// 아래로 내리면 숨고(폰·태블릿만, CSS에서 제한) 6px 넘게 올리면 다시 내려옴. 맨 위 근처에선 항상 보임.
import { useEffect, useRef } from "react";

export function useScrollHeader() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const hd = ref.current;
    if (!hd) return;
    const pg = hd.querySelector<HTMLElement>("[data-progress]");
    let last = window.scrollY;
    let acc = 0;
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      const d = y - last;
      last = y;
      acc = d > 0 === acc > 0 ? acc + d : d;
      hd.classList.toggle("is-solid", y > 20);
      // 알림 창처럼 상단바에서 열린 게 있으면 숨기지 않음
      const busy = !!hd.querySelector('[aria-expanded="true"]');
      if (y < 60 || busy) hd.classList.remove("is-hide");
      else if (acc > 8) hd.classList.add("is-hide");
      else if (acc < -6) hd.classList.remove("is-hide");
      if (pg) {
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        pg.style.width = `${Math.min(100, (y / max) * 100).toFixed(1)}%`;
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return ref;
}
