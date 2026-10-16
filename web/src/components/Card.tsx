import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import styles from "./Card.module.css";

// 공통 카드 — 제목 줄(제목 + 오른쪽 "전체 보기" 등) + 내용. 사이트 모든 카드가 이걸 써서 모양이 통일됨.
export function Card({
  title,
  moreTo,
  moreLabel = "전체 보기",
  extra,
  children,
  className = "",
  flush = false,
  tone,
}: {
  title?: ReactNode;
  moreTo?: string;
  moreLabel?: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean; // 목록 카드처럼 안쪽 여백을 줄일 때
  /** feature: 그 화면의 주인공 카드(은은한 초록 빛·진한 테두리) / quiet: 안내 같은 보조 카드(배경 없이 테두리만) */
  tone?: "feature" | "quiet";
}) {
  return (
    <section className={`${styles.card} ${flush ? styles.flush : ""} ${tone ? styles[tone] : ""} ${className}`}>
      {(title || moreTo || extra) && (
        <div className={styles.head}>
          {title && <h2 className={styles.title}>{title}</h2>}
          {extra}
          {moreTo && (
            <Link to={moreTo} className={styles.more}>
              {moreLabel}
              <ChevronRight size={14} aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}
