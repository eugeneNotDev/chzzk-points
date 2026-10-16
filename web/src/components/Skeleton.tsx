// 불러오는 동안 실제 목록·글 모양의 회색 자리표시.
//   <SkeletonList rows={6} />            제목 + 한 줄 (게시판·공지 목록)
//   <SkeletonList rows={8} variant="rank" />  순위 · 이름 · 숫자
//   <SkeletonPost />                     글 보기
import { useLayoutEffect, useRef, type CSSProperties } from "react";

// 묶음 안 뼈대들이 같은 빛줄기를 쓰게 — 뼈대마다 묶음 왼쪽에서 떨어진 만큼 빛 시작점을 당김(Lucian #079 align)
export function useSkelAlign<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const align = () => {
      const r = root.getBoundingClientRect();
      root.style.setProperty("--gw", `${Math.round(r.width) + 100}px`);
      root.querySelectorAll<HTMLElement>(".skeleton").forEach((s) => {
        s.style.setProperty("--sx", `${-Math.round(s.getBoundingClientRect().left - r.left)}px`);
      });
    };
    align();
    const ro = new ResizeObserver(align);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);
  return ref;
}

// 뼈대가 보였다가 내용이 들어온 그 순간에만 "피어나는" 효과(.bloom)를 줌 —
// 이미 받아둔 내용으로 바로 그려질 땐 효과 없이(다른 화면 갔다 와도 붕 뜨지 않게).
export function useBloom(loading: boolean) {
  const wasLoading = useRef(loading);
  if (loading) wasLoading.current = true;
  return !loading && wasLoading.current ? "bloom" : "";
}

const line = (style: CSSProperties) => <span className="skeleton" style={style} />;

export function SkeletonList({ rows = 5, variant = "list" }: { rows?: number; variant?: "list" | "rank" | "row" }) {
  const ref = useSkelAlign<HTMLDivElement>();
  return (
    <div ref={ref} aria-busy="true" aria-label="불러오는 중" style={{ display: "flex", flexDirection: "column", padding: "6px 18px" }}>
      {Array.from({ length: rows }, (_, i) => {
        // 줄마다 길이를 조금씩 달리해서 진짜 목록처럼 보이게
        const w = [72, 58, 84, 64, 76, 52, 68, 80][i % 8];
        if (variant === "rank")
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0" }}>
              {line({ width: 22, height: 18 })}
              {line({ width: `${w * 0.5}%`, height: 16 })}
              {line({ width: 64, height: 16, marginLeft: "auto" })}
            </div>
          );
        if (variant === "row")
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 0" }}>
              {line({ width: `${w * 0.7}%`, height: 16 })}
              {line({ width: 70, height: 14, marginLeft: "auto" })}
            </div>
          );
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "14px 0", borderTop: i ? "1px solid var(--c-border)" : undefined }}>
            {line({ width: `${w * 0.6}%`, height: 17 })}
            {line({ width: `${w}%`, height: 13 })}
            {line({ width: 120, height: 12 })}
          </div>
        );
      })}
    </div>
  );
}

export function SkeletonPost() {
  const ref = useSkelAlign<HTMLDivElement>();
  return (
    <div ref={ref} aria-busy="true" aria-label="불러오는 중" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {line({ width: 140, height: 13 })}
      {line({ width: "55%", height: 24 })}
      {line({ width: "92%", height: 15 })}
      {line({ width: "80%", height: 15 })}
      {line({ width: "64%", height: 15 })}
    </div>
  );
}

// 글줄 안에 들어가는 작은 뼈대 — 숫자·이름 자리(보유 포인트, 누적 출석 등)
export function SkelInline({ w = 64, h = "0.9em", r }: { w?: number | string; h?: number | string; r?: number }) {
  return (
    <span
      className="skeleton"
      aria-label="불러오는 중"
      style={{ display: "inline-block", width: w, height: h, borderRadius: r ?? 6, verticalAlign: "middle" }}
    />
  );
}

// 낱개 뼈대 여러 개를 한 묶음으로(예: 상점 카드 3장) — 빛이 묶음 전체를 한 번에 훑음
export function SkelGroup({ className, style, children }: { className?: string; style?: CSSProperties; children: React.ReactNode }) {
  const ref = useSkelAlign<HTMLDivElement>();
  return (
    <div ref={ref} className={className} style={style} aria-busy="true">
      {children}
    </div>
  );
}
