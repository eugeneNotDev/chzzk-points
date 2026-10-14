// 글쓰기 / 수정. 본문은 contenteditable 편집칸 — 사진이 글 쓰던 자리에 바로 보이고,
// 저장할 때 "글 + [[사진:n]] 표시"로 바꿔서 보냄(n = 저장되는 사진 순서). 표시 없는 사진은 글 맨 아래.
// 편집칸 내용은 React가 아니라 DOM이 직접 들고 있음(커서·한글 조합이 깨지지 않게).
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ImagePlus } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { LoginNeeded, PageHead } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import {
  BOARD_BUCKET,
  BOARD_CFG,
  IMG_MARK_RE,
  IMG_MARK_RE_G,
  MAX_BOARD_IMAGES,
  boardCall,
  boardErrCode,
  boardErrText,
  shrinkImage,
  type BoardKind,
  type FullPost,
} from "../../lib/board";
import { ReviewBanner } from "./ReviewBanner";
import styles from "./Board.module.css";

type Img = { key: number; path?: string; url: string; file?: File };

export function PostEditor({ board, editId }: { board: BoardKind; editId?: number }) {
  const { isLoggedIn, token } = useAuth();
  const cfg = BOARD_CFG[board];
  const q = useQuery({
    queryKey: ["board", "post", editId, token],
    enabled: !!editId && isLoggedIn,
    queryFn: () => boardCall<FullPost>({ action: "get", id: editId }),
    retry: false,
  });
  const nav = useNavigate();
  const head = (
    <>
      <PageHead title={cfg.name} />
      <button type="button" className={styles.backBtn} onClick={() => nav(-1)}>
        <ArrowLeft size={18} aria-hidden="true" />
        {editId ? "취소" : "목록"}
      </button>
    </>
  );
  if (!isLoggedIn)
    return (
      <div className="page">
        {head}
        <LoginNeeded>로그인하면 글을 쓸 수 있어요.</LoginNeeded>
      </div>
    );
  if (editId && !q.data)
    return (
      <div className="page">
        {head}
        <Card>{q.isLoading ? <p className="muted">불러오는 중...</p> : <EmptyState>글을 불러오지 못했어요.</EmptyState>}</Card>
      </div>
    );
  if (editId && q.data && !q.data.post.mine)
    return (
      <div className="page">
        {head}
        <Card>
          <EmptyState>내가 쓴 글만 수정할 수 있어요.</EmptyState>
        </Card>
      </div>
    );
  return <EditorForm key={editId ?? "new"} board={board} existing={editId ? q.data : undefined} head={head} />;
}

