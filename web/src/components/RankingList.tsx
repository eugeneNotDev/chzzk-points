// 랭킹 목록 — 랭킹 화면과 홈 미리보기가 같이 씀.
// 이름 칸 = [비공개 표시(관리자 화면만)] 닉네임 · 🐺 칭호, 특수 칭호는 닉네임 바로 위 작은 글씨.
// 장착 칭호가 있으면 줄 전체가 칭호 색·테두리 플레이트가 됨(components/TitlePlate, styles/title-plate.css).
// 비공개 유저는 이름이 이미 "비공개"로 가려져서 내려옴(본인도 똑같이 — 설정이 잘 됐는지 보이게).
//
// 순위가 바뀌면(Lucian UX/UI Prompt #317 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#317)
// 줄들이 한꺼번에 바뀌지 않고 각자 새 자리로 미끄러져 감(0.6s). 올라간 줄은 살짝 떠서 앞으로, 내려간 줄은 뒤로 —
// 겹쳐도 헷갈리지 않게. 순위 옆에 ▲2 / ▼1 표시가 잠깐(1.3s) 뜸. 원본은 줄 높이가 같아서 자리를 직접 정하는데,
// 여기선 칭호 때문에 줄 높이가 달라서 이전 위치 → 새 위치 차이만큼 되돌렸다가 풀어 주는 방식(FLIP).
import { useLayoutEffect, useRef } from "react";
import { fmt } from "../lib/format";
import { useAuth } from "../lib/auth";
import { isMyRankingRow, type RankingRow } from "../lib/homeData";
import { SpecialTitleLine } from "./TitleBadge";
import { Laurel } from "./Laurel";
import { PlateStars, TitleTag, useTitlePlate } from "./TitlePlate";
import styles from "./RankingList.module.css";
import { useIconSnap } from "../lib/iconSnap";

const RANK_COLORS = ["var(--c-gold)", "var(--c-silver)", "var(--c-bronze)"];
const keyOf = (r: RankingRow, i: number) => r.channel_id || `#${i}`;

export function RankingList({
  rows,
  onAdminClick,
  start = 0,
  className = "",
  hideRank = false,
}: {
  rows: RankingRow[];
  onAdminClick?: (channelId: string) => void;
  start?: number;
  className?: string;
  /** 순위 숫자 대신 "–"(칭호 미리보기처럼 순위가 의미 없을 때) */
  hideRank?: boolean;
}) {
  const { channelId } = useAuth();
  const list = useRef<HTMLOListElement>(null);
  const prevTop = useRef(new Map<string, number>());
  const prevIdx = useRef(new Map<string, number>());
  // 칭호 아이콘을 글자와 같은 픽셀 줄에 맞춤(lib/iconSnap.ts)
  useIconSnap(list, [rows]);

  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lis = Array.from(el.children) as HTMLLIElement[];
    const tops = new Map<string, number>();
    const idx = new Map<string, number>();
    const timers: number[] = [];
    lis.forEach((li, i) => {
      const k = li.dataset.k!;
      tops.set(k, li.offsetTop);
      idx.set(k, i);
      const was = prevIdx.current.get(k);
      const top = prevTop.current.get(k);
      if (rm || was == null || top == null || was === i) return;
      const d = was - i; // +면 올라감
      li.classList.add(d > 0 ? styles.up : styles.dn);
      const em = li.querySelector<HTMLElement>(`.${styles.move}`);
      if (em) {
        em.textContent = d > 0 ? `▲${d}` : `▼${-d}`;
        em.classList.add(styles.moveOn, d > 0 ? styles.moveUp : styles.moveDn);
      }
      li.style.transition = "none";
      li.style.transform = `translateY(${top - li.offsetTop}px)`;
      void li.offsetHeight;
      li.style.transition = "";
      li.style.transform = "";
      timers.push(
        window.setTimeout(() => {
          li.classList.remove(styles.up, styles.dn);
          em?.classList.remove(styles.moveOn, styles.moveUp, styles.moveDn);
        }, 1300),
      );
    });
    prevTop.current = tops;
    prevIdx.current = idx;
    return () => timers.forEach(clearTimeout);
  }, [rows]);

  return (
    <ol ref={list} className={`${styles.list} ${className}`}>
      {rows.map((r, j) => (
        <Row key={keyOf(r, j + start)} k={keyOf(r, j + start)} r={r} i={j + start} me={isMyRankingRow(r, channelId)} onAdminClick={onAdminClick} hideRank={hideRank} />
      ))}
    </ol>
  );
}

function Row({ k, r, i, me, onAdminClick, hideRank }: { k: string; r: RankingRow; i: number; me: boolean; onAdminClick?: (channelId: string) => void; hideRank?: boolean }) {
  const plate = useTitlePlate(r.shop_title_name ? r.shop_title_color : null);
  const isPrivate = r.is_public === false;
  const clickable = !!(onAdminClick && r.admin_view && r.channel_id);
  const nameInner = (
    <span className={styles.nameLine}>
      {r.admin_view && isPrivate && <span className={styles.privateTag}>비공개</span>}
      <span className={styles.nameCol}>
        {!isPrivate && <SpecialTitleLine list={r.special_titles} />}
        <span className={styles.nameRow}>
          <span className={`${styles.nameText} ${isPrivate && !r.admin_view ? styles.muted : ""}`}>
            {r.channel_name || "(이름 없음)"}
            {me && " (나)"}
          </span>
          {plate && r.shop_title_name && <TitleTag name={r.shop_title_name} plate={plate} />}
        </span>
      </span>
    </span>
  );
  return (
    <li
      data-k={k}
      className={`${styles.row} ${me ? styles.me : ""} ${i < 3 ? styles.top : ""} ${plate ? `${plate.className} ${styles.plated}` : ""}`}
      style={plate?.style}
    >
      {plate?.star && <PlateStars />}
      <span className={`${styles.no} num`} style={{ color: hideRank ? "var(--c-text-4)" : (RANK_COLORS[i] ?? "var(--c-text-4)") }}>
        {!hideRank && i < 3 && <Laurel className={styles.laurelL} />}
        {hideRank ? "–" : i + 1}
        {!hideRank && i < 3 && <Laurel flip className={styles.laurelR} />}
        <em className={styles.move} aria-hidden="true" />
      </span>
      {clickable ? (
        <button type="button" className={`${styles.name} ${styles.nameBtn}`} onClick={() => onAdminClick!(r.channel_id)} title="유저 상세 보기">
          {nameInner}
        </button>
      ) : (
        <span className={styles.name}>{nameInner}</span>
      )}
      <span className={`${styles.points} num`}>{fmt(r.total_points)}P</span>
    </li>
  );
}
