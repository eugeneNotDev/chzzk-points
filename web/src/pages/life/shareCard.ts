// 인생 리포트 공유 이미지 — 엔딩 제목·나이·직업·인생 그래프를 1080×1350 카드 한 장으로 그림(캔버스, 외부 라이브러리 없음).
import type { Run } from "../../lib/life";
import { josa, won } from "../../lib/life";

const W = 1080;
const H = 1350;
const FONT = '"Pretendard Variable", Pretendard, system-ui, sans-serif';
const C = { bg1: "#0d1311", bg2: "#122a20", text: "#f4f7f5", sub: "#a7b6af", dim: "#6f817a", accent: "#2ee59d", gold: "#f5c451", pink: "#ff7eb6", line: "rgba(255,255,255,0.10)" };

function font(px: number, weight = 700) {
  return `${weight} ${px}px ${FONT}`;
}

// 한 줄 폭을 넘으면 글자 단위로 줄바꿈(한국어는 띄어쓰기 기준보다 자연스러움). maxLines를 넘으면 …
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW && cur) {
      lines.push(cur);
      cur = ch.trimStart();
    } else cur += ch;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].replace(/.$/, "…");
    return cut;
  }
  return lines;
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  ctx.font = font(30, 800);
  const w = ctx.measureText(text).width + 44;
  ctx.fillStyle = color + "22";
  ctx.strokeStyle = color + "66";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, 56, 28);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 22, y + 29);
  ctx.textBaseline = "alphabetic";
  return w;
}

export async function drawShareCard(run: Run): Promise<Blob> {
  const e = run.ending!;
  await Promise.all([document.fonts.load(font(40, 900)), document.fonts.load(font(40, 700))]).catch(() => undefined);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  const special = !!e.specialId;
  const tone = special ? C.gold : C.accent;

  // 배경
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, C.bg1);
  g.addColorStop(1, special ? "#2a2310" : C.bg2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = tone + "33";
  ctx.lineWidth = 3;
  for (const r of [260, 380]) {
    ctx.beginPath();
    ctx.arc(W - 80, 150, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  const X = 84;
  // 머리말
  ctx.fillStyle = C.sub;
  ctx.font = font(32, 700);
  ctx.fillText(`유진 키우기 · ${run.worldNo ? `No.${run.worldNo} 평행세계` : "테스트 세계"}`, X, 128);
  ctx.fillStyle = C.dim;
  ctx.font = font(28, 600);
  ctx.fillText(`${run.houseName}에서 태어남`, X, 176);

  // 마무리 문장
  const how = e.cause === "accident" ? "갑작스러운 사고로" : e.cause === "sick" ? josa(e.causeText, "로") : "편안히";
  ctx.fillStyle = C.sub;
  ctx.font = font(38, 700);
  ctx.fillText(`${e.age}세, ${how} 생을 마친 유진은`, X, 300);

  // 꼬리표
  let y = 340;
  if (special) pill(ctx, X, y, "특수 엔딩", C.gold);
  else if (e.mod && e.modId !== "ordinary") pill(ctx, X, y, e.mod, C.accent);
  else y -= 70;

  // 제목
  ctx.fillStyle = C.text;
  ctx.font = font(92, 900);
  const title = special ? e.title : `${e.job} 유진`;
  const tl = wrap(ctx, title, W - X * 2, 3);
  y += 170;
  for (const l of tl) {
    ctx.fillText(l, X, y);
    y += 110;
  }
  if (special && e.specialText) {
    ctx.fillStyle = C.sub;
    ctx.font = font(34, 600);
    for (const l of wrap(ctx, e.specialText, W - X * 2, 3)) {
      ctx.fillText(l, X, y - 30);
      y += 50;
    }
    y += 10;
  }

  // 숫자 세 칸
  const boxY = Math.max(y + 10, 600);
  const cells: [string, string][] = [
    ["수명", `${e.age}세`],
    ["남긴 재산", won(e.netWorth, true)],
    ["장례식 조문객", `${e.mourners.toLocaleString("ko-KR")}명`],
  ];
  const cw = (W - X * 2 - 32) / 3;
  cells.forEach(([k, v], i) => {
    const cx = X + i * (cw + 16);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.roundRect(cx, boxY, cw, 150, 28);
    ctx.fill();
    ctx.fillStyle = C.dim;
    ctx.font = font(28, 700);
    ctx.fillText(k, cx + 28, boxY + 52);
    ctx.fillStyle = C.text;
    ctx.font = font(48, 900);
    ctx.fillText(wrap(ctx, v, cw - 40, 1)[0], cx + 28, boxY + 118);
  });

  // 인생 그래프(행복·순자산)
  const gy = boxY + 190;
  const gh = 170;
  const rows = run.hist ?? [];
  if (rows.length > 1) {
    const maxAge = Math.max(1, rows[rows.length - 1][0]);
    const nets = rows.map((r) => r[6] ?? 0);
    const nMin = Math.min(0, ...nets);
    const nMax = Math.max(1, ...nets);
    const gx = (a: number) => X + (a / maxAge) * (W - X * 2);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X, gy + gh);
    ctx.lineTo(W - X, gy + gh);
    ctx.stroke();
    const plot = (val: (r: number[]) => number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      rows.forEach((r, i) => {
        const px = gx(r[0]);
        const py = gy + gh - val(r) * gh;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.stroke();
    };
    plot((r) => (r[6] - nMin) / (nMax - nMin), C.gold);
    plot((r) => r[4] / 100, C.pink);
    ctx.font = font(26, 700);
    ctx.fillStyle = C.pink;
    ctx.fillText("● 행복", X, gy + gh + 48);
    ctx.fillStyle = C.gold;
    ctx.fillText("● 재산", X + 140, gy + gh + 48);
  }
  let by = gy + gh + 130;

  // 방송 이력 한 줄(버튜버 루트)
  const b = run.broadcast;
  if (b) {
    const bits = [b.title, b.concept, b.nick[0], b.donated ? `후원 ${b.donated.toLocaleString("ko-KR")}P` : null].filter(Boolean).join(" · ");
    ctx.fillStyle = C.pink;
    ctx.font = font(30, 800);
    ctx.fillText(wrap(ctx, `방송 · ${bits}`, W - X * 2, 1)[0], X, Math.min(by, H - 150));
    by += 60;
  }

  // 꼬리말
  ctx.fillStyle = C.dim;
  ctx.font = font(28, 700);
  ctx.fillText("유진 팬보드 · eugene4lpha.com", X, H - 80);

  return new Promise((ok, bad) => cv.toBlob((bl) => (bl ? ok(bl) : bad(new Error("toBlob"))), "image/png"));
}

// 폰에선 공유 시트(지원하면), 아니면 파일로 저장
export async function shareOrSave(run: Run) {
  const blob = await drawShareCard(run);
  const name = `유진키우기_${run.worldNo ?? "test"}.png`;
  const file = new File([blob], name, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
    try {
      await nav.share({ files: [file], title: "유진 키우기" });
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
