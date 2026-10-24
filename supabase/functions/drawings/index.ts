// 그림 후원(0067_drawing_donations.sql) — 시청자 그리기 페이지와 관리자 "그림 후원" 탭이 부름.
//
// 전부 POST { action, ... }, 로그인 필수.
// create       { image: "data:image/webp;base64,...", strokes?: "[...획 기록 JSON...]" }  → { code, expiresAt, minAmount }
//              그림 저장 + 코드 발급. 30초에 하나. 아직 후원 안 한 이전 코드(그림)는 지움 — 기다리는 코드는 한 사람당 하나.
//              strokes(선택): 오버레이가 그림이 그려지는 모습을 다시 보여줄 때 쓰는 획 순서 — 없거나 이상하면 그림만 띄움.
//              오래된 그림 파일은 알아서 정리(아래 cleanup) — 정리된 그림은 url이 null.
// mine         {}                                       → { items: [{ id, code, status, url, expiresAt, createdAt, shownAt, shortAmount }], minAmount }
//              status: pending | shown | hidden | expired(pending인데 시간 지남)
// admin-list   {}                                       → { items: [...그린 사람·후원자 포함] }   (관리자)
// admin-hide   { id }                                   → { ok }  화면에서 즉시 끄기 + 다시 못 쓰게   (관리자)
// admin-block  { channelId, blocked }                   → { ok }  이 사람 그림 후원 막기/풀기       (관리자)
// screen       { key, image: "data:image/webp;base64,..." }  → { ok, live }   (로그인 대신 오버레이 키 — OBS 오버레이 전용)
//              방송 화면 캡쳐(작은 크기)를 파일 하나(screen/live.webp)에 덮어써서, 그림판이 배경으로 보여줌(그림도네처럼).
//              방송 중이 아니면 저장하지 않고 파일을 지움(live: false → 오버레이는 천천히 다시 물어봄).
// 오류: 400 invalid_* / 401 unauthorized / 403 forbidden|banned|blocked / 413 too_large / 429 too_fast

import { getAdminClient, type Admin } from "../_shared/db.ts";
import { json } from "../_shared/http.ts";
import { handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";
import { broadcastToOverlay, getOverlayKey, sameString } from "../_shared/stream-code.ts";
import { isChannelLive } from "../_shared/live.ts";
import { CODE_ALPHABET, CODE_LENGTH, DRAWING_BUCKET, DRAWING_EXPIRE_HOURS, DRAWING_MIN_AMOUNT, drawingUrl } from "../_shared/drawing.ts";

const MAX_BYTES = 1024 * 1024;
const SCREEN_PATH = "screen/live.webp";
const SCREEN_MAX_BYTES = 300 * 1024;
const SCREEN_MIN_GAP_MS = 4000; // 캡쳐는 10초마다 오는데, 혹시 몰라 4초보다 자주 오면 무시
let lastScreenAt = 0;
const MAX_STROKES_BYTES = 1536 * 1024;

// 획 기록 검사 — [{c:"#rrggbb", w:굵기, p:[x,y,...]} | {k:"clear"}], 좌표는 960×540 안
function cleanStrokes(v: unknown): string | null {
  if (typeof v !== "string" || !v || v.length > MAX_STROKES_BYTES) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(v);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || !arr.length || arr.length > 5000) return null;
  const out = [];
  for (const o of arr) {
    if (o && o.k === "clear") {
      out.push({ k: "clear" });
      continue;
    }
    if (!o || typeof o.c !== "string" || !/^#[0-9a-fA-F]{6}$/.test(o.c)) return null;
    const w = Number(o.w);
    if (!Number.isFinite(w) || w < 1 || w > 80) return null;
    if (!Array.isArray(o.p) || o.p.length < 2 || o.p.length % 2) return null;
    const p: number[] = [];
    for (let i = 0; i < o.p.length; i += 2) {
      const x = Math.round(Number(o.p[i]));
      const y = Math.round(Number(o.p[i + 1]));
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < -50 || x > 1010 || y < -50 || y > 590) return null;
      p.push(x, y);
    }
    // e: 1 = 지우개(그 자리를 투명하게 지움)
    out.push(o.e === 1 ? { c: o.c.toLowerCase(), w, p, e: 1 } : { c: o.c.toLowerCase(), w, p });
  }
  return JSON.stringify(out);
}
const COOLDOWN_MS = 30_000;
const KEEP_DAYS = 180; // 방송에 나간 그림(최종 이미지)은 6개월 보관 뒤 삭제(0068_drawings_purge.sql)
const STROKES_KEEP_MS = 5 * 60_000; // 획 기록은 오버레이가 다시 그리는 데만 써서 방송에 뜨고 5분 뒤 삭제
const CLEANUP_EVERY_MS = 10 * 60_000;
let lastCleanup = 0;

// deno-lint-ignore no-explicit-any
const filesOf = (rows: any[]) => rows.flatMap((r) => [r.image_path, r.strokes_path].filter(Boolean) as string[]);

