// 공지 글쓰기/수정 (관리자) — 기존 사이트 notice.html의 글쓰기 창을 그대로 옮김.
//  - HTML 모드: 버튼으로 제목·콜아웃·토글·색 글자 등을 넣어 노션처럼 꾸밈 + 미리보기
//  - 첨부: 사진(본문에 크게, 자동 압축) / 파일(다운로드 전용) 따로, 합쳐서 최대 10개
import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, ImagePlus, Paperclip, Plus, X } from "lucide-react";
import { Modal } from "../../components/ui";
import { NoticeBody } from "../../components/NoticeContent";
import {
  extOf,
  formatFileSize,
  MAX_NOTICE_ATTACHMENTS,
  NOTICE_FILE_PICKER_EXT,
  NOTICE_IMAGE_EXT,
  noticeAttachmentUrl,
  saveNotice,
  toApiAttachment,
  uploadNoticeFiles,
  type Notice,
  type NoticeAttachment,
} from "../../lib/notices";
import styles from "./Notice.module.css";

type Pending = { file: File; kind: "image" | "file"; url: string };

const SNIPPETS: Record<string, { wrap?: [string, string]; block?: string; placeholder?: string; label: string }> = {
  h1: { wrap: ["<h1>", "</h1>"], placeholder: "큰 제목", label: "제목1" },
  h2: { wrap: ["<h2>", "</h2>"], placeholder: "중간 제목", label: "제목2" },
  h3: { wrap: ["<h3>", "</h3>"], placeholder: "작은 제목", label: "제목3" },
  b: { wrap: ["<b>", "</b>"], placeholder: "굵은 글자", label: "굵게" },
  u: { wrap: ["<u>", "</u>"], placeholder: "밑줄 글자", label: "밑줄" },
  s: { wrap: ["<s>", "</s>"], placeholder: "취소선 글자", label: "취소선" },
  callout: { block: '<div class="callout">\n  <span class="callout-icon">💡</span>\n  <div>□</div>\n</div>', placeholder: "강조하고 싶은 내용", label: "콜아웃" },
  toggle: { block: "<details>\n  <summary>□</summary>\n  <p>펼치면 보이는 내용</p>\n</details>", placeholder: "토글 제목", label: "토글" },
  quote: { wrap: ["<blockquote>", "</blockquote>"], placeholder: "인용할 내용", label: "인용" },
  hr: { block: "<hr>", label: "구분선" },
  ul: { block: "<ul>\n  <li>□</li>\n  <li>항목</li>\n</ul>", placeholder: "항목", label: "목록" },
  ol: { block: "<ol>\n  <li>□</li>\n  <li>항목</li>\n</ol>", placeholder: "항목", label: "번호 목록" },
  todo: { block: '<ul class="todo">\n  <li class="done">□</li>\n  <li>할 일</li>\n</ul>', placeholder: "완료한 일", label: "체크리스트" },
  columns: { block: '<div class="columns">\n  <div>□</div>\n  <div>오른쪽 내용</div>\n</div>', placeholder: "왼쪽 내용", label: "2단" },
  table: { block: "<table>\n  <tr><th>□</th><th>제목</th></tr>\n  <tr><td>내용</td><td>내용</td></tr>\n</table>", placeholder: "제목", label: "표" },
  link: { wrap: ['<a href="https://">', "</a>"], placeholder: "링크 글자", label: "링크" },
};
const TEXT_COLORS = [
  ["c-gray", "회색"], ["c-red", "빨강"], ["c-orange", "주황"], ["c-yellow", "노랑"], ["c-green", "초록"],
  ["c-blue", "파랑"], ["c-purple", "보라"], ["c-pink", "분홍"], ["c-accent", "민트"],
];
const BG_COLORS = [
  ["bg-gray", "회색"], ["bg-red", "빨강"], ["bg-orange", "주황"], ["bg-yellow", "노랑"],
  ["bg-green", "초록"], ["bg-blue", "파랑"], ["bg-purple", "보라"], ["bg-pink", "분홍"],
];

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// 일반 글을 HTML 모드로 바꿀 때 — 태그가 없는 글이면 줄바꿈이 유지되게 문단/줄바꿈 태그로 바꿔줌.
function plainTextToHtml(text: string) {
  if (/<[a-z][^>]*>/i.test(text)) return text;
  return text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => `<p>${escapeHtml(b).replace(/\n/g, "<br>\n")}</p>`)
    .join("\n\n");
}

