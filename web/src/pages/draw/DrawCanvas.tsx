// 그림판 — 그림 후원용. 실제 그림 크기는 960×540(16:9)으로 고정하고, 화면엔 칸 너비에 맞춰 늘려 보여줌.
// 배경은 투명 — 방송 화면 위에 그림만 그려짐(그림도네처럼). 그리는 동안은 바둑판 배경(밝게/어둡게)으로 보여줌.
// 펜·지우개(투명하게 지움), 굵기 3단계, 색 12개 + 직접 고르기, 되돌리기/다시 하기(최대 40번), 전체 지우기.
// 그리던 그림은 이 브라우저에 잠깐 저장해서(새로고침해도 유지) 보내면 지움.
// 획 기록(ops)도 같이 남김 — 방송 오버레이가 이걸로 그림이 빠르게 그려지는 모습을 다시 보여줌(그림도네처럼).
//   op: { c: 색, w: 굵기, p: [x,y,x,y,...] (정수 좌표), e?: 1 (지우개) } | { k: "clear" }
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Contrast, Eraser, Pencil, Redo2, Trash2, Undo2 } from "lucide-react";
import { readStorage, writeStorage } from "../../lib/storage";
import styles from "./Draw.module.css";

export const CANVAS_W = 960;
export const CANVAS_H = 540;
// 투명 배경으로 바뀌면서 저장 키도 바꿈 — 예전(흰 배경) 임시저장은 이어 그리지 않음
const DRAFT_KEY = "chzzk_points_draw_draft_v2";
const BG_KEY = "chzzk_points_draw_bg";
const COLORS = ["#111111", "#6b7280", "#ffffff", "#e5383b", "#ff8c42", "#ffd23f", "#2fbf71", "#00b4d8", "#3a6ff7", "#8b5cf6", "#ff6fb5", "#8b5a2b"];
const SIZES = [
  { v: 4, label: "가늘게" },
  { v: 10, label: "보통" },
  { v: 24, label: "굵게" },
];
const MAX_HISTORY = 40;
const MAX_POINTS = 60_000; // 획 기록이 너무 커지면(아주 오래 그리면) 재생 없이 그림만 보냄

export type DrawOp = { c: string; w: number; p: number[]; e?: 1 } | { k: "clear" };
export type DrawCanvasHandle = { exportImage: () => string; exportOps: () => string | null; clear: () => void; isBlank: () => boolean };
const OPS_KEY = "chzzk_points_draw_ops_v2";