// 그림 파일 정리 — 저장 공간 아끼려고. 함수가 불릴 때 10분에 한 번씩, 종류마다 한 번에 50장까지.
//  ① 코드 받고 24시간 안에 후원 안 한 그림: 파일·기록 다 삭제
//  ② 방송에 나간 그림의 획 기록: 뜨고 5분 뒤 삭제(최종 이미지는 남김)
//  ③ 방송에 나간 그림의 최종 이미지: 6개월 뒤 삭제(기록 줄은 남김 — 누가 언제 얼마 후원했는지)
async function cleanup(admin: Admin) {
  if (Date.now() - lastCleanup < CLEANUP_EVERY_MS) return;
  lastCleanup = Date.now();
  const now = new Date().toISOString();
  const store = admin.storage.from(DRAWING_BUCKET);
  try {
    const { data: expired } = await admin.from("drawings").select("id, image_path, strokes_path").eq("status", "pending").lt("expires_at", now).limit(50);
    if (expired?.length) {
      await store.remove(filesOf(expired));
      await admin.from("drawings").delete().in("id", expired.map((r) => r.id)).eq("status", "pending");
    }
    const strokesBefore = new Date(Date.now() - STROKES_KEEP_MS).toISOString();
    const { data: done } = await admin.from("drawings").select("id, strokes_path").neq("status", "pending").not("strokes_path", "is", null).lt("shown_at", strokesBefore).limit(50);
    if (done?.length) {
      await store.remove(done.map((r) => r.strokes_path as string));
      await admin.from("drawings").update({ strokes_path: null }).in("id", done.map((r) => r.id));
    }
    const keepBefore = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString();
    const { data: old } = await admin.from("drawings").select("id, image_path, strokes_path").neq("status", "pending").is("purged_at", null).lt("shown_at", keepBefore).limit(50);
    if (old?.length) {
      await store.remove(filesOf(old));
      await admin.from("drawings").update({ purged_at: now, strokes_path: null }).in("id", old.map((r) => r.id));
    }
  } catch (e) {
    console.error(`그림 정리 실패: ${e instanceof Error ? e.message : e}`);
  }
}

function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

// deno-lint-ignore no-explicit-any
function view(r: any, withWho = false) {
  const expired = r.status === "pending" && new Date(r.expires_at).getTime() < Date.now();
  return {
    id: r.id,
    code: r.code,
    status: expired ? "expired" : r.status,
    url: r.purged_at ? null : drawingUrl(r.image_path), // 정리된 그림은 파일이 없음
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    shownAt: r.shown_at,
    shortAmount: r.status === "pending" ? r.last_short_amount : null,
    ...(withWho ? { channelId: r.channel_id, drawer: r.users?.channel_name ?? null, drawerBlocked: !!r.users?.drawing_blocked, donator: r.donator_nickname, amount: r.donation_amount, hiddenAt: r.hidden_at } : {}),
  };
}

