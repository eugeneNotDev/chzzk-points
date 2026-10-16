// Lucian UX/UI Prompt #092 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#092
// 게시판 검색 결과가 없을 때 — #092 "필터를 풀어 주는 빈 검색 결과".
// 돋보기가 빈 선반을 훑고, 검색 범위를 넓히면 몇 개가 나오는지 미리 세어 버튼으로 보여줌.
// (원본의 "필터 빼면 N개"를 게시판의 검색 범위(제목 → 제목+내용 → 작성자)에 맞춤)
import { useQuery } from "@tanstack/react-query";
import { fetchBoardPage, type BoardKind } from "../../lib/board";
import { josa as jo } from "../../lib/format";
import "./EmptySearch.css";

type Field = "title" | "all" | "author";
const FIELD_KO: Record<Field, string> = { title: "제목", all: "제목+내용", author: "작성자" };


export function EmptySearch({ board, q, field, onSearch, onClear }: { board: BoardKind; q: string; field: Field; onSearch: (q: string, f: Field) => void; onClear: () => void }) {
  // 지금 범위 말고 다른 범위로 찾으면 몇 개인지 미리 셈
  const others: Field[] = (["all", "title", ...(board === "review" ? (["author"] as Field[]) : [])] as Field[]).filter((f) => f !== field);
  const counts = useQuery({
    queryKey: ["board", "search-count", board, q, others.join(",")],
    queryFn: async () => {
      const rs = await Promise.all(
        others.map((f) => fetchBoardPage(board, 0, q, f).then((r) => [f, r.total] as const).catch(() => [f, 0] as const)),
      );
      return rs.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    },
    staleTime: 30_000,
  });
  const opts = counts.data ?? [];
  return (
    <div className="ux u092">
      <div className="u092-none">
        <div className="u092-art" aria-hidden="true">
          <svg viewBox="0 0 150 92">
            <path className="u092-shelf" d="M8 30h134M8 56h134M8 82h134" />
            <g className="u092-lens">
              <circle cx="34" cy="38" r="20" />
              <path className="gl" d="M24 30a12 12 0 0 1 8-5" />
              <path d="M48 52l14 14" />
            </g>
          </svg>
        </div>
        <p className="u092-nt">
          ‘{q}’{jo(q, "과", "와")} 맞는 글이 없어요
        </p>
        <p className="u092-ns">{opts.length ? "검색 범위를 바꾸면 결과가 나와요" : `${FIELD_KO[field]}에서 찾아봤어요. 검색어를 바꿔 보세요`}</p>
        <div className={`u092-sgs ${opts.length ? "" : "pop"}`}>
          {opts.map(([f, n], i) => (
            <button key={f} type="button" className="u092-sg" style={{ "--i": i } as React.CSSProperties} onClick={() => onSearch(q, f)} aria-label={`${FIELD_KO[f]}(으)로 찾으면 ${n}개`}>
              <s>{FIELD_KO[field]}</s>
              <span>
                {FIELD_KO[f]}(으)로 찾으면 <b>{n}개</b>
              </span>
              <svg viewBox="0 0 15 15" aria-hidden="true">
                <path d="M3 7.5h9M8.5 4l3.5 3.5L8.5 11" />
              </svg>
            </button>
          ))}
          <button type="button" className="u092-sg" style={{ "--i": opts.length } as React.CSSProperties} onClick={onClear}>
            검색 해제하고 전체 글 보기
          </button>
        </div>
      </div>
    </div>
  );
}
