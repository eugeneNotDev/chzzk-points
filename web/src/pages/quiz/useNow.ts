import { useEffect, useState } from "react";

// 1초(기본)마다 바뀌는 현재 시각 — 남은 시간 표시용
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
