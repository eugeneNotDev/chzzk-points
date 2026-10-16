// 그림 후원(0067_drawing_donations.sql) — 시청자 그리기 페이지와 관리자 "그림 후원" 탭이 부름.
//
// 전부 POST { action, ... }, 로그인 필수.
// create       { image: "data:image/webp;base64,..." }  → { code, expiresAt, minAmount }
//              그림 저장 + 코드 발급. 기다리는 중인 그림은 한 사람당 3개까지, 30초에 하나.
// mine         {}                                       → { items: [{ id, code, status, url, expiresAt, createdAt, shownAt, shortAmount }], minAmount }
//              status: pending | shown | hidden | expired(pending인데 시간 지남)
// admin-list   {}                                       → { items: [...그린 사람·후원자 포함] }   (관리자)
// admin-hide   { id }                                   → { ok }  화면에서 즉시 끄기 + 다시 못 쓰게   (관리자)
// admin-block  { channelId, blocked }                   → { ok }  이 사람 그림 후원 막기/풀기       (관리자)
// 오류: 400 invalid_* / 401 unauthorized / 403 forbidden|banned|blocked / 413 too_large / 429 too_fast|too_many

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";
import { broadcastToOverlay } from "../_shared/stream-code.ts";
import { CODE_ALPHABET, CODE_LENGTH, DRAWING_BUCKET, DRAWING_EXPIRE_HOURS, DRAWING_MIN_AMOUNT, drawingUrl } from "../_shared/drawing.ts";

const MAX_BYTES = 1024 * 1024;
const MAX_PENDING = 3;
const COOLDOWN_MS = 30_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function getAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, key);
}
type Admin = ReturnType<typeof getAdmin>;

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
    url: drawingUrl(r.image_path),
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
  const session = await requireSession(req);
  if (!session) return json({ error: "unauthorized" }, 401);
  const me = session.channelId;
  const isAdmin = me === OWNER_CHANNEL_ID;
  const body = await req.json().catch(() => ({}));
  try {
    const admin = getAdmin();
    const { data: user } = await admin.from("users").select("channel_id, banned, drawing_blocked").eq("channel_id", me).maybeSingle();
    if (!user) return json({ error: "unauthorized" }, 401);
    if (user.banned) return json({ error: "banned" }, 403);

    if (body.action === "create") return await create(admin, me, user.drawing_blocked, body);
    if (body.action === "mine") {
      const { data } = await admin.from("drawings").select("*").eq("channel_id", me).order("created_at", { ascending: false }).limit(10);
      return json({ items: (data ?? []).map((r) => view(r)), minAmount: DRAWING_MIN_AMOUNT });
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
  const m = typeof body.image === "string" ? /^data:image\/(webp|png);base64,([A-Za-z0-9+/=]+)$/.exec(body.image) : null;
  if (!m) return json({ error: "invalid_image" }, 400);
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length > MAX_BYTES) return json({ error: "too_large" }, 413);
  if (bytes.length < 200) return json({ error: "invalid_image" }, 400);

  const { data: recent } = await admin.from("drawings").select("created_at, status, expires_at").eq("channel_id", me).order("created_at", { ascending: false }).limit(10);
  if (recent?.[0] && Date.now() - new Date(recent[0].created_at).getTime() < COOLDOWN_MS) return json({ error: "too_fast" }, 429);
  const waiting = (recent ?? []).filter((r) => r.status === "pending" && new Date(r.expires_at).getTime() > Date.now()).length;
  if (waiting >= MAX_PENDING) return json({ error: "too_many" }, 429);

  const ext = m[1];
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage.from(DRAWING_BUCKET).upload(path, bytes, { contentType: `image/${ext}`, upsert: false });
  if (upErr) throw new Error(`그림 업로드 실패: ${upErr.message}`);

  const expiresAt = new Date(Date.now() + DRAWING_EXPIRE_HOURS * 3600_000).toISOString();
  // 코드가 겹치면(아주 드묾) 다시 뽑음
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const { error } = await admin.from("drawings").insert({ code, channel_id: me, image_path: path, expires_at: expiresAt });
    if (!error) return json({ code, expiresAt, minAmount: DRAWING_MIN_AMOUNT });
    if (error.code !== "23505") throw new Error(`drawings insert 실패: ${error.message}`);
  }
  throw new Error("코드 발급 실패(겹침)");
}