export function NoticeEditor({
  open,
  notice,
  onClose,
  onSaved,
}: {
  open: boolean;
  notice: Notice | null; // null이면 새 글
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isHtml, setIsHtml] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [kept, setKept] = useState<NoticeAttachment[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(notice?.title ?? "");
    setContent(notice?.content ?? "");
    setIsHtml(notice?.is_html === true);
    setPinned(!!notice?.pinned_at);
    setKept((notice?.notice_attachments ?? []).slice().sort((a, b) => a.sort_order - b.sort_order));
    setPending([]);
    setStatus({ text: "" });
    setPreview(false);
  }, [open, notice]);

  // 새로 고른 파일의 임시 미리보기 주소(blob:)는 창을 닫을 때 한꺼번에 정리
  const urlsRef = useRef<string[]>([]);
  useEffect(() => {
    if (open) return;
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = [];
  }, [open]);

  const total = kept.length + pending.length;

  function replaceSelection(text: string, selFrom: number, selTo: number) {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.focus();
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text); // Ctrl+Z로 되돌릴 수 있게
    } catch {
      ok = false;
    }
    if (!ok || ta.value.slice(start, start + text.length) !== text) ta.setRangeText(text, start, end, "end");
    ta.setSelectionRange(start + selFrom, start + selTo);
    setContent(ta.value);
  }

  function insertSnippet(key: string) {
    const ta = taRef.current;
    const snip = SNIPPETS[key];
    if (!ta || !snip) return;
    const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (snip.wrap) {
      const inner = selected || snip.placeholder || "";
      replaceSelection(snip.wrap[0] + inner + snip.wrap[1], snip.wrap[0].length, snip.wrap[0].length + inner.length);
      return;
    }
    const inner = selected || snip.placeholder || "";
    const body = snip.block!.replace("□", inner);
    const before = ta.value.slice(0, ta.selectionStart);
    const after = ta.value.slice(ta.selectionEnd);
    const lead = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const trail = after.startsWith("\n") ? "" : "\n";
    const text = lead + body + trail;
    const markerAt = snip.block!.indexOf("□");
    const from = markerAt === -1 ? text.length : lead.length + markerAt;
    const to = markerAt === -1 ? text.length : from + inner.length;
    replaceSelection(text, from, to);
  }

  function wrapWithClass(cls: string) {
    const ta = taRef.current;
    if (!cls || !ta) return;
    ta.focus();
    const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd) || "색 글자";
    const openTag = `<span class="${cls}">`;
    replaceSelection(openTag + selected + "</span>", openTag.length, openTag.length + selected.length);
  }

  function toggleHtml(on: boolean) {
    setStatus({ text: "" });
    if (on) {
      const converted = plainTextToHtml(content);
      if (converted !== content) {
        setContent(converted);
        setStatus({ text: "기존 글을 HTML로 바꿨어요. 줄바꿈은 그대로 유지돼요." });
      }
    } else if (/<[a-z][^>]*>/i.test(content)) {
      setStatus({ text: "HTML을 끄면 태그가 글자 그대로 보여요. 다시 켜면 원래대로 보여요." });
    }
    setIsHtml(on);
  }

  function pick(files: File[], allowed: Set<string>, kind: "image" | "file") {
    const next = [...pending];
    for (const file of files) {
      if (kept.length + next.length >= MAX_NOTICE_ATTACHMENTS) {
        setStatus({ text: `첨부파일은 최대 ${MAX_NOTICE_ATTACHMENTS}개까지예요.`, error: true });
        break;
      }
      if (!allowed.has(extOf(file.name))) {
        setStatus({ text: `지원하지 않는 파일 형식이에요: ${file.name}`, error: true });
        continue;
      }
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);
      next.push({ file, kind, url });
    }
    setPending(next);
  }

  async function submit() {
    const t = title.trim();
    if (!t) {
      setStatus({ text: "제목을 입력해주세요.", error: true });
      return;
    }
    setBusy(true);
    const isEdit = !!notice;
    try {
      let uploaded: Awaited<ReturnType<typeof uploadNoticeFiles>> = [];
      if (pending.length > 0) {
        setStatus({ text: "첨부파일 업로드 중..." });
        uploaded = await uploadNoticeFiles(pending.map((p) => ({ file: p.file, kind: p.kind })));
      }
      setStatus({ text: isEdit ? "저장 중..." : "등록 중..." });
      await saveNotice(notice?.id ?? null, {
        title: t,
        content: content.trim(),
        isHtml,
        pinned,
        attachments: [...kept.map(toApiAttachment), ...uploaded],
      });
      onSaved();
    } catch (err) {
      console.error("[notice] 등록/수정 실패", err);
      const base = isEdit ? "저장에 실패했어요." : "등록에 실패했어요.";
      const msg = err instanceof Error ? err.message : "";
      setStatus({ text: msg === "upload_failed" || msg === "upload_urls_failed" ? `${base} (첨부파일 업로드 오류)` : base, error: true });
    } finally {
      setBusy(false);
    }
  }

  const previewExtra = useMemo(
    () => pending.map((p) => ({ name: p.file.name, size: p.file.size, url: p.url, kind: p.kind })),
    [pending],
  );

  const keptImages = kept.map((a, i) => ({ a, i })).filter(({ a }) => a.kind === "image");
  const keptFiles = kept.map((a, i) => ({ a, i })).filter(({ a }) => a.kind !== "image");
  const pendImages = pending.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === "image");
  const pendFiles = pending.map((p, i) => ({ p, i })).filter(({ p }) => p.kind !== "image");
  const atLimit = total >= MAX_NOTICE_ATTACHMENTS;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        wide
        title={notice ? "공지 수정" : "새 공지"}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setPreview(true)}>
              미리보기
            </button>
            <span className="spacer" />
            <button type="button" className="btn" onClick={onClose}>
              취소
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
              {notice ? "저장" : "등록"}
            </button>
          </>
        }
      >
        <div className={styles.form}>
          <input className="input" placeholder="제목" maxLength={80} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />

          <div className={styles.toggles}>
            <label className="check">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
              상단 고정
            </label>
            <label className="check">
              <input type="checkbox" checked={isHtml} onChange={(e) => toggleHtml(e.target.checked)} />
              HTML로 꾸미기 (노션처럼)
            </label>
          </div>

          {isHtml && (
            <div className={styles.tools}>
              {Object.entries(SNIPPETS).map(([k, v]) => (
                <button key={k} type="button" className="btn btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => insertSnippet(k)}>
                  {v.label}
                </button>
              ))}
              <select className={`select ${styles.toolSelect}`} aria-label="글자색" value="" onChange={(e) => wrapWithClass(e.target.value)}>
                <option value="">글자색</option>
                {TEXT_COLORS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <select className={`select ${styles.toolSelect}`} aria-label="배경색" value="" onChange={(e) => wrapWithClass(e.target.value)}>
                <option value="">배경색</option>
                {BG_COLORS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          )}

          <textarea
            ref={taRef}
            className={`textarea ${isHtml ? styles.code : ""}`}
            rows={10}
            autoComplete="off"
            placeholder={isHtml ? "HTML로 입력하세요 — 위 버튼으로 제목·콜아웃·토글 등을 넣을 수 있어요" : "내용을 입력하세요 (비워둬도 돼요)"}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />

          <div className={styles.attach}>
            <div className={styles.attachHead}>
              <span className="field-label">첨부파일</span>
              <span className="muted num">
                {total}/{MAX_NOTICE_ATTACHMENTS}
              </span>
            </div>

            <div className={styles.attachGroupTitle}>
              <ImagePlus size={16} aria-hidden="true" /> 사진 <span className="muted">글에서 바로 보여줘요</span>
            </div>
            <div className={styles.photoGrid}>
              {keptImages.map(({ a, i }) => (
                <div key={`k${a.id}`} className={styles.photoTile}>
                  <img src={noticeAttachmentUrl(a.storage_path)} alt="" />
                  <button type="button" aria-label="제거" onClick={() => setKept(kept.filter((_, j) => j !== i))}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              {pendImages.map(({ p, i }) => (
                <div key={`p${i}`} className={styles.photoTile}>
                  <img src={p.url} alt="" />
                  <button type="button" aria-label="제거" onClick={() => setPending(pending.filter((_, j) => j !== i))}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              {!atLimit && (
                <button type="button" className={styles.addTile} onClick={() => imgInput.current?.click()}>
                  <Plus size={20} aria-hidden="true" />
                  사진 추가
                </button>
              )}
            </div>
            <input
              ref={imgInput}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/gif,image/webp"
              hidden
              onChange={(e) => {
                pick(Array.from(e.target.files ?? []), NOTICE_IMAGE_EXT, "image");
                e.target.value = "";
              }}
            />

            <div className={styles.attachGroupTitle}>
              <Paperclip size={16} aria-hidden="true" /> 파일 <span className="muted">다운로드만 가능해요 (이미지도 첨부 가능)</span>
            </div>
            <div className={styles.fileList}>
              {keptFiles.map(({ a, i }) => (
                <div key={`k${a.id}`} className={styles.fileRow}>
                  <FileText size={16} aria-hidden="true" />
                  <span className={styles.fileName}>{a.file_name}</span>
                  <span className="muted">{formatFileSize(a.size_bytes)}</span>
                  <button type="button" className="link-btn" aria-label="제거" onClick={() => setKept(kept.filter((_, j) => j !== i))}>
                    <X size={16} />
                  </button>
                </div>
              ))}
              {pendFiles.map(({ p, i }) => (
                <div key={`p${i}`} className={styles.fileRow}>
                  <FileText size={16} aria-hidden="true" />
                  <span className={styles.fileName}>{p.file.name}</span>
                  <span className="muted">{formatFileSize(p.file.size)}</span>
                  <button type="button" className="link-btn" aria-label="제거" onClick={() => setPending(pending.filter((_, j) => j !== i))}>
                    <X size={16} />
                  </button>
                </div>
              ))}
              {!atLimit && (
                <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()}>
                  <Plus size={16} aria-hidden="true" />
                  파일 추가
                </button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.hwpx,.zip,.txt,.csv"
              hidden
              onChange={(e) => {
                pick(Array.from(e.target.files ?? []), NOTICE_FILE_PICKER_EXT, "file");
                e.target.value = "";
              }}
            />
          </div>

          <p className={`status ${status.error ? "error" : ""}`} role="status">
            {status.text}
          </p>
        </div>
      </Modal>

      <Modal
        open={preview}
        onClose={() => setPreview(false)}
        wide
        title={title.trim() || "(제목 없음)"}
        subtitle={
          <>
            <span className="tag tag-blue">미리보기</span> 저장하면 이렇게 보여요
          </>
        }
        actions={
          <button type="button" className="btn" onClick={() => setPreview(false)}>
            편집으로 돌아가기
          </button>
        }
      >
        {content.trim() || kept.length || pending.length ? (
          <NoticeBody content={content} isHtml={isHtml} attachments={kept} extra={previewExtra} />
        ) : (
          <p className="muted">(내용 없음)</p>
        )}
      </Modal>
    </>
  );
}
