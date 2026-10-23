// 유진고사 시험지 낙서 — 예전에 시험지를 직접 올리던 시절처럼 시험지 위에 그림·낙서.
// 화면마다 시험지 모양(한 단/두 단)이 달라지면 낙서 위치가 어긋나므로, 낙서가 얹히는 시험지는 늘 같은 모양(폭 880, 두 단)으로
// 그린 다음 칸 너비에 맞춰 늘리거나 줄여서 보여줌(FixedPaper). 낙서는 그 고정 좌표계의 펜 획 기록(벡터)으로 저장.
//   획: { c: 색, s: 굵기, p: [x,y,x,y,…], e?: 1(지우개) }
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Eraser, Hand, Minus, Pencil, Plus, Redo2, Trash2, Undo2, X } from "lucide-react";
import { confirmDialog } from "../../lib/dialog";
import type { Doodle, DoodleOp } from "../../lib/quiz";
import styles from "./Quiz.module.css";

export const PAPER_W = 880; // 낙서용 시험지 폭(이 폭이면 시험지가 두 단)
const RES = 1.5; // 캔버스 해상도 배율(방송 화면에서 크게 늘려도 덜 흐리게)
// 밝은/어두운 테마 어느 쪽 시험지에서도 잘 보이는 색만(검정·흰색은 테마에 따라 안 보여서 뺌)
const COLORS = ["#3a6ff7", "#e5383b", "#2fbf71", "#ff8c42", "#8b5cf6", "#ff6fb5", "#00b4d8", "#8a8f98"];
const SIZES = [
  { v: 3, label: "가늘게" },
  { v: 6, label: "보통" },
  { v: 14, label: "굵게" },
];

export function drawOps(ctx: CanvasRenderingContext2D, ops: DoodleOp[], w: number, h: number) {
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  ctx.clearRect(0, 0, w, h);
  for (const op of ops) strokeOp(ctx, op);
  ctx.globalCompositeOperation = "source-over";
}
function strokeOp(ctx: CanvasRenderingContext2D, op: DoodleOp, from = 0) {
  ctx.globalCompositeOperation = op.e ? "destination-out" : "source-over";
  ctx.strokeStyle = op.c;
  ctx.lineWidth = op.s;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const p = op.p;
  const start = Math.max(0, from - 2);
  ctx.moveTo(p[start], p[start + 1]);
  if (p.length - start <= 2) ctx.lineTo(p[start] + 0.01, p[start + 1]);
  for (let i = start + 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.stroke();
}

// 시험지를 고정 폭(880)으로 그리고 칸 너비 × zoom에 맞춰 늘려 보여줌. overlay는 같은 좌표계(880 × 시험지 높이) 위에 얹힘.
export function FixedPaper({ children, overlay, zoom = 1 }: { children: ReactNode; overlay?: (h: number) => ReactNode; zoom?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => {
      if (wrap.current) setFit(wrap.current.clientWidth);
      if (inner.current) setH(inner.current.offsetHeight);
    });
    if (wrap.current) ro.observe(wrap.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);
  const scale = fit ? (fit / PAPER_W) * zoom : 1;
  return (
    <div ref={wrap} className={styles.fixedWrap}>
      <div className={styles.fixedBox} style={{ width: fit ? PAPER_W * scale : "100%", height: h * scale || undefined }}>
        <div ref={inner} className={styles.fixedInner} style={{ width: PAPER_W, transform: `scale(${scale})` }}>
          {children}
          {overlay && h > 0 && overlay(h)}
        </div>
      </div>
    </div>
  );
}

// 낙서 보여주기(그리기 없음)
export function DoodleLayer({ doodle }: { doodle: Doodle }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current;
    if (c) drawOps(c.getContext("2d")!, doodle.ops, doodle.w, doodle.h);
  }, [doodle]);
  return <canvas ref={cv} className={styles.doodleCanvas} width={doodle.w * RES} height={doodle.h * RES} style={{ width: doodle.w, height: doodle.h }} aria-label="시험지 낙서" role="img" />;
}

