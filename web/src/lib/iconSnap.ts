// 칭호 아이콘을 글자와 같은 픽셀 줄에 맞추기(랭킹 닉네임 옆 "🐺 알파").
// 크롬은 글자의 바닥선(baseline)을 화면 픽셀 경계로 반올림해서 그리는데, 아이콘(SVG)은 소수점 위치 그대로 그림.
// 그래서 줄이 화면의 어느 높이에 놓이느냐에 따라 아이콘만 0~1px 위/아래로 어긋나 보였음(배율마다, 줄마다 다름).
// → 실제 화면에서 각 칭호 글자의 바닥선 위치를 재서, 글자가 반올림되는 만큼 아이콘도 똑같이 옮김(--snap).
import { useEffect } from "react";

function snapAll(root: HTMLElement) {
  const dpr = window.devicePixelRatio || 1;
  const tags = Array.from(root.querySelectorAll<HTMLElement>(".tp-tag")).filter((t) => t.querySelector(".tp-icon"));
  if (!tags.length) return;
  // 바닥선 위치 = 글자 칸 안에 높이 0짜리 표시를 잠깐 넣고 그 위치를 읽음(한 번에 넣고 한 번에 읽어서 화면 계산은 1번)
  const probes = tags.map((t) => {
    const tx = t.querySelector<HTMLElement>(".tp-tx");
    if (!tx) return null;
    const p = document.createElement("span");
    p.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    tx.appendChild(p);
    return p;
  });
  const ys = probes.map((p) => (p ? p.getBoundingClientRect().top : null));
  probes.forEach((p) => p?.remove());
  tags.forEach((t, i) => {
    const y = ys[i];
    if (y == null) return;
    const d = Math.round(y * dpr) / dpr - y; // 글자가 반올림돼서 실제로 옮겨지는 양
    t.style.setProperty("--snap", `${d.toFixed(3)}px`);
  });
}

/** root 안의 칭호 아이콘을 글자와 같은 픽셀 줄에 맞춤. deps가 바뀌거나 크기·배율이 바뀌면 다시 계산. */
export function useIconSnap(root: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => root.current && snapAll(root.current));
    };
    run();
    // 줄 이동·등장 애니메이션이 끝난 뒤 위치로 한 번 더
    const late = window.setTimeout(run, 900);
    const ro = new ResizeObserver(run);
    ro.observe(el);
    window.addEventListener("resize", run);
    // 화면 배율(확대/축소)이 바뀌면 devicePixelRatio가 바뀜
    let mq: MediaQueryList | null = null;
    const watchDpr = () => {
      mq?.removeEventListener("change", onDpr);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener("change", onDpr);
    };
    const onDpr = () => {
      watchDpr();
      run();
    };
    watchDpr();
    document.fonts?.ready.then(run);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(late);
      ro.disconnect();
      window.removeEventListener("resize", run);
      mq?.removeEventListener("change", onDpr);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