Deno.serve(async (req: Request) => {
  const pre = handleCors(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => ({}));
  // 방송 화면 캡쳐 — 로그인 없이 오버레이 키로
  if (body.action === "screen") {
    try {
      return await screen(getAdminClient(), body);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      return json({ error: "drawings_failed" }, 500);
    }
  }
  const session = await requireSession(req);
  if (!session) return json({ error: "unauthorized" }, 401);
  const me = session.channelId;
  const isAdmin = me === OWNER_CHANNEL_ID;
  try {
    const admin = getAdminClient();
    const { data: user, error: uErr } = await admin.from("users").select("channel_id, banned, drawing_blocked").eq("channel_id", me).maybeSingle();
    // 조회 자체가 실패한 건(예: DB 변경 전) 서버 문제 — 401로 답하면 사이트가 로그아웃시켜 버려서 500으로
    if (uErr) throw new Error(`users 조회 실패: ${uErr.message}`);
    if (!user) return json({ error: "unauthorized" }, 401);
    if (user.banned) return json({ error: "banned" }, 403);

    await cleanup(admin);
    if (body.action === "create") return await create(admin, me, user.drawing_blocked, body);
    if (body.action === "mine") {
      const { data } = await admin.from("drawings").select("*").eq("channel_id", me).order("created_at", { ascending: false }).limit(20);
      // 만료된 코드는 곧 지워질 거라 목록에서 뺌
      const items = (data ?? []).map((r) => view(r)).filter((i) => i.status !== "expired");
      return json({ items, minAmount: DRAWING_MIN_AMOUNT });
    }
    if (!isAdmin) return json({ error: "forbidden" }, 403);
    if (body.action === "admin-list") {
      const { data, error } = await admin
        .from("drawings")
        .select("*, users!drawings_channel_id_fkey(channel_name, drawing_blocked)")
        .neq("status", "pending")
        .order("shown_at", { ascending: false, nullsFirst: false })
        .limit(30);
      if (error) throw new Error(`drawings 조회 실패: ${error.message}`);
      return json({ items: (data ?? []).map((r) => view(r, true)) });
    }
    if (body.action === "admin-hide") {
      const id = Number(body.id);
      if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "invalid_id" }, 400);
      const { error } = await admin.from("drawings").update({ status: "hidden", hidden_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(`drawings 끄기 실패: ${error.message}`);
      await broadcastToOverlay(admin, "drawing-hide", { id });
      return json({ ok: true });
    }
    if (body.action === "admin-block") {
      if (typeof body.channelId !== "string" || !body.channelId) return json({ error: "invalid_channel" }, 400);
      const { error } = await admin.from("users").update({ drawing_blocked: !!body.blocked }).eq("channel_id", body.channelId);
      if (error) throw new Error(`drawing_blocked 변경 실패: ${error.message}`);
      return json({ ok: true });
    }
    return json({ error: "invalid_action" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "drawings_failed" }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function create(admin: Admin, me: string, blocked: boolean, body: any) {
  if (blocked) return json({ error: "blocked" }, 403);
  // 그림 후원은 방송 중에만(방송 화면 위에 그리는 거라). 스트리머 계정은 시험해볼 수 있게 예외.
  if (me !== OWNER_CHANNEL_ID && !(await isChannelLive())) return json({ error: "not_live" }, 403);
  const m = typeof body.image === "string" ? /^data:image\/(webp|png);base64,([A-Za-z0-9+/=]+)$/.exec(body.image) : null;
  if (!m) return json({ error: "invalid_image" }, 400);
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length > MAX_BYTES) return json({ error: "too_large" }, 413);
  // 배경이 투명이라 점 하나만 찍은 그림은 파일이 아주 작음 — 깨진 데이터만 걸러냄
  if (bytes.length < 40) return json({ error: "invalid_image" }, 400);

  const { data: recent } = await admin.from("drawings").select("created_at").eq("channel_id", me).order("created_at", { ascending: false }).limit(1);
  if (recent?.[0] && Date.now() - new Date(recent[0].created_at).getTime() < COOLDOWN_MS) return json({ error: "too_fast" }, 429);

  const ext = m[1];
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage.from(DRAWING_BUCKET).upload(path, bytes, { contentType: `image/${ext}`, upsert: false });
  if (upErr) throw new Error(`그림 업로드 실패: ${upErr.message}`);
  // 획 기록(있으면) — 그림 옆에 같은 이름 .json으로. 저장 못 해도 그림 후원은 그대로 진행(오버레이가 그림만 띄움)
  let strokesPath: string | null = null;
  const strokes = cleanStrokes(body.strokes);
  if (strokes) {
    const sp = path.replace(/\.(webp|png)$/, ".json");
    const { error: sErr } = await admin.storage.from(DRAWING_BUCKET).upload(sp, new TextEncoder().encode(strokes), { contentType: "application/json", upsert: false });
    if (sErr) console.error(`획 기록 업로드 실패: ${sErr.message}`);
    else strokesPath = sp;
  }

  // 새 코드를 받으면 아직 후원 안 한 이전 코드(그림)는 지움 — 한 사람당 기다리는 코드는 하나
  const { data: prev } = await admin.from("drawings").select("id, image_path, strokes_path").eq("channel_id", me).eq("status", "pending");
  if (prev?.length) {
    const { data: gone } = await admin.from("drawings").delete().in("id", prev.map((r) => r.id)).eq("status", "pending").select("id, image_path, strokes_path");
    if (gone?.length) await admin.storage.from(DRAWING_BUCKET).remove(filesOf(gone));
  }

  const expiresAt = new Date(Date.now() + DRAWING_EXPIRE_HOURS * 3600_000).toISOString();
  // 코드가 겹치면(아주 드묾) 다시 뽑음
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const { error } = await admin.from("drawings").insert({ code, channel_id: me, image_path: path, strokes_path: strokesPath, expires_at: expiresAt });
    if (!error) return json({ code, expiresAt, minAmount: DRAWING_MIN_AMOUNT });
    if (error.code !== "23505") throw new Error(`drawings insert 실패: ${error.message}`);
  }
  throw new Error("코드 발급 실패(겹침)");
}

// 방송 화면 캡쳐 저장(위 screen 설명 참고)
// deno-lint-ignore no-explicit-any
async function screen(admin: Admin, body: any) {
  const key = await getOverlayKey(admin);
  if (!key || typeof body.key !== "string" || !sameString(body.key, key)) return json({ error: "unauthorized" }, 401);
  const store = admin.storage.from(DRAWING_BUCKET);
  if (!(await isChannelLive())) {
    await store.remove([SCREEN_PATH]);
    return json({ ok: true, live: false });
  }
  if (Date.now() - lastScreenAt < SCREEN_MIN_GAP_MS) return json({ ok: true, live: true });
  const m = typeof body.image === "string" ? /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/.exec(body.image) : null;
  if (!m) return json({ error: "invalid_image" }, 400);
  const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
  if (bytes.length < 100 || bytes.length > SCREEN_MAX_BYTES) return json({ error: "invalid_image" }, 400);
  lastScreenAt = Date.now();
  const { error } = await store.upload(SCREEN_PATH, bytes, { contentType: "image/webp", upsert: true, cacheControl: "5" });
  if (error) throw new Error(`방송 화면 저장 실패: ${error.message}`);
  return json({ ok: true, live: true });
}
