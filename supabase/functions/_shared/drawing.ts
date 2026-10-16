// 그림 후원 공용 코드(0067_drawing_donations.sql) — drawings(시청자·관리자)와 donation-relay(후원 들어올 때)가 같이 씀.

import { broadcastToOverlay } from "./stream-code.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

export const DRAWING_MIN_AMOUNT = 3000;      // 이 금액(치즈) 이상 후원해야 그림이 뜸
export const DRAWING_SHOW_SECONDS = 10;      // 오버레이에 떠 있는 시간
export const DRAWING_EXPIRE_HOURS = 24;      // 코드 유효 시간
export const DRAWING_BUCKET = "drawings";
// 코드 글자 — 헷갈리는 0/O, 1/I/L 뺌
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

export function drawingUrl(path: string) {
  return `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${DRAWING_BUCKET}/${path}`;
}

// 후원 메시지에서 코드 후보 뽑기 — 대소문자·띄어쓰기·하이픈 섞여도 찾게(예: "k7q2 mx 그림이요")
export function codeCandidates(message: string | null | undefined): string[] {
  if (!message) return [];
  const up = message.toUpperCase().slice(0, 500);
  const out = new Set<string>();
  const ok = (w: string) => w.length === CODE_LENGTH && [...w].every((c) => CODE_ALPHABET.includes(c));
  // 1) 띄어쓰기로 나뉜 6글자 덩어리 2) 띄어쓰기·하이픈을 뺀 글자열에서 6글자씩(코드를 "K7Q 2MX"처럼 나눠 쓴 경우)
  for (const tok of up.split(/[^A-Z0-9]+/)) if (ok(tok)) out.add(tok);
  const squashed = up.replace(/[^A-Z0-9]/g, "");
  for (let i = 0; i + CODE_LENGTH <= squashed.length && out.size < 200; i++) {
    const w = squashed.slice(i, i + CODE_LENGTH);
    if (ok(w)) out.add(w);
  }
  return [...out];
}

// 후원 한 건에 그림 코드가 있으면 처리. 결과: null(코드 없음) | { code, status: "shown"|"short"|"expired"|"used" }
export async function matchDrawingDonation(
  admin: Admin,
  d: { eventKey: string; message: string | null; amount: number; nickname: string | null; anonymous: boolean },
) {
  const cands = codeCandidates(d.message);
  if (!cands.length) return null;
  const { data: rows } = await admin
    .from("drawings")
    .select("id, code, status, expires_at, image_path, donation_event_key")
    .in("code", cands)
    .order("created_at", { ascending: false })
    .limit(5);
  const row = (rows ?? [])[0];
  if (!row) return null;
  if (row.donation_event_key === d.eventKey) return { code: row.code, status: "duplicate" }; // 같은 후원 재전송
  if (row.status !== "pending") return { code: row.code, status: "used" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { code: row.code, status: "expired" };
  if (d.amount < DRAWING_MIN_AMOUNT) {
    await admin.from("drawings").update({ last_short_amount: d.amount }).eq("id", row.id);
    return { code: row.code, status: "short" };
  }
  const nickname = d.anonymous ? null : (d.nickname ?? "").slice(0, 40) || null;
  const { data: upd } = await admin
    .from("drawings")
    .update({ status: "shown", shown_at: new Date().toISOString(), donation_event_key: d.eventKey, donation_amount: d.amount, donator_nickname: nickname })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id");
  if (!upd?.length) return { code: row.code, status: "used" }; // 동시에 다른 후원이 먼저 씀
  await broadcastToOverlay(admin, "drawing", {
    id: row.id,
    url: drawingUrl(row.image_path),
    nickname,
    amount: d.amount,
    seconds: DRAWING_SHOW_SECONDS,
  });
  return { code: row.code, status: "shown" };
}
