// 방송 알림(웹 푸시) — 0065_push_notifications.sql.
//
// 사이트(로그인 세션)에서 부름:
//   POST { action: "subscribe", subscription: { endpoint, keys: { p256dh, auth } } } → { ok }
//   POST { action: "unsubscribe", endpoint }                                        → { ok }
//   POST { action: "status", endpoint }                                             → { subscribed }
//   POST { action: "test" }  (관리자)  → 관리자 본인 기기로만 테스트 알림            → { sent, removed }
// DB 트리거(broadcast_sessions에 새 방송이 들어올 때, x-push-key 헤더)에서 부름:
//   POST { action: "live", openDate }  → 알림 켠 모든 기기로 "방송 시작" 알림(방송마다 한 번)
//
// PUSH_PUBLIC = false면 관리자 계정만 알림을 켤 수 있음(테스트용). 2026-10 공개(true) — 사이트의 PWA_PUBLIC과 같이 맞출 것.
// 오류: 400 invalid_* / 401 unauthorized / 403 forbidden|not_open

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";
import { sendPush, type VapidKeys } from "../_shared/webpush.ts";

const PUSH_PUBLIC = true;
const MAX_PER_USER = 10; // 한 사람이 알림 켤 수 있는 기기 수
const LIVE_URL = `https://chzzk.naver.com/live/${OWNER_CHANNEL_ID}`;

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

async function getSecret(admin: Admin, name: string): Promise<string | null> {
  const { data } = await admin.from("app_secrets").select("value").eq("name", name).maybeSingle();
  return data?.value ?? null;
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function validEndpoint(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 1000) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}
const validKey = (v: unknown, min: number, max: number) => typeof v === "string" && v.length >= min && v.length <= max && /^[A-Za-z0-9_-]+=*$/.test(v);

// 여러 기기에 보내기 — 없어진 구독(404/410)은 지움
async function deliver(admin: Admin, rows: { id: number; endpoint: string; p256dh: string; auth: string }[], payload: unknown) {
  const raw = await getSecret(admin, "vapid_keys");
  if (!raw) throw new Error("vapid_keys 없음");
  const keys = JSON.parse(raw) as VapidKeys;
  let sent = 0;
  const gone: number[] = [];
  const ok: number[] = [];
  for (let i = 0; i < rows.length; i += 20) {
    await Promise.all(rows.slice(i, i + 20).map(async (r) => {
      try {
        const status = await sendPush(r, payload, keys, { ttl: 1800, urgency: "high", topic: "live" });
        if (status === 404 || status === 410) gone.push(r.id);
        else if (status >= 200 && status < 300) { sent++; ok.push(r.id); }
        else console.error(`push 실패 ${status} ${new URL(r.endpoint).host}`);
      } catch (err) {
        console.error(`push 오류 ${new URL(r.endpoint).host}: ${err instanceof Error ? err.message : err}`);
      }
    }));
  }
  if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);
  if (ok.length) await admin.from("push_subscriptions").update({ last_sent_at: new Date().toISOString() }).in("id", ok);
  return { sent, removed: gone.length, total: rows.length };
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => ({}));

  try {
    const admin = getAdmin();

    // DB 트리거 → 방송 시작 알림
    if (body.action === "live") {
      const given = req.headers.get("x-push-key") ?? "";
      const key = await getSecret(admin, "push_key");
      if (!key || !sameString(given, key)) return json({ error: "forbidden" }, 403);
      const openDate = typeof body.openDate === "string" ? body.openDate.slice(0, 40) : "";
      if (!openDate) return json({ error: "invalid_open_date" }, 400);
      // 방송마다 한 번만(동시에 두 번 불려도 notified_at을 먼저 채운 쪽만 보냄)
      const { data: claimed } = await admin
        .from("broadcast_sessions")
        .update({ notified_at: new Date().toISOString() })
        .eq("open_date", openDate)
        .is("notified_at", null)
        .is("closed_at", null)
        .select("title");
      if (!claimed || claimed.length === 0) return json({ ok: true, skipped: true });
      const title = (claimed[0].title || "").trim();
      const { data: rows, error } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth");
      if (error) throw new Error(`push_subscriptions 조회 실패: ${error.message}`);
      const result = await deliver(admin, rows ?? [], {
        title: "유진 방송 시작!",
        body: title || "지금 방송 중이에요. 놀러 오세요!",
        url: LIVE_URL,
        tag: "live",
      });
      return json({ ok: true, ...result });
    }

    const session = await requireSession(req);
    if (!session) return json({ error: "unauthorized" }, 401);
    const me = session.channelId;
    const isAdmin = me === OWNER_CHANNEL_ID;

    if (body.action === "subscribe") {
      if (!PUSH_PUBLIC && !isAdmin) return json({ error: "not_open" }, 403);
      const sub = body.subscription ?? {};
      if (!validEndpoint(sub.endpoint)) return json({ error: "invalid_endpoint" }, 400);
      if (!validKey(sub.keys?.p256dh, 80, 100) || !validKey(sub.keys?.auth, 16, 30)) return json({ error: "invalid_keys" }, 400);
      const { data: user } = await admin.from("users").select("banned").eq("channel_id", me).maybeSingle();
      if (!user) return json({ error: "unauthorized" }, 401);
      if (user.banned) return json({ error: "forbidden" }, 403);
      const { count } = await admin.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("channel_id", me).neq("endpoint", sub.endpoint);
      if ((count ?? 0) >= MAX_PER_USER) return json({ error: "too_many_devices" }, 400);
      const ua = (req.headers.get("user-agent") ?? "").slice(0, 300);
      const { error } = await admin.from("push_subscriptions").upsert(
        { channel_id: me, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: ua },
        { onConflict: "endpoint" },
      );
      if (error) throw new Error(`구독 저장 실패: ${error.message}`);
      return json({ ok: true });
    }

    if (body.action === "unsubscribe") {
      if (!validEndpoint(body.endpoint)) return json({ error: "invalid_endpoint" }, 400);
      await admin.from("push_subscriptions").delete().eq("endpoint", body.endpoint).eq("channel_id", me);
      return json({ ok: true });
    }

    if (body.action === "status") {
      if (!validEndpoint(body.endpoint)) return json({ subscribed: false });
      const { count } = await admin.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("endpoint", body.endpoint).eq("channel_id", me);
      return json({ subscribed: (count ?? 0) > 0 });
    }

    if (body.action === "test") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      const { data: rows, error } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("channel_id", me);
      if (error) throw new Error(`push_subscriptions 조회 실패: ${error.message}`);
      const result = await deliver(admin, rows ?? [], {
        title: "유진 방송 시작! (테스트)",
        body: "방송 알림 테스트예요. 누르면 치지직 방송 페이지로 가요.",
        url: LIVE_URL,
        tag: "test",
      });
      return json({ ok: true, ...result });
    }

    return json({ error: "invalid_action" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "push_failed" }, 500);
  }
});
