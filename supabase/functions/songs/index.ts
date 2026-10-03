// 방종곡 신청 리스트(0060_song_requests.sql) — 읽기/쓰기 전부 이 함수(service_role)로만 함.
//
// 전부 POST { action, ... }. list는 로그인 없이도 되고, 로그인하면 내 신청 여부·오늘 신청 가능 여부가 같이 옴.
// 신청은 무료(포인트 없음). 한 사람당 하루 1곡(한국시간 날짜) — 취소·삭제돼도 그날 기회는 다시 안 생김.
// 대기 중인 곡과 제목+가수가 같으면(대소문자·공백·기호 무시) 중복이라 막음. 틀고 나면 다시 신청 가능.
//
// list            {}                     → { items: [{id,title,artist,requester,createdAt,mine}], canRequest, requestedToday, isAdmin }
// request         { title, artist }      → { ok }      (로그인 필수, 차단 유저 불가)
// cancel          { id }                 → { ok }      (본인 대기 곡만)
// admin-played    { id }                 → { ok }      (관리자: 틀었음 → 리스트에서 빠지고 기록으로)
// admin-delete    { id }                 → { ok }      (관리자: 장난/중복 신청 삭제)
// admin-history   { q?, page? }          → { items: [{id,title,artist,requester,playedAt}], hasMore }
// admin-restore   { id }                 → { ok }      (관리자: 잘못 누른 "틀었음" 되돌리기 → 다시 대기)
// 오류: 400 invalid_* / 401 unauthorized / 403 forbidden|banned / 404 not_found / 409 duplicate|already_today

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

const MAX_TITLE = 60;
const MAX_ARTIST = 40;
const HISTORY_PAGE = 20;

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

function kstDay(ms = Date.now()) {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length >= 1 && t.length <= max ? t : null;
}

function normKey(title: string, artist: string) {
  const n = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[\s\-_.,·'"`!?~()[\]{}<>/\\:;&+]/g, "");
  return `${n(title)}|${n(artist)}`;
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const session = await requireSession(req);
  const me = session?.channelId ?? null;
  const isAdmin = me === OWNER_CHANNEL_ID;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  try {
    const admin = getAdmin();

    if (action === "list") return await list(admin, me, isAdmin);

    if (!session || !me) return json({ error: "unauthorized" }, 401);

    if (action === "admin-played" || action === "admin-delete" || action === "admin-history" || action === "admin-restore") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      if (action === "admin-history") return await history(admin, body);
      if (action === "admin-restore") return await restore(admin, body);
      return await close(admin, body, action === "admin-played" ? "played" : "deleted");
    }

    const { data: user } = await admin.from("users").select("channel_id, channel_name, banned").eq("channel_id", me).maybeSingle();
    if (!user) return json({ error: "unauthorized" }, 401);
    if (user.banned) return json({ error: "banned" }, 403);

    if (action === "request") return await requestSong(admin, body, user);
    if (action === "cancel") return await cancel(admin, body, me);
    return json({ error: "invalid_action" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "songs_failed" }, 500);
  }
});

async function list(admin: Admin, me: string | null, isAdmin: boolean) {
  const { data, error } = await admin
    .from("song_requests")
    .select("id, channel_id, title, artist, requester_name, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`song_requests 조회 실패: ${error.message}`);

  let requestedToday = false;
  if (me) {
    const { count } = await admin
      .from("song_requests")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", me)
      .eq("request_day", kstDay());
    requestedToday = (count ?? 0) > 0;
  }

  const items = (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    requester: r.requester_name,
    createdAt: r.created_at,
    mine: me !== null && r.channel_id === me,
  }));
  return json({ items, canRequest: me !== null && !requestedToday, requestedToday, isAdmin, loggedIn: me !== null });
}

