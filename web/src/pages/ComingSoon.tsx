import { Link } from "react-router-dom";
import { Hammer } from "lucide-react";
import type { NavItem } from "../nav";
import styles from "./ComingSoon.module.css";

// 아직 새로 만들지 않은 메뉴 — 베타 기간에만 보이는 화면.
export default function ComingSoon({ item }: { item?: NavItem }) {
  return (
    <div className={styles.wrap}>
      <span className={styles.icon}>
        <Hammer size={28} aria-hidden="true" />
      </span>
      <h2>{item ? `${item.label} 화면은 준비 중이에요` : "없는 페이지예요"}</h2>
      <p>{item ? "새 사이트로 옮기는 중이에요. 다 만들어지면 여기에 보여요." : "주소가 바뀌었거나 없는 페이지예요."}</p>
      <Link to="/" className={styles.btn}>
        홈으로
      </Link>
    </div>
  );
}
