// Lucian UX/UI Prompt #098 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#098
// 숫자 표시 — #098 "자리마다 굴러가는 실시간 지표"의 숫자 부분을 가져옴.
// 평소엔 그냥 글자(주변 글씨와 폰트·높이·줄 맞춤이 똑같음). 값이 바뀌는 순간에만 자리마다 0~9 기둥으로 바꿔서
// 달라진 자리만 위아래로 굴리고(자리마다 45ms씩 늦게), 다 굴러가면 다시 그냥 글자로 돌아옴.
// 자릿수·쉼표 모양이 바뀌면(9,999 → 10,000) 0부터 굴러 올라감. 늘면 초록, 줄면 빨강으로 잠깐 반짝임.
// "동작 줄이기" 설정이면 굴림 없이 바로 바뀜.
// 굴리는 동안에도 원래 글자를 투명하게 그 자리에 두고(줄 높이·기준선·너비 그대로), 기둥은 그 위에 겹쳐서 굴림 —
// 예전엔 굴리는 동안만 칸 모양이 달라서 숫자가 내려가거나 눌린 듯 보였다가 끝나면 뚝 돌아왔음.
// 처음 화면에 나오고 잠깐(SETTLE_MS) 사이에 바뀐 값은 굴리지 않음 — 불러오면서 값이 채워지는 건 "변화"가 아니라서.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fmt } from "../lib/format";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const shape = (s: string) => s.replace(/\d/g, "0");
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const SETTLE_MS = 1500;

export function AnimatedNumber({ value, className }: { value: number; duration?: number; className?: string }) {
  const str = fmt(value);
  const prev = useRef(value);
  const mountedAt = useRef(Date.now());
  const textRef = useRef<HTMLSpanElement>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  // roll: 굴리는 중이면 시작 숫자열(from)과 지금 기둥이 가리키는 숫자열(at), 글자 칸 높이(h, px)
  const [roll, setRoll] = useState<{ from: string; at: string; h: number } | null>(null);

  useLayoutEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    if (Date.now() - mountedAt.current < SETTLE_MS) return; // 불러오는 중에 채워진 값
    setFlash(value > from ? "up" : "down");
    const tf = setTimeout(() => setFlash(null), 1300);
    if (reduced()) return () => clearTimeout(tf);
    const fromStr = fmt(from);
    // 모양이 같으면 이전 숫자에서, 다르면 모든 자리 0에서 출발
    const start = shape(fromStr) === shape(str) ? fromStr : shape(str);
    // 글자 한 줄이 차지하는 높이 — 기둥 한 칸을 정확히 이 높이로 맞춰서 기준선이 평소 글자와 같게.
    // getBoundingClientRect는 화면에 보이는 크기라 버튼을 누르는 순간(눌림 효과로 0.94배) 작게 재져서 숫자가 떠 보였음 →
    // 변형(transform)과 상관없는 실제 배치 높이(offsetHeight)로 잼.
    const h = textRef.current?.offsetHeight || 0;
    if (h > 0) setRoll({ from: start, at: start, h });
    return () => clearTimeout(tf);
  }, [value, str]);

  // 기둥을 출발 숫자로 한 번 그린 다음 프레임에 목표 숫자로 → 굴러감. 끝나면 그냥 글자로.
  useEffect(() => {
    if (!roll) return;
    if (roll.at !== str) {
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setRoll((x) => (x ? { ...x, at: str } : x))));
      return () => cancelAnimationFrame(r);
    }
    const digits = str.replace(/\D/g, "").length;
    const t = setTimeout(() => setRoll(null), 800 + digits * 45 + 80);
    return () => clearTimeout(t);
  }, [roll, str]);

  const cls = `odo ${flash === "up" ? "odo-up" : flash === "down" ? "odo-down" : ""} ${roll ? "odo-rolling" : ""} ${className ?? ""}`;
  let di = 0;
  return (
    <span className={cls} role={roll ? "img" : undefined} aria-label={roll ? str : undefined}>
      <span ref={textRef} className="odo-text" aria-hidden={roll ? true : undefined}>
        {str}
      </span>
      {roll && (
        <span className="odo-reel" aria-hidden="true" style={{ "--h": `${roll.h}px` } as React.CSSProperties}>
          {roll.at.split("").map((ch, i) => {
            if (!/\d/.test(ch)) {
              return (
                <span key={i} className="odo-sym">
                  {ch}
                </span>
              );
            }
            di++;
            return (
              <span key={i} className="odo-col" style={{ "--d": Number(ch), "--i": di } as React.CSSProperties}>
                {DIGITS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            );
          })}
        </span>
      )}
    </span>
  );
}
