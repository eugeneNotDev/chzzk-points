// 후원 자동 적립 중계 — 방송 PC 프로그램(tools/donation-relay)만 부르는 함수.
//
// 방송 PC 프로그램은 치지직 토큰도, DB 열쇠도 없이 "중계 비밀번호" 하나만 가짐(X-Relay-Secret 헤더).
// 치지직 토큰(유진님 계정)은 여기 서버(streamer_tokens)에만 있고, 적립 판단도 DB 함수(record_donation)가 함.
// 비밀번호 원문은 서버에 안 두고 SHA-256 해시만 app_secrets(donation_relay_secret_sha256)에 둠.
//
// POST { action: "session" }                  → { url }  치지직 후원 알림 소켓 주소(유진님 토큰으로 발급)
// POST { action: "subscribe", sessionKey }    → { ok: true }  그 소켓에 후원 이벤트 구독
// POST { action: "donation", eventKey, donation: { channelId, donatorChannelId, donatorNickname,
//        payAmount, donationType, donationText } }
//                                             → { status, points, ... }  (0046_donation_points.sql 참고)
// 오류: 401 unauthorized(비밀번호 틀림) / 409 no_streamer_token(유진님이 사이트에 한 번 로그인해야 함)
//       / 502 chzzk_failed(치지직 쪽 오류)
//
// 치지직 토큰: access 1일 / refresh 30일, refresh는 일회용이라 갱신할 때마다 새 값으로 바꿔 저장함.
// 방송을 30일 넘게 안 하면 refresh도 만료되니, 그땐 유진님이 사이트에 다시 로그인하면 됨.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

const CHZZK_API = "https://openapi.chzzk.naver.com";
const REFRESH_MARGIN_MS = 60 * 60 * 1000; // 만료 1시간 전부터 미리 갱신

type Admin = ReturnType<typeof getAdminClient>;

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, serviceRoleKey);
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function checkSecret(admin: Admin, req: Request): Promise<boolean> {
  const given = req.headers.get("x-relay-secret") ?? "";
  if (given.length < 20) return false;
  const { data } = await admin.from("app_secrets").select("value").eq("name", "donation_relay_secret_sha256").maybeSingle();
  if (!data?.value) return false;
  return sameString(await sha256Hex(given), data.value);
}

// 유진님 치지직 access token(필요하면 refresh). 토큰이 없으면 null.
async function getAccessToken(admin: Admin): Promise<string | null> {
  const { data: row, error } = await admin
    .from("streamer_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("channel_id", OWNER_CHANNEL_ID)
    .maybeSingle();
  if (error) throw new Error(`streamer_tokens 조회 실패: ${error.message}`);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() - Date.now() > REFRESH_MARGIN_MS) return row.access_token;

  const clientId = Deno.env.get("CHZZK_CLIENT_ID");
  const clientSecret = Deno.env.get("CHZZK_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("CHZZK_CLIENT_ID / CHZZK_CLIENT_SECRET 환경변수가 없습니다.");
  const res = await fetch(`${CHZZK_API}/auth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grantType: "refresh_token", refreshToken: row.refresh_token, clientId, clientSecret }),
  });
  const body = await res.json().catch(() => null);
  const content = body?.content;
  if (!res.ok || typeof content?.accessToken !== "string" || typeof content?.refreshToken !== "string") {
    console.error(`치지직 토큰 갱신 실패 (status ${res.status})`);
    return null; // refresh도 만료 → 유진님 재로그인 필요
  }
  const expiresIn = Number(content.expiresIn ?? 86400);
  // refresh_token이 일회용이라, 저장할 때 "갱신에 쓴 옛 값"과 같은 행만 바꿈(동시에 두 번 갱신되는 것 방지).
  const { error: saveError } = await admin
    .from("streamer_tokens")
    .update({
      access_token: content.accessToken,
      refresh_token: content.refreshToken,
      expires_at: new Date(Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 86400) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("channel_id", OWNER_CHANNEL_ID)
    .eq("refresh_token", row.refresh_token);
  if (saveError) throw new Error(`streamer_tokens 갱신 저장 실패: ${saveError.message}`);
  return content.accessToken;
}

async function chzzkCall(path: string, accessToken: string, method = "GET") {
  const res = await fetch(`${CHZZK_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`치지직 API 실패 ${method} ${path.split("?")[0]} (status ${res.status})`);
    return null;
  }
  return body?.content ?? {};
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" ? v.slice(0, max) : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const admin = getAdminClient();
    if (!(await checkSecret(admin, req))) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));

    if (body.action === "session" || body.action === "subscribe") {
      const token = await getAccessToken(admin);
      if (!token) return json({ error: "no_streamer_token" }, 409);

      if (body.action === "session") {
        const content = await chzzkCall("/open/v1/sessions/auth", token);
        if (!content || typeof content.url !== "string") return json({ error: "chzzk_failed" }, 502);
        return json({ url: content.url }, 200);
      }

      const sessionKey = str(body.sessionKey, 200);
      if (!sessionKey) return json({ error: "invalid_session_key" }, 400);
      const content = await chzzkCall(
        `/open/v1/sessions/events/subscribe/donation?sessionKey=${encodeURIComponent(sessionKey)}`,
        token,
        "POST",
      );
      if (!content) return json({ error: "chzzk_failed" }, 502);
      return json({ ok: true }, 200);
    }

    if (body.action === "donation") {
      const eventKey = str(body.eventKey, 100);
      const d = body.donation ?? {};
      const amount = Number(d.payAmount);
      if (!eventKey || !Number.isFinite(amount) || amount < 0) return json({ error: "invalid_donation" }, 400);
      // 유진님 채널 후원만 받음(다른 채널 이벤트가 섞여 들어오는 일은 없지만 한 번 더 확인).
      if (typeof d.channelId === "string" && d.channelId !== OWNER_CHANNEL_ID) {
        return json({ error: "wrong_channel" }, 400);
      }
      const { data, error } = await admin.rpc("record_donation", {
        p_event_key: eventKey,
        p_donator_channel_id: str(d.donatorChannelId, 100),
        p_donator_nickname: str(d.donatorNickname, 100),
        p_amount: Math.trunc(amount),
        p_donation_type: str(d.donationType, 20),
        p_message: str(d.donationText, 500),
      });
      if (error) throw new Error(`record_donation 실패: ${error.message}`);
      return json(data, 200);
    }

    return json({ error: "unknown_action" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "relay_failed" }, 500);
  }
});