async function requestSong(admin: Admin, body: Record<string, unknown>, user: { channel_id: string; channel_name: string | null }) {
  const title = cleanText(body.title, MAX_TITLE);
  const artist = cleanText(body.artist, MAX_ARTIST);
  if (!title) return json({ error: "invalid_title" }, 400);
  if (!artist) return json({ error: "invalid_artist" }, 400);
  const key = normKey(title, artist);
  if (key === "|" || key.startsWith("|") || key.endsWith("|")) return json({ error: "invalid_title" }, 400);

  const day = kstDay();
  const { count } = await admin
    .from("song_requests")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", user.channel_id)
    .eq("request_day", day);
  if ((count ?? 0) > 0) return json({ error: "already_today" }, 409);

  const dup = await findPendingDuplicate(admin, key);
  if (dup) return json({ error: "duplicate", ...dup }, 409);

  const { error } = await admin.from("song_requests").insert({
    channel_id: user.channel_id,
    requester_name: user.channel_name,
    title,
    artist,
    norm_key: key,
    request_day: day,
  });
  if (error) {
    // 동시에 두 번 눌렀거나 같은 곡이 거의 동시에 들어온 경우 — 유니크 인덱스가 막아줌.
    if (error.code === "23505") {
      if (error.message.includes("one_per_day")) return json({ error: "already_today" }, 409);
      const d = await findPendingDuplicate(admin, key);
      return json({ error: "duplicate", ...(d ?? {}) }, 409);
    }
    throw new Error(`song_requests 추가 실패: ${error.message}`);
  }
  return json({ ok: true });
}

// 중복이면 리스트에서 몇 번째인지(1부터) + 원래 곡 이름을 돌려줌.
async function findPendingDuplicate(admin: Admin, key: string) {
  const { data: same } = await admin
    .from("song_requests")
    .select("id, title, artist, created_at")
    .eq("status", "pending")
    .eq("norm_key", key)
    .maybeSingle();
  if (!same) return null;
  const { count } = await admin
    .from("song_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lte("created_at", same.created_at);
  return { position: count ?? null, title: same.title, artist: same.artist };
}

async function cancel(admin: Admin, body: Record<string, unknown>, me: string) {
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "invalid_id" }, 400);
  const { data, error } = await admin
    .from("song_requests")
    .update({ status: "cancelled", closed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("channel_id", me)
    .eq("status", "pending")
    .select("id");
  if (error) throw new Error(`취소 실패: ${error.message}`);
  if (!data || data.length === 0) return json({ error: "not_found" }, 404);
  return json({ ok: true });
}

async function close(admin: Admin, body: Record<string, unknown>, status: "played" | "deleted") {
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "invalid_id" }, 400);
  const { data, error } = await admin
    .from("song_requests")
    .update({ status, closed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) throw new Error(`상태 변경 실패: ${error.message}`);
  if (!data || data.length === 0) return json({ error: "not_found" }, 404);
  return json({ ok: true });
}

async function restore(admin: Admin, body: Record<string, unknown>) {
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "invalid_id" }, 400);
  const { data: row } = await admin.from("song_requests").select("id, norm_key, status").eq("id", id).maybeSingle();
  if (!row || row.status !== "played") return json({ error: "not_found" }, 404);
  const dup = await findPendingDuplicate(admin, row.norm_key);
  if (dup) return json({ error: "duplicate", ...dup }, 409);
  const { error } = await admin.from("song_requests").update({ status: "pending", closed_at: null }).eq("id", id).eq("status", "played");
  if (error) {
    if (error.code === "23505") return json({ error: "duplicate" }, 409);
    throw new Error(`되돌리기 실패: ${error.message}`);
  }
  return json({ ok: true });
}

async function history(admin: Admin, body: Record<string, unknown>) {
  const rawPage = Number(body.page ?? 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  // PostgREST or() 문법을 깨는 문자(, ( ) * %) 와 와일드카드는 빼고 검색.
  const q = typeof body.q === "string" ? body.q.replace(/[,()*%_\\]/g, " ").trim().slice(0, 40) : "";

  let query = admin
    .from("song_requests")
    .select("id, title, artist, requester_name, closed_at")
    .eq("status", "played");
  if (q) query = query.or(`title.ilike.*${q}*,artist.ilike.*${q}*,requester_name.ilike.*${q}*`);
  const from = (page - 1) * HISTORY_PAGE;
  const { data, error } = await query
    .order("closed_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + HISTORY_PAGE);
  if (error) throw new Error(`기록 조회 실패: ${error.message}`);

  const rows = data ?? [];
  const items = rows.slice(0, HISTORY_PAGE).map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    requester: r.requester_name,
    playedAt: r.closed_at,
  }));
  return json({ items, hasMore: rows.length > HISTORY_PAGE, page });
}
