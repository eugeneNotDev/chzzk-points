// 숫자가 바뀌면 이전 값에서 새 값까지 부드럽게 굴러감(포인트 잔액 등). 처음 그릴 땐 바로 표시.
// 늘면 초록, 줄면 빨강으로 잠깐 반짝임. "동작 줄이기" 설정이면 애니메이션 없이 바로 바뀜.
import { useEffect, useRef, useState } from "react";
import { fmt } from "../lib/format";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function AnimatedNumber({ value, duration = 700, className }: { value: number; duration?: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef(value);
  const raf = useRef(0);

  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    setFlash(value > from ? "up" : "down");
    const t = setTimeout(() => setFlash(null), duration + 400);
    if (reduced()) {
      setShown(value);
      return () => clearTimeout(t);
    }
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf.current);
    };
  }, [value, duration]);

  return (
    <span
      className={className}
      style={{
        transition: "color 0.4s",
        color: flash === "up" ? "var(--c-accent)" : flash === "down" ? "var(--c-red-text)" : undefined,
      }}
    >
      {fmt(shown)}
    </span>
  );
}