function EditorForm({ board, existing, head }: { board: BoardKind; existing?: FullPost; head: React.ReactNode }) {
  const cfg = BOARD_CFG[board];
  const editing = !!existing;
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const ed = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgs = useRef<Img[]>([]);
  const keySeq = useRef(0);
  const savedRange = useRef<Range | null>(null);
  const [title, setTitle] = useState(existing?.post.title ?? "");
  const [count, setCount] = useState(0);
  const [empty, setEmpty] = useState(true);
  const [status, setStatus] = useState<{ text: string; err?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const update = () => {
    const el = ed.current;
    if (!el) return;
    const n = el.querySelectorAll("figure[data-k]").length;
    setCount(n);
    setEmpty(!el.textContent?.trim() && n === 0);
  };

  const makeFigure = (im: Img) => {
    const fig = document.createElement("figure");
    fig.className = styles.edImg;
    fig.contentEditable = "false";
    fig.dataset.k = String(im.key);
    const img = document.createElement("img");
    img.src = im.url;
    img.alt = "";
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = styles.edRm;
    rm.setAttribute("aria-label", "사진 빼기");
    rm.textContent = "×";
    fig.append(img, rm);
    return fig;
  };
  const makeLine = (t: string) => {
    const d = document.createElement("div");
    if (t) d.textContent = t;
    else d.appendChild(document.createElement("br"));
    return d;
  };

  // 처음 그리기 — 기존 글은 [[사진:n]] 자리에 사진, 표시 없는 사진은 맨 아래.
  useEffect(() => {
    const el = ed.current!;
    el.replaceChildren();
    if (existing) {
      imgs.current = existing.images.map((i) => ({ key: ++keySeq.current, path: i.path, url: i.url }));
      const used = new Set<number>();
      const parts = String(existing.post.body).split(new RegExp(IMG_MARK_RE.source));
      parts.forEach((seg, i) => {
        if (i % 2 === 1) {
          const im = imgs.current[Number(seg) - 1];
          if (im && !used.has(im.key)) {
            used.add(im.key);
            el.appendChild(makeFigure(im));
          }
          return;
        }
        if (!seg.length) return;
        for (const line of seg.replace(/^\n/, "").replace(/\n$/, "").split("\n")) el.appendChild(makeLine(line));
      });
      for (const im of imgs.current) if (!used.has(im.key)) el.appendChild(makeFigure(im));
    }
    if (!el.childNodes.length) el.appendChild(makeLine(""));
    update();

    // 마지막 커서 위치 기억 — 사진 버튼을 누르면 편집칸 포커스가 빠지므로.
    const remember = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && el.contains(sel.getRangeAt(0).commonAncestorContainer)) savedRange.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", remember);
    return () => {
      document.removeEventListener("selectionchange", remember);
      for (const im of imgs.current) if (im.file) URL.revokeObjectURL(im.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insertFigures = (list: Img[]) => {
    const el = ed.current!;
    const frag = document.createDocumentFragment();
    for (const im of list) frag.appendChild(makeFigure(im));
    const after = makeLine("");
    frag.appendChild(after);
    // 커서가 있던 줄 바로 아래에 넣음. 빈 줄이면 그 줄을 사진으로 바꿔치기. 커서 기록이 없으면 맨 끝.
    let block: Node | null = null;
    const r0 = savedRange.current;
    if (r0 && el.contains(r0.startContainer)) {
      block = r0.startContainer;
      while (block && block.parentNode !== el) block = block.parentNode;
    }
    if (block && block !== el && block instanceof Element) {
      if (block.nodeName === "DIV" && !block.textContent?.trim() && !block.querySelector("figure")) block.replaceWith(frag);
      else block.after(frag);
    } else el.appendChild(frag);
    const r = document.createRange();
    r.setStart(after, 0);
    r.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    savedRange.current = r.cloneRange();
    update();
  };

  const addFiles = (files: File[]) => {
    const room = MAX_BOARD_IMAGES - (ed.current?.querySelectorAll("figure[data-k]").length ?? 0);
    const added: Img[] = [];
    for (const f of files) {
      if (added.length >= room) {
        setStatus({ text: `사진은 최대 ${MAX_BOARD_IMAGES}장까지 올릴 수 있어요.`, err: true });
        break;
      }
      if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) {
        setStatus({ text: "jpg, png, gif, webp 이미지만 올릴 수 있어요.", err: true });
        continue;
      }
      const im = { key: ++keySeq.current, file: f, url: URL.createObjectURL(f) };
      imgs.current.push(im);
      added.push(im);
    }
    if (added.length) insertFigures(added);
  };

  // 편집칸 → { text, order(사진 key 순서) }. 줄(div/p/br) 단위로 줄바꿈, 사진은 [[사진:n]] 한 줄.
  const serialize = () => {
    const order: number[] = [];
    const lines: string[] = [];
    let cur = "";
    const flush = () => {
      lines.push(cur);
      cur = "";
    };
    const walk = (node: Node) => {
      for (const ch of Array.from(node.childNodes)) {
        if (ch.nodeType === 3) {
          cur += (ch.textContent || "").replace(/ /g, " ");
          continue;
        }
        if (!(ch instanceof Element)) continue;
        if (ch.matches("figure[data-k]")) {
          if (cur) flush();
          order.push(Number((ch as HTMLElement).dataset.k));
          lines.push(`[[사진:${order.length}]]`);
          continue;
        }
        if (ch.nodeName === "BR") {
          flush();
          continue;
        }
        const block = /^(DIV|P|LI|H\d|BLOCKQUOTE)$/.test(ch.nodeName);
        if (block && cur) flush();
        walk(ch);
        if (block && (cur || !ch.querySelector("br, figure"))) flush();
      }
    };
    walk(ed.current!);
    if (cur) flush();
    return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), order };
  };

  const save = async () => {
    const t = title.trim();
    const { text, order } = serialize();
    const plain = text.replace(IMG_MARK_RE_G, "").trim();
    if (!t) return setStatus({ text: "제목을 입력해주세요.", err: true });
    if (!plain && !order.length) return setStatus({ text: "내용을 입력해주세요.", err: true });
    if (text.length > 5000) return setStatus({ text: "내용이 너무 길어요. (최대 5000자)", err: true });
    const chosen = order.map((k) => imgs.current.find((x) => x.key === k)).filter((x): x is Img => !!x);
    setSaving(true);
    try {
      const fresh = chosen.filter((i) => i.file);
      let uploads: { path: string; token: string }[] = [];
      if (fresh.length) {
        setStatus({ text: "사진 올리는 중..." });
        const files = await Promise.all(fresh.map((i) => shrinkImage(i.file!)));
        ({ uploads } = await boardCall<{ uploads: { path: string; token: string }[] }>({
          action: "upload-urls",
          files: files.map((f) => ({ fileName: f.name, sizeBytes: f.size })),
        }));
        for (let i = 0; i < files.length; i++) {
          const { error } = await supabase.storage.from(BOARD_BUCKET).uploadToSignedUrl(uploads[i].path, uploads[i].token, files[i], { contentType: files[i].type });
          if (error) throw new Error("upload_failed");
        }
      }
      let k = 0;
      const paths = chosen.map((im) => im.path ?? uploads[k++].path);
      setStatus({ text: "저장 중..." });
      qc.invalidateQueries({ queryKey: ["board", "list", board] });
      if (existing) {
        await boardCall({ action: "update", id: existing.post.id, title: t, body: text, images: paths });
        await qc.invalidateQueries({ queryKey: ["board", "post", existing.post.id] });
        nav(`${cfg.path}?post=${existing.post.id}`, { replace: true });
      } else {
        const r = await boardCall<{ id: number; rewarded?: number }>({ action: "create", board, title: t, body: text, images: paths });
        if (r.rewarded) {
          alert(`후기 보상 ${r.rewarded}P가 지급됐어요!`);
          qc.invalidateQueries({ queryKey: ["me"] });
        }
        qc.invalidateQueries({ queryKey: ["board", "review-status"] });
        nav(`${cfg.path}?post=${r.id}`, { replace: true });
      }
    } catch (e) {
      setSaving(false);
      setStatus({ text: boardErrCode(e) ? boardErrText(e) : "저장하지 못했어요. 다시 시도해주세요.", err: true });
    }
  };

  const sub = editing ? "글을 수정해요." : board === "free" && isAdmin ? "스트리머 계정으로 쓴 글은 익명이 아니라 닉네임으로 보여요." : cfg.sub;

  return (
    <div className="page">
      {head}
      <p className={styles.edSub}>{sub}</p>
      {!editing && board === "review" && <ReviewBanner />}
      <Card>
        <div className={styles.editor}>
          <input type="text" className={`input ${styles.edTitle}`} maxLength={60} placeholder="제목 (최대 60자)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div
            ref={ed}
            className={`input ${styles.rich} ${empty ? styles.empty : ""}`}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="내용"
            data-ph="내용을 입력하세요 (최대 5000자)"
            onInput={update}
            onPaste={(e) => {
              // 붙여넣기는 글자만(서식·외부 이미지 차단). 사진 파일을 붙여넣으면 사진으로 넣어줌.
              e.preventDefault();
              const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
              if (files.length) return addFiles(files);
              const text = (e.clipboardData?.getData("text/plain") || "").replace(/\r\n/g, "\n");
              document.execCommand("insertText", false, text);
            }}
            onDrop={(e) => {
              const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith("image/"));
              e.preventDefault();
              if (files.length) addFiles(files);
            }}
            onClick={(e) => {
              const rm = (e.target as Element).closest?.(`.${styles.edRm}`);
              if (!rm) return;
              const fig = rm.closest("figure") as HTMLElement | null;
              if (!fig) return;
              const im = imgs.current.find((x) => x.key === Number(fig.dataset.k));
              if (im?.file) URL.revokeObjectURL(im.url);
              imgs.current = imgs.current.filter((x) => x !== im);
              fig.remove();
              update();
            }}
          />
          <div className={styles.edTools}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={count >= MAX_BOARD_IMAGES}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus size={16} aria-hidden="true" />
              사진 <span className="num">{count}/{MAX_BOARD_IMAGES}</span>
            </button>
            <span className={styles.note}>사진은 글 쓰던 자리에 들어가요</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          {status && <p className={status.err ? styles.err : styles.note}>{status.text}</p>}
          <div className={styles.edActions}>
            <button type="button" className="btn btn-ghost" onClick={() => nav(-1)}>
              취소
            </button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
              {editing ? "수정 완료" : "등록"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
