// 페이지 번호 — 처음·끝 + 지금 페이지 앞뒤 2개, 사이는 "…".
export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  const set = new Set([1, totalPages]);
  for (let p = page - 2; p <= page + 2; p++) if (p >= 1 && p <= totalPages) set.add(p);
  const pages = [...set].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) out.push("gap");
    out.push(p);
  });
  return (
    <nav className="pagination" aria-label="페이지">
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        이전
      </button>
      {out.map((p, i) =>
        p === "gap" ? (
          <span key={`g${i}`} className="ellipsis">
            …
          </span>
        ) : (
          <button key={p} type="button" aria-current={p === page ? "page" : undefined} onClick={() => onChange(p)}>
            {p}
          </button>
        ),
      )}
      <button type="button" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        다음
      </button>
    </nav>
  );
}
