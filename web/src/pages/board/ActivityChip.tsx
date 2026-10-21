// 게시판 위 "오늘 활동 보상" 칩 — 글·댓글 남은 보상 개수. 누르면 규칙 안내.
// 서버 함수가 아직 예전 버전이면(이 기능이 없으면) 아무것도 안 그림.
import { Gift } from "lucide-react";
import { useBoardActivity } from "../../lib/board";
import { alertDialog } from "../../lib/dialog";
import styles from "./Board.module.css";

export function ActivityChip() {
  const q = useBoardActivity();
  const d = q.data;
  if (!d) return null;
  const done = d.post.used >= d.post.max && d.comment.used >= d.comment.max;
  const rules = [
    `하루에 글 ${d.post.max}개(개당 ${d.post.amount}P), 댓글 ${d.comment.max}개(개당 ${d.comment.amount}P)까지 쓸 때마다 포인트를 받아요.`,
    `자유게시판 글·댓글만 보상받아요. 방송 후기는 후기 보상(방송 후 글 1개)만 따로 있어요.`,
    `글은 본문 ${d.post.minLen}자, 댓글은 ${d.comment.minLen}자 이상이어야 해요. 같은 글자만 반복하면 보상이 없어요.`,
    `같은 글에 단 댓글은 ${d.comment.perPost}개까지, 내 글에 단 내 댓글은 보상이 없어요.`,
    `보상받은 글·댓글을 지우면 언제 지우든 포인트가 회수돼요. 신고가 쌓여 가려져도 회수돼요.`,
    `매일 밤 12시(한국 시간)에 다시 채워져요.`,
  ];
  return (
    <button type="button" className={`${styles.actChip} ${done ? styles.actDone : ""}`} onClick={() => alertDialog(rules.map((r) => `· ${r}`).join("\n"), { title: "게시판 활동 보상" })}>
      <Gift size={15} aria-hidden="true" />
      <span>오늘 활동 보상</span>
      <span className={styles.actPart}>
        글 <b className="num">{Math.min(d.post.used, d.post.max)}</b>/{d.post.max}
      </span>
      <span className={styles.actPart}>
        댓글 <b className="num">{Math.min(d.comment.used, d.comment.max)}</b>/{d.comment.max}
      </span>
    </button>
  );
}
