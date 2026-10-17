// 월계수 가지(왼쪽 기준, flip이면 좌우 반전) — 시상대 단상·랭킹 1~3위 숫자 옆에 씀. 색은 글자색(currentColor)을 따라감.
export function Laurel({ flip, className = "" }: { flip?: boolean; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 24" fill="currentColor" aria-hidden="true" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M13 23C7 19 5 12 8 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <ellipse cx="5.6" cy="6" rx="1.6" ry="3.2" transform="rotate(-25 5.6 6)" />
      <ellipse cx="10.6" cy="7.4" rx="1.5" ry="3" transform="rotate(30 10.6 7.4)" />
      <ellipse cx="4.6" cy="11.6" rx="1.6" ry="3.2" transform="rotate(-45 4.6 11.6)" />
      <ellipse cx="9.8" cy="13" rx="1.5" ry="3" transform="rotate(45 9.8 13)" />
      <ellipse cx="6" cy="17.2" rx="1.6" ry="3.1" transform="rotate(-65 6 17.2)" />
      <ellipse cx="11" cy="18.6" rx="1.4" ry="2.8" transform="rotate(60 11 18.6)" />
    </svg>
  );
}
