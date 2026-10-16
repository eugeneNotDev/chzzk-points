// Lucian UX/UI Prompt #098 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#098
// 숫자 표시 — #098 "자리마다 굴러가는 실시간 지표"의 숫자 부분을 가져옴.
// 자리마다 0~9가 세로로 쌓인 기둥이라, 값이 바뀌면 달라진 자리만 위아래로 굴러감(자리마다 45ms씩 늦게).
// 자릿수·쉼표 모양이 바뀌면(9,999 → 10,000) 기둥을 새로 세우고 0부터 굴러 올라감. 처음 그릴 땐 바로 표시.
// 늘면 초록, 줄면 빨강으로 잠깐 반짝임. "동작 줄이기" 설정이면 굴림 없이 바로 바뀜(CSS).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fmt } from "../lib/format";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const shape = (s: string) => s.replace(/\d/g, "0");

export function AnimatedNumber({ value, className }: { value: number; duration?: number; className?: string }) {
  const str = fmt(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  // zero: 기둥을 새로 세운 직후 한 프레임 동안 모든 자리를 0에 두었다가 실제 숫자로 굴림
  const [zero, setZero] = useState(false);
  const prev = useRef(value);
  const prevShape = useRef(shape(str));
  const [gen, setGen] = useState(0);

  useLayoutEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    setFlash(value > from ? "up" : "down");
    const t = setTimeout(() => setFlash(null), 1300);
    if (shape(str) !== prevShape.current) {
      prevShape.current = shape(str);
      setGen((g) => g + 1);
      setZero(true);
    }
    return () => clearTimeout(t);
  }, [value, str]);

  useEffect(() => {
    if (!zero) return;
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setZero(false)));
    return () => cancelAnimationFrame(r);
  }, [zero]);

  let di = 0;
  return (
    <span
      key={gen}
      className={`odo ${flash === "up" ? "odo-up" : flash === "down" ? "odo-down" : ""} ${className ?? ""}`}
      role="img"
      aria-label={str}
    >
      {str.split("").map((ch, i) => {
        if (!/\d/.test(ch)) {
          return (
            <span key={i} className="odo-sym" aria-hidden="true">
              {ch}
            </span>
          );
        }
        di++;
        return (
          <span key={i} className="odo-col" aria-hidden="true" style={{ "--d": zero ? 0 : Number(ch), "--i": di } as React.CSSProperties}>
            {DIGITS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </span>
        );
      })}
    </span>
  );
}