export const DrawCanvas = forwardRef<DrawCanvasHandle, { onChange?: (blank: boolean) => void }>(function DrawCanvas({ onChange }, ref) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1].v);
  const [eraser, setEraser] = useState(false);
  const [darkBg, setDarkBg] = useState(() => readStorage(BG_KEY) === "dark");
  const undo = useRef<ImageData[]>([]);
  const redo = useRef<ImageData[]>([]);
  const [, bump] = useState(0);
  const strokes = useRef(0); // 지금 그림에 그은 획 수(0이면 빈 그림)
  const drawing = useRef<{ id: number; pts: [number, number][] } | null>(null);
  // 지금 그림을 만든 획 순서(되돌리기하면 빼고, 다시 하기하면 넣음). null이면 기록을 못 믿음(예전 임시저장에서 이어 그림)
  const ops = useRef<DrawOp[] | null>([]);
  const redoOps = useRef<DrawOp[]>([]);
  const curOp = useRef<{ c: string; w: number; p: number[]; e?: 1 } | null>(null);

  const ctx = () => cv.current!.getContext("2d")!;
  const fillBg = () => ctx().clearRect(0, 0, CANVAS_W, CANVAS_H);
  const saveDraft = () => {
    try {
      writeStorage(DRAFT_KEY, strokes.current ? cv.current!.toDataURL("image/png") : "");
      writeStorage(OPS_KEY, strokes.current && ops.current ? JSON.stringify(ops.current) : "");
    } catch {
      /* 저장 못 해도 그리기엔 지장 없음 */
    }
  };
  const changed = () => {
    bump((n) => n + 1);
    onChange?.(strokes.current === 0);
    saveDraft();
  };

  useEffect(() => {
    fillBg();
    // 그리던 그림 이어서
    const draft = readStorage(DRAFT_KEY);
    if (draft && draft.startsWith("data:image/")) {
      const img = new Image();
      img.onload = () => {
        ctx().drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
        strokes.current = 1;
        try {
          const saved = JSON.parse(readStorage(OPS_KEY) || "null");
          ops.current = Array.isArray(saved) && saved.length ? saved : null;
        } catch {
          ops.current = null;
        }
        onChange?.(false);
        bump((n) => n + 1);
      };
      img.src = draft;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = (e: React.PointerEvent): [number, number] => {
    const r = cv.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * CANVAS_W, ((e.clientY - r.top) / r.height) * CANVAS_H];
  };
  const pushHistory = () => {
    undo.current.push(ctx().getImageData(0, 0, CANVAS_W, CANVAS_H));
    if (undo.current.length > MAX_HISTORY) undo.current.shift();
    redo.current = [];
  };

  // 획 그리기 — 점 사이를 중간점 곡선으로 이어서 매끄럽게
  const stroke = (pts: [number, number][]) => {
    const c = ctx();
    c.lineCap = "round";
    c.lineJoin = "round";
    // 지우개는 칠한 자리를 투명하게 뚫음
    c.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    c.strokeStyle = eraser ? "#000" : color;
    c.fillStyle = eraser ? "#000" : color;
    c.lineWidth = eraser ? size * 2 : size;
    if (pts.length === 1) {
      c.beginPath();
      c.arc(pts[0][0], pts[0][1], c.lineWidth / 2, 0, Math.PI * 2);
      c.fill();
      c.globalCompositeOperation = "source-over";
      return;
    }
    const n = pts.length;
    const [ax, ay] = pts[Math.max(0, n - 3)];
    const [bx, by] = pts[n - 2];
    const [cx, cy] = pts[n - 1];
    c.beginPath();
    c.moveTo((ax + bx) / 2, (ay + by) / 2);
    c.quadraticCurveTo(bx, by, (bx + cx) / 2, (by + cy) / 2);
    c.stroke();
    c.globalCompositeOperation = "source-over";
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pushHistory();
    const p = pos(e);
    drawing.current = { id: e.pointerId, pts: [p] };
    curOp.current = eraser
      ? { c: "#000000", w: size * 2, p: [Math.round(p[0]), Math.round(p[1])], e: 1 }
      : { c: color, w: size, p: [Math.round(p[0]), Math.round(p[1])] };
    stroke([p]);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    // 빠르게 그을 때 브라우저가 묶어서 보내는 점까지 다 씀
    const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of evs) {
      const r = cv.current!.getBoundingClientRect();
      const pt: [number, number] = [((ev.clientX - r.left) / r.width) * CANVAS_W, ((ev.clientY - r.top) / r.height) * CANVAS_H];
      d.pts.push(pt);
      curOp.current?.p.push(Math.round(pt[0]), Math.round(pt[1]));
      if (d.pts.length > 3) d.pts.shift();
      stroke(d.pts);
    }
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || drawing.current.id !== e.pointerId) return;
    drawing.current = null;
    if (curOp.current && ops.current) ops.current.push(curOp.current);
    curOp.current = null;
    redoOps.current = [];
    strokes.current += 1;
    changed();
  };

  const doUndo = useCallback(() => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(ctx().getImageData(0, 0, CANVAS_W, CANVAS_H));
    ctx().putImageData(prev, 0, 0);
    const op = ops.current?.pop();
    if (op) redoOps.current.push(op);
    strokes.current = Math.max(0, strokes.current - 1);
    changed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const doRedo = useCallback(() => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(ctx().getImageData(0, 0, CANVAS_W, CANVAS_H));
    ctx().putImageData(next, 0, 0);
    const op = redoOps.current.pop();
    if (op && ops.current) ops.current.push(op);
    strokes.current += 1;
    changed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const clear = () => {
    if (!strokes.current) return;
    pushHistory();
    fillBg();
    ops.current?.push({ k: "clear" });
    redoOps.current = [];
    strokes.current = 0;
    changed();
  };

  // Ctrl+Z / Ctrl+Shift+Z(또는 Ctrl+Y)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea")) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  useImperativeHandle(ref, () => ({
    // 투명 배경 그대로(webp·png 둘 다 투명 지원)
    exportImage: () => {
      const webp = cv.current!.toDataURL("image/webp", 0.88);
      // webp로 못 만드는 브라우저(일부 사파리)는 png로
      return webp.startsWith("data:image/webp") ? webp : cv.current!.toDataURL("image/png");
    },
    exportOps: () => {
      const list = ops.current;
      if (!list || !list.length) return null;
      const n = list.reduce((a, o) => a + ("p" in o ? o.p.length / 2 : 0), 0);
      return n > 0 && n <= MAX_POINTS ? JSON.stringify(list) : null;
    },
    clear: () => {
      fillBg();
      ops.current = [];
      redoOps.current = [];
      strokes.current = 0;
      undo.current = [];
      redo.current = [];
      changed();
    },
    isBlank: () => strokes.current === 0,
  }));

  return (
    <div className={styles.board}>
      <div className={styles.tools} role="toolbar" aria-label="그리기 도구">
        <div className={styles.toolGroup}>
          <button type="button" className={`${styles.tool} ${!eraser ? styles.toolOn : ""}`} onClick={() => setEraser(false)} aria-pressed={!eraser} title="펜">
            <Pencil size={17} aria-hidden="true" />
            <span>펜</span>
          </button>
          <button type="button" className={`${styles.tool} ${eraser ? styles.toolOn : ""}`} onClick={() => setEraser(true)} aria-pressed={eraser} title="지우개">
            <Eraser size={17} aria-hidden="true" />
            <span>지우개</span>
          </button>
        </div>
        <div className={styles.toolGroup} role="radiogroup" aria-label="굵기">
          {SIZES.map((s) => (
            <button key={s.v} type="button" role="radio" aria-checked={size === s.v} className={`${styles.sizeBtn} ${size === s.v ? styles.toolOn : ""}`} onClick={() => setSize(s.v)} title={s.label}>
              <i style={{ width: Math.max(4, s.v * 0.7), height: Math.max(4, s.v * 0.7), background: eraser ? "var(--c-text-3)" : color }} aria-hidden="true" />
              <span className="sr-only">{s.label}</span>
            </button>
          ))}
        </div>
        <div className={styles.palette} role="radiogroup" aria-label="색">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={!eraser && color === c}
              aria-label={c}
              className={`${styles.swatch} ${!eraser && color === c ? styles.swatchOn : ""}`}
              style={{ background: c }}
              onClick={() => {
                setColor(c);
                setEraser(false);
              }}
            />
          ))}
          <label className={styles.customColor} title="직접 고르기">
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                setEraser(false);
              }}
              aria-label="색 직접 고르기"
            />
          </label>
        </div>
        <div className={styles.toolGroup}>
          <button type="button" className={styles.tool} onClick={doUndo} disabled={!undo.current.length} title="되돌리기 (Ctrl+Z)">
            <Undo2 size={17} aria-hidden="true" />
            <span className="sr-only">되돌리기</span>
          </button>
          <button type="button" className={styles.tool} onClick={doRedo} disabled={!redo.current.length} title="다시 하기 (Ctrl+Shift+Z)">
            <Redo2 size={17} aria-hidden="true" />
            <span className="sr-only">다시 하기</span>
          </button>
          <button type="button" className={styles.tool} onClick={clear} disabled={!strokes.current} title="전체 지우기">
            <Trash2 size={17} aria-hidden="true" />
            <span>전체 지우기</span>
          </button>
        </div>
        <div className={styles.toolGroup}>
          <button
            type="button"
            className={styles.tool}
            onClick={() => {
              writeStorage(BG_KEY, darkBg ? "light" : "dark");
              setDarkBg(!darkBg);
            }}
            title="그리는 동안만 보이는 배경이에요. 방송엔 배경 없이 그림만 나가요."
          >
            <Contrast size={17} aria-hidden="true" />
            <span>{darkBg ? "어두운 배경" : "밝은 배경"}</span>
          </button>
        </div>
      </div>
      <canvas
        ref={cv}
        width={CANVAS_W}
        height={CANVAS_H}
        className={`${styles.canvas} ${darkBg ? styles.canvasDark : ""} ${eraser ? styles.erasing : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-label="그림판 — 마우스나 손가락으로 그려요"
      />
    </div>
  );
});
