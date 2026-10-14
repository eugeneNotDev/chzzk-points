// 홈 화면 앱엔 브라우저 새로고침 버튼이 없어서 — 맨 위에서 아래로 당기면 새로고침.
// 브라우저에서 열었을 땐 브라우저 기본 동작을 쓰므로 안 붙임. 팝업·입력칸 안에서 당길 땐 무시.
import { isStandalone } from "./pwa";

export function setupPullToRefresh() {
  if (!isStandalone() || !("ontouchstart" in window)) return;
  const THRESHOLD = 64;
  const MAX = 96;
  const ind = document.createElement("div");
  ind.className = "ptr";
  ind.setAttribute("aria-hidden", "true");
  ind.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>`;
  document.body.appendChild(ind);
  let startY: number | null = null;
  let dist = 0;
  const blocked = (t: EventTarget | null) =>
    document.querySelector("dialog[open]") || (t instanceof Element && t.closest("dialog, [role=dialog], textarea, input, select, [contenteditable='true']"));
  const render = () => {
    const p = Math.min(1, dist / THRESHOLD);
    ind.style.opacity = String(p);
    ind.style.transform = `translate(-50%, ${dist * 0.75}px) rotate(${dist * 4}deg) scale(${0.6 + 0.4 * p})`;
    ind.classList.toggle("ready", dist >= THRESHOLD);
  };
  const reset = () => {
    dist = 0;
    ind.classList.add("back");
    render();
    setTimeout(() => ind.classList.remove("back"), 220);
  };
  window.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || window.scrollY > 0 || blocked(e.target)) {
      startY = null;
      return;
    }
    startY = e.touches[0].clientY;
    dist = 0;
  }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) {
      if (dist) reset();
      return;
    }
    dist = Math.min(MAX, dy * 0.5);
    render();
  }, { passive: true });
  window.addEventListener("touchend", () => {
    if (startY === null) return;
    startY = null;
    if (dist >= THRESHOLD) location.reload();
    else if (dist) reset();
  }, { passive: true });
}
