// Lucian UX/UI Prompt #093 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#093
// 축하 색종이 — #093 "할 일을 다 끝내면 터지는 축하"의 색종이 부분.
// 기준 요소 근처에서 위로 부채꼴로 90장이 터진 뒤 중력으로 떨어지고, 다 떨어지면 그림판을 치움.
// 원본은 요소 안의 그림판이지만, 여기선 화면 전체에 잠깐 그림판을 깔고 기준 요소 가운데에서 터뜨림.
// 출석 보너스(10번째·100번째), 황금 상자 같은 순간에 씀. "동작 줄이기" 설정이면 안 터짐.
const COLORS = ["#22C3A6", "#10B981", "#FFB547", "#FF6B8B", "#7B61FF", "#3D8BFF"];

export function fireConfetti(from?: Element | null, colors: string[] = COLORS) {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = document.createElement("canvas");
  cv.setAttribute("aria-hidden", "true");
  Object.assign(cv.style, { position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "200" });
  cv.width = W * dpr;
  cv.height = H * dpr;
  document.body.appendChild(cv);
  const c = cv.getContext("2d");
  if (!c) return cv.remove();
  const r = from?.getBoundingClientRect();
  const ox = r ? r.left + r.width / 2 : W / 2;
  const oy = r ? r.top + r.height / 2 : H / 3;
  const ps = Array.from({ length: 90 }, (_, i) => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
    const v = 380 + Math.random() * 420;
    return { x: ox + (Math.random() - 0.5) * 40, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6, vr: (Math.random() - 0.5) * 14, w: 5 + Math.random() * 5, h: 8 + Math.random() * 6, col: colors[i % colors.length], t: 0, life: 1.6 + Math.random() * 0.9 };
  });
  let last = performance.now();
  const f = (now: number) => {
    const dt = Math.min(0.033, (now - last) / 1000);
    let alive = 0;
    last = now;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    ps.forEach((p) => {
      p.t += dt;
      if (p.t > p.life || p.y > H + 20) return;
      alive++;
      p.vy += 900 * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.r);
      c.globalAlpha = Math.min(1, (p.life - p.t) / 0.4);
      c.scale(1, Math.cos(p.t * 9 + p.w));
      c.fillStyle = p.col;
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c.restore();
    });
    if (alive) requestAnimationFrame(f);
    else cv.remove();
  };
  requestAnimationFrame(f);
}