// 낙서하기 — 화면 전체를 덮는 편집기. paper: 읽기 전용 시험지(ExamPaper)
export function DoodleEditor({ paper, initial, onSave, onClose }: { paper: ReactNode; initial: Doodle | null; onSave: (d: Doodle | null) => void; onClose: () => void }) {
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1].v);
  const [eraser, setEraser] = useState(false);
  const [hand, setHand] = useState(false); // 폰: 손(스크롤) ↔ 펜(그리기)
  const [zoom, setZoom] = useState(1);
  const ops = useRef<DoodleOp[]>(initial?.ops ? [...initial.ops] : []);
  const redo = useRef<DoodleOp[]>([]);
  const cur = useRef<{ id: number; op: DoodleOp } | null>(null);
  const [, bump] = useState(0);
  const [h, setH] = useState(initial?.h ?? 0);
  const cv = useRef<HTMLCanvasElement>(null);

  const redraw = useCallback(() => {
    const c = cv.current;
    if (c && h) drawOps(c.getContext("2d")!, ops.current, PAPER_W, h);
  }, [h]);
  useEffect(redraw, [redraw]);

  // 편집기 열려 있는 동안 뒤 페이지 스크롤 막기 + Esc로 닫기
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) * PAPER_W) / r.width), Math.round(((e.clientY - r.top) * h) / r.height)];
  };
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (hand || cur.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    const op: DoodleOp = eraser ? { c: "#000000", s: size * 2.5, p: [x, y], e: 1 } : { c: color, s: size, p: [x, y] };
    cur.current = { id: e.pointerId, op };
    const ctx = e.currentTarget.getContext("2d")!;
    ctx.setTransform(RES, 0, 0, RES, 0, 0);
    strokeOp(ctx, op);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = cur.current;
    if (!c || c.id !== e.pointerId) return;
    const [x, y] = pos(e);
    const p = c.op.p;
    if (Math.abs(p[p.length - 2] - x) + Math.abs(p[p.length - 1] - y) < 2) return;
    p.push(x, y);
    const ctx = e.currentTarget.getContext("2d")!;
    ctx.setTransform(RES, 0, 0, RES, 0, 0);
    strokeOp(ctx, c.op, p.length - 2);
  }
  function up(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = cur.current;
    if (!c || c.id !== e.pointerId) return;
    cur.current = null;
    ops.current.push(c.op);
    redo.current = [];
    bump((n) => n + 1);
  }
  const undoOne = () => {
    const op = ops.current.pop();
    if (op) redo.current.push(op);
    redraw();
    bump((n) => n + 1);
  };
  const redoOne = () => {
    const op = redo.current.pop();
    if (op) ops.current.push(op);
    redraw();
    bump((n) => n + 1);
  };
  async function clearAll() {
    if (!ops.current.length || !(await confirmDialog("낙서를 전부 지울까요?", { okText: "전부 지우기" }))) return;
    ops.current = [];
    redo.current = [];
    redraw();
    bump((n) => n + 1);
  }
  const save = () => {
    onSave(ops.current.length ? { w: PAPER_W, h, ops: ops.current } : null);
    onClose();
  };

  return createPortal(
    <div className={styles.doodleEditor} role="dialog" aria-modal="true" aria-label="시험지에 낙서하기">
      <div className={styles.doodleBar}>
        <div className={styles.doodleTools}>
          <div className={styles.doodleSeg} role="group" aria-label="도구">
            <button type="button" aria-pressed={!eraser && !hand} className={!eraser && !hand ? styles.doodleOn : ""} onClick={() => { setEraser(false); setHand(false); }} title="펜">
              <Pencil size={16} aria-hidden="true" />
            </button>
            <button type="button" aria-pressed={eraser && !hand} className={eraser && !hand ? styles.doodleOn : ""} onClick={() => { setEraser(true); setHand(false); }} title="지우개">
              <Eraser size={16} aria-hidden="true" />
            </button>
            <button type="button" aria-pressed={hand} className={hand ? styles.doodleOn : ""} onClick={() => setHand((v) => !v)} title="손(화면 옮기기)">
              <Hand size={16} aria-hidden="true" />
            </button>
          </div>
          <div className={styles.doodleColors} role="group" aria-label="색">
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={`색 ${c}`} aria-pressed={color === c && !eraser} className={color === c && !eraser ? styles.doodleColorOn : ""} style={{ background: c }} onClick={() => { setColor(c); setEraser(false); setHand(false); }} />
            ))}
          </div>
          <div className={styles.doodleSeg} role="group" aria-label="굵기">
            {SIZES.map((s) => (
              <button key={s.v} type="button" aria-pressed={size === s.v} className={size === s.v ? styles.doodleOn : ""} onClick={() => setSize(s.v)} title={s.label}>
                <i style={{ width: Math.min(16, s.v + 2), height: Math.min(16, s.v + 2) }} />
              </button>
            ))}
          </div>
          <div className={styles.doodleSeg}>
            <button type="button" onClick={undoOne} disabled={!ops.current.length} title="되돌리기">
              <Undo2 size={16} aria-hidden="true" />
            </button>
            <button type="button" onClick={redoOne} disabled={!redo.current.length} title="다시 하기">
              <Redo2 size={16} aria-hidden="true" />
            </button>
            <button type="button" onClick={clearAll} disabled={!ops.current.length} title="전부 지우기">
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
          <div className={styles.doodleSeg} role="group" aria-label="확대">
            <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} title="축소">
              <Minus size={16} aria-hidden="true" />
            </button>
            <span className={`num ${styles.doodleZoom}`}>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.5))} disabled={zoom >= 3} title="확대">
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className={styles.doodleActs}>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            <X size={15} aria-hidden="true" /> 취소
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={save}>
            완료
          </button>
        </div>
      </div>
      <p className={styles.doodleHint}>시험지 어디에든 그려도 돼요 · 답안과 같이 제출되고, 방송에서 채점할 때 같이 보여요</p>
      <div className={styles.doodleScroll}>
        <FixedPaper
          zoom={zoom}
          overlay={(ph) => {
            if (ph !== h && !cur.current) queueMicrotask(() => setH((old) => Math.max(old, ph)));
            return (
              <canvas
                ref={cv}
                className={`${styles.doodleCanvas} ${styles.doodleDraw} ${hand ? styles.doodleHand : ""}`}
                width={PAPER_W * RES}
                height={(h || ph) * RES}
                style={{ width: PAPER_W, height: h || ph }}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
              />
            );
          }}
        >
          {paper}
        </FixedPaper>
      </div>
    </div>,
    document.body,
  );
}
