// 공지사항 — 게시판처럼 제목 목록, 누르면 팝업으로 내용. 관리자는 글쓰기·수정·삭제·고정.
// 홈 미리보기에서 notice.html?id=5 로 들어오면 그 글이 바로 열림.
import { LoadError } from "../../components/LoadError";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Pin, Plus } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { Modal, PageHead } from "../../components/ui";
import { NoticeBody } from "../../components/NoticeContent";
import { useAuth } from "../../lib/auth";
import { deleteNotice, isNoticeNew, markNoticeRead, setNoticePin, useNoticeReadVersion, useNotices, type Notice as NoticeT } from "../../lib/notices";
import { useTableRefetch } from "../../lib/realtime";
import { NoticeEditor } from "./NoticeEditor";
import styles from "./Notice.module.css";
import { alertDialog, confirmDialog } from "../../lib/dialog";
import { SkeletonList, useBloom } from "../../components/Skeleton";
import { SPLIT_QUERY, useMedia } from "../../lib/useMedia";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function Notice() {
  const { isAdmin } = useAuth();
  const q = useNotices(50);
  const qc = useQueryClient();
  useNoticeReadVersion();
  useTableRefetch("notices", [["notices"]], { minIntervalMs: 500 });

  const [params, setParams] = useSearchParams();
  const viewId = Number(params.get("id")) || null;
  const viewing = useMemo(() => q.data?.find((n) => n.id === viewId) ?? null, [q.data, viewId]);
  // 넓은 화면: 왼쪽 목록 + 오른쪽 본문(팝업 대신). 아무것도 안 골랐으면 맨 위 공지를 보여줌.
  const wide = useMedia(SPLIT_QUERY);
  const bloom = useBloom(q.isLoading);
  const shown = wide ? (viewing ?? q.data?.[0] ?? null) : null;
  const [editor, setEditor] = useState<{ open: boolean; notice: NoticeT | null }>({ open: false, notice: null });
  const [busy, setBusy] = useState(false);

  function open(n: NoticeT) {
    markNoticeRead(n.id);
    setParams({ id: String(n.id) }, { replace: wide });
  }
  function closeView() {
    setParams({}, { replace: true });
  }
  // 주소(?id=)로 바로 열린 글도 읽음 처리
  useEffect(() => {
    const n = viewing ?? shown;
    if (n && isNoticeNew(n)) markNoticeRead(n.id);
  }, [viewing, shown]);

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

      <div className={wide ? styles.reader : undefined}>
      <Card flush className={wide ? styles.listCard : undefined}>
        {q.isLoading && <SkeletonList rows={6} variant="row" />}
        {q.isError && <LoadError what="공지사항" onRetry={() => q.refetch()} />}
        {q.data?.length === 0 && <EmptyState>등록된 공지사항이 없어요.</EmptyState>}
        <ul className={`${styles.list} ${bloom}`}>
          {q.data?.map((n) => (
            <li key={n.id} className={`${n.pinned_at ? styles.pinned : ""} ${shown?.id === n.id ? styles.current : ""}`}>
              <button type="button" className="list-row" onClick={() => open(n)} aria-current={shown?.id === n.id ? "true" : undefined}>
                {n.pinned_at && (
                  <span className="tag tag-accent">
                    <Pin size={11} aria-hidden="true" />
                    고정
                  </span>
                )}
                {isNoticeNew(n) && <span className="tag tag-live">NEW</span>}
                <span className="list-row-title">{n.title || "(제목 없음)"}</span>
                <span className="list-row-meta num">{wide ? shortDate(n.created_at) : fmtDate(n.created_at)}</span>
              </button>
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
      {wide && (
        <Card className={styles.paper}>
          {q.isLoading && <SkeletonList rows={8} variant="row" />}
          {shown && (
            <article>
              <header className={styles.paperHead}>
                <div>
                  <h2 className={styles.paperTitle}>{shown.title || "(제목 없음)"}</h2>
                  <span className={`${styles.paperDate} num`}>{fmtDate(shown.created_at)}</span>
                </div>
                {isAdmin && (
                  <div className={styles.paperTools}>
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onPin(shown)}>
                      {shown.pinned_at ? "고정 해제" : "고정"}
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setEditor({ open: true, notice: shown })}>
                      수정
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => onDelete(shown)}>
                      삭제
                    </button>
                  </div>
                )}
              </header>
              <NoticeBody content={shown.content} isHtml={shown.is_html} attachments={shown.notice_attachments} />
            </article>
          )}
        </Card>
      )}
      </div>

      <Modal
        open={!wide && !!viewing}
        onClose={closeView}
        wide
        title={viewing?.title || "(제목 없음)"}
        subtitle={viewing ? fmtDate(viewing.created_at) : undefined}
        actions={
          <>
            {isAdmin && viewing && (
              <>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onPin(viewing)}>
                  {viewing.pinned_at ? "고정 해제" : "고정"}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setEditor({ open: true, notice: viewing })}>
                  수정
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => onDelete(viewing)}>
                  삭제
                </button>
                <span className="spacer" />
              </>
            )}
            <button type="button" className="btn" onClick={closeView}>
              닫기
            </button>
          </>
        }
      >
        {viewing && <NoticeBody content={viewing.content} isHtml={viewing.is_html} attachments={viewing.notice_attachments} />}
      </Modal>

      {isAdmin && (
        <NoticeEditor
          open={editor.open}
          notice={editor.notice}
          onClose={() => setEditor({ open: false, notice: null })}
          onSaved={() => {
            setEditor({ open: false, notice: null });
            refresh();
          }}
        />
      )}
    </div>
  );
}
