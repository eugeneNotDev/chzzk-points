// 게시판(자유게시판 board-free.html / 방송 후기 board-review.html) — 주소로 화면이 바뀜.
//   ?page=N 목록 · ?post=ID 글 보기 · ?post=ID&edit=1 수정 · ?write=1 글쓰기
// 브라우저 뒤로가기가 자연스럽게 목록 ↔ 글로 오가게 주소(history)를 씀.
import { useSearchParams } from "react-router-dom";
import type { BoardKind } from "../../lib/board";
import { BoardList } from "./BoardList";
import { PostView } from "./PostView";
import { PostEditor } from "./PostEditor";

export function BoardPage({ board }: { board: BoardKind }) {
  const [params] = useSearchParams();
  const postId = Number(params.get("post"));
  if (params.get("write") === "1") return <PostEditor board={board} />;
  if (Number.isSafeInteger(postId) && postId > 0) {
    if (params.get("edit") === "1") return <PostEditor board={board} editId={postId} />;
    return <PostView board={board} id={postId} />;
  }
  return <BoardList board={board} page={Math.max(0, (Number(params.get("page")) || 1) - 1)} />;
}

export function FreeBoard() {
  return <BoardPage board="free" />;
}
export function ReviewBoard() {
  return <BoardPage board="review" />;
}
