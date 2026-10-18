// 공지사항 — 게시판처럼 제목 목록, 누르면 게시글 화면(?id=N)으로 내용. 관리자는 글쓰기·수정·삭제·고정.
// 홈 미리보기에서 notice.html?id=5 로 들어오면 그 글이 바로 열림. 목록에서 들어왔으면 "← 목록"이 뒤로가기.
import { LoadError } from "../../components/LoadError";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { PageHead } from "../../components/ui";
import { NoticeBody } from "../../components/NoticeContent";
import { useAuth } from "../../lib/auth";
import { deleteNotice, isNoticeNew, markNoticeRead, setNoticePin, useNoticeReadVersion, useNotices, type Notice as NoticeT } from "../../lib/notices";
import { useTableRefetch } from "../../lib/realtime";
import { NoticeEditor } from "./NoticeEditor";
import styles from "./Notice.module.css";
import bs from "../board/Board.module.css";
import { alertDialog, confirmDialog } from "../../lib/dialog";
import { SkeletonList, SkeletonPost, useBloom } from "../../components/Skeleton";
import { Avatar } from "../../components/Avatar";
import { BRAND_MARK_URL } from "../../lib/config";
import { boardTime } from "../../lib/board";

// 공지 작성자 표시(공지는 작성자를 따로 저장하지 않음 — 관리자 공지)
const AUTHOR = "관리자";
// 목록 미리보기 — HTML 태그를 걷어낸 본문 앞부분
function previewOf(n: NoticeT) {
  const raw = String(n.content ?? "");
  const text = n.is_html ? raw.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ") : raw;
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function Notice() {
  const { isAdmin } = useAuth();
  const q = useNotices(50);
  const qc = useQueryClient();
  useNoticeReadVersion();
  useTableRefetch("notices", [["notices"]], { minIntervalMs: 500 });

  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const fromList = !!(useLocation().state as { fromList?: boolean } | null)?.fromList;
  const viewId = Number(params.get("id")) || null;
  const viewing = useMemo(() => q.data?.find((n) => n.id === viewId) ?? null, [q.data, viewId]);
  const bloom = useBloom(q.isLoading);
  const [editor, setEditor] = useState<{ open: boolean; notice: NoticeT | null }>({ open: false, notice: null });
  const [busy, setBusy] = useState(false);

  function open(n: NoticeT) {
    markNoticeRead(n.id);
    setParams({ id: String(n.id) }, { state: { fromList: true } });
  }
  // 목록에서 들어왔으면 뒤로가기(스크롤·히스토리 유지), 홈·주소로 바로 열었으면 목록으로
  function closeView() {
    if (fromList) nav(-1);
    else setParams({}, { replace: true });
  }
  // 주소(?id=)로 바로 열린 글도 읽음 처리
  useEffect(() => {
    if (viewing && isNoticeNew(viewing)) markNoticeRead(viewing.id);
  }, [viewing]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["notices"] });

  async function onDelete(n: NoticeT) {
    if (!(await confirmDialog("이 공지를 삭제할까요?", { danger: true }))) return;
    try {
      await deleteNotice(n.id);
      if (viewId === n.id) closeView();
      refresh();
    } catch {
      alertDialog("삭제에 실패했어요.");
    }
  }
  async function onPin(n: NoticeT) {
    setBusy(true);
    try {
      await setNoticePin(n.id, !n.pinned_at);
      await refresh();
    } catch {
      alertDialog(n.pinned_at ? "고정 해제에 실패했어요." : "고정에 실패했어요.");
    } finally {
      setBusy(false);
    }
  }

  const editorEl = isAdmin && (
    <NoticeEditor
      open={editor.open}
      notice={editor.notice}
      onClose={() => setEditor({ open: false, notice: null })}
      onSaved={() => {
        setEditor({ open: false, notice: null });
        refresh();
      }}
    />
  );

  // ── 글 보기(게시판 글처럼 한 화면) ──
  if (viewId) {
    return (
      <div className="page">
        <PageHead title="공지사항" />
        <button type="button" className={bs.backBtn} onClick={closeView}>
          <ArrowLeft size={18} aria-hidden="true" />
          목록
        </button>
        <Card>
          {q.isLoading && <SkeletonPost />}
          {q.isError && <LoadError what="공지사항" onRetry={() => q.refetch()} />}
          {q.data && !viewing && <EmptyState>삭제됐거나 없는 공지예요.</EmptyState>}
          {viewing && (
            <article className={bs.post}>
              <div className={bs.meta}>
                <Avatar name={AUTHOR} image={BRAND_MARK_URL} size={24} />
                <span className={bs.who}>{AUTHOR}</span>
                <span className={bs.dot}>·</span>
                <span title={fmtDate(viewing.created_at)}>{boardTime(viewing.created_at)}</span>
              </div>
              <h3 className={bs.postTitle}>
                {viewing.pinned_at && (
                  <span className="tag tag-accent">
                    <Pin size={11} aria-hidden="true" />
                    고정
                  </span>
                )}
                {viewing.title || "(제목 없음)"}
              </h3>
              <div className={styles.viewBody}>
                <NoticeBody content={viewing.content} isHtml={viewing.is_html} attachments={viewing.notice_attachments} />
              </div>
              {isAdmin && (
                <div className={bs.postActions}>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onPin(viewing)}>
                    {viewing.pinned_at ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}
                    {viewing.pinned_at ? "고정 해제" : "고정"}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditor({ open: true, notice: viewing })}>
                    <Pencil size={15} aria-hidden="true" /> 수정
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => onDelete(viewing)}>
                    <Trash2 size={15} aria-hidden="true" /> 삭제
                  </button>
                </div>
              )}
            </article>
          )}
        </Card>
        <div className={styles.viewFoot}>
          <button type="button" className="btn" onClick={closeView}>
            <ArrowLeft size={16} aria-hidden="true" />
            목록으로
          </button>
        </div>
        {editorEl}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead
        title="공지사항"
        desc="방송 일정, 사이트 업데이트 소식을 알려드려요."
        actions={
          isAdmin && (
            <button type="button" className="btn btn-primary" onClick={() => setEditor({ open: true, notice: null })}>
              <Plus size={18} aria-hidden="true" />
              글쓰기
            </button>
          )
        }
      />

      <Card flush>
        {q.isLoading && <SkeletonList rows={6} />}
        {q.isError && <LoadError what="공지사항" onRetry={() => q.refetch()} />}
        {q.data?.length === 0 && <EmptyState>등록된 공지사항이 없어요.</EmptyState>}
        <ul className={`${bs.list} ${bloom}`}>
          {q.data?.map((n) => (
            <li key={n.id} className={n.pinned_at ? styles.pinned : ""}>
              <a
                href={`?id=${n.id}`}
                className={bs.item}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  open(n);
                }}
              >
                <span className={bs.itemTitle}>
                  {n.pinned_at && (
                    <span className="tag tag-accent">
                      <Pin size={11} aria-hidden="true" />
                      고정
                    </span>
                  )}
                  <span className={bs.tt}>{n.title || "(제목 없음)"}</span>
                  {isNoticeNew(n) && <span className={bs.newMark}>N</span>}
                </span>
                <span className={bs.preview}>{previewOf(n)}</span>
                <span className={bs.meta}>
                  <span className={bs.who}>{AUTHOR}</span>
                  <span className={bs.dot}>·</span>
                  <span title={fmtDate(n.created_at)}>{boardTime(n.created_at)}</span>
                </span>
              </a>
              {isAdmin && (
                <span className={styles.adminRow}>
                  <button type="button" className="link-btn" disabled={busy} onClick={() => onPin(n)}>
                    {n.pinned_at ? "고정 해제" : "고정"}
                  </button>
                  <button type="button" className="link-btn" onClick={() => setEditor({ open: true, notice: n })}>
                    수정
                  </button>
                  <button type="button" className="link-btn" onClick={() => onDelete(n)}>
                    삭제
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {editorEl}
    </div>
  );
}
