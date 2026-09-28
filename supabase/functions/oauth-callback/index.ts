// 치지직 OAuth 콜백 처리.
//
// 요청: POST { code: string, state: string }   (docs/assets/js/chzzk-auth.js 가 호출)
// 응답: { token: string, channelId: string, channelName: string, profileImageUrl: string | null }
//   - token: 우리 서비스 전용 세션 토큰 (_shared/session.ts). 프론트가 localStorage에 저장.
//
// 흐름: code를 clientSecret과 함께 치지직 토큰 엔드포인트로 교환
//      → GET /open/v1/users/me 로 channelId/channelName 확보
//      → 채널 정보 조회(Client 인증)로 프로필 이미지 주소 확보(실패해도 로그인은 진행 — _shared/chzzk.ts)
//      → users 테이블에 upsert (service_role 클라이언트, RLS 우회)
//      → 로그인한 사람이 채널 주인(유진 알파)이면 치지직 토큰을 streamer_tokens에 저장
//        (후원 자동 적립용 — donation-relay 함수가 이걸로 후원 알림 세션을 엶. 0046_donation_points.sql)
//        시청자 토큰은 저장하지 않음(반납도 안 함 — 아래 fetchChzzkUserWithRetry 설명 참고).
//      → 세션 토큰 발급해서 리턴
// 치지직이 준 토큰이 유저 조회에서 거절(401)되면 서버에서 먼저 몇 번 다시 확인해보고(잠깐 기다렸다 재조회 →
// 토큰 갱신 후 재조회), 그래도 안 되면 409 { error: "chzzk_token_rejected" } — 프론트가 로그인을 자동 재시도.
//
// 참고: 치지직 오픈 API 응답은 전부 { code, message, content: {...} } 래퍼 구조.
//   토큰 엔드포인트: POST https://openapi.chzzk.naver.com/auth/v1/token
//   유저 조회: GET https://openapi.chzzk.naver.com/open/v1/users/me (Authorization: Bearer <accessToken>)
//
// clientSecret은 이 함수의 환경변수로만 존재해야 함 (Supabase 프로젝트 설정에서 등록).
// 절대 응답 바디나 로그에 clientSecret을 남기지 말 것.
//
// verify_jwt는 supabase/config.toml에서 이 함수만 꺼져있음 (로그인 전이라 우리 세션 토큰이 아직 없음).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { issueSessionToken } from "../_shared/session.ts";
import { fetchChzzkChannelImage } from "../_shared/chzzk.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

const CHZZK_TOKEN_URL = "https://openapi.chzzk.naver.com/auth/v1/token";
const CHZZK_USER_ME_URL = "https://openapi.chzzk.naver.com/open/v1/users/me";

// 치지직이 발급해준 토큰으로 유저 조회가 401로 거절되는 경우가 있음(재로그인할 때 번갈아 한 번씩 생김).
// 서버에서 먼저 잠깐 기다렸다 다시 조회 → 토큰 갱신(refresh) 후 다시 조회까지 해보고, 그래도 안 되면 409로 알려서
// 프론트(chzzk-auth.js)가 로그인을 자동으로 다시 시도함.
class ChzzkTokenRejectedError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ChzzkUser {
  channelId: string;
  channelName: string;
}

// code로 치지직 액세스 토큰 교환
interface ChzzkTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
}

async function exchangeCodeForToken(code: string, state: string): Promise<ChzzkTokens> {
  const clientId = Deno.env.get("CHZZK_CLIENT_ID");
  const clientSecret = Deno.env.get("CHZZK_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("CHZZK_CLIENT_ID / CHZZK_CLIENT_SECRET 환경변수가 설정되지 않았습니다.");
  }

  const res = await fetch(CHZZK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grantType: "authorization_code",
      clientId,
      clientSecret,
      code,
      state,
    }),
  });

  if (!res.ok) {
    throw new Error(`치지직 토큰 교환 실패 (status ${res.status})`);
  }

  const body = await res.json();
  const accessToken = body?.content?.accessToken;
  if (typeof accessToken !== "string") {
    throw new Error("치지직 토큰 응답에 accessToken이 없습니다.");
  }
  const refreshToken = typeof body?.content?.refreshToken === "string" ? body.content.refreshToken : null;
  const expiresIn = Number(body?.content?.expiresIn ?? 86400);
  return { accessToken, refreshToken, expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 86400 };
}

// 채널 주인 토큰 저장(후원 자동 적립용). 실패해도 로그인 자체는 계속 진행함(로그만 남김).
async function saveStreamerTokens(channelId: string, tokens: ChzzkTokens): Promise<void> {
  if (!tokens.refreshToken) return;
  const admin = getAdminClient();
  const { error } = await admin.from("streamer_tokens").upsert(
    {
      channel_id: channelId,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "channel_id" },
  );
  if (error) console.error(`streamer_tokens 저장 실패: ${error.message}`);
}

// 토큰 갱신(refresh_token → 새 accessToken/refreshToken). 실패하면 null.
async function refreshChzzkTokens(refreshToken: string): Promise<ChzzkTokens | null> {
  const clientId = Deno.env.get("CHZZK_CLIENT_ID");
  const clientSecret = Deno.env.get("CHZZK_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch(CHZZK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantType: "refresh_token", refreshToken, clientId, clientSecret }),
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json().catch(() => null);
    const content = body?.content;
    if (!res.ok || typeof content?.accessToken !== "string") {
      console.error(`치지직 토큰 갱신 실패 (status ${res.status})`);
      return null;
    }
    const expiresIn = Number(content.expiresIn ?? 86400);
    return {
      accessToken: content.accessToken,
      refreshToken: typeof content.refreshToken === "string" ? content.refreshToken : refreshToken,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 86400,
    };
  } catch (err) {
    console.error(`치지직 토큰 갱신 오류: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// 유저 조회 + 거절(401)되면 서버에서 다시 시도. 순서: 바로 조회 → 0.7초 뒤 재조회 → 1.5초 뒤 재조회
// → 토큰 갱신해서 조회 → 1초 뒤 재조회. 어느 단계에서 성공했는지 로그를 남겨서 나중에 원인 파악에 씀.
// 토큰을 갱신했으면 tokens 객체도 새 값으로 바꿔둠(채널 주인이면 그 값을 저장해야 해서).
// (예전엔 시청자 토큰을 쓰고 바로 반납(revoke)했는데, 그러면 다음 로그인 때 거절이 훨씬 자주 생겨서 뺐음.)
async function fetchChzzkUserWithRetry(tokens: ChzzkTokens): Promise<ChzzkUser> {
  const plan: Array<{ wait: number; refresh?: boolean }> = [
    { wait: 0 }, { wait: 700 }, { wait: 1500 }, { wait: 0, refresh: true }, { wait: 1000 },
  ];
  let refreshed = false;
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    if (step.wait) await sleep(step.wait);
    if (step.refresh) {
      if (!tokens.refreshToken) continue;
      const fresh = await refreshChzzkTokens(tokens.refreshToken);
      if (!fresh) continue;
      Object.assign(tokens, fresh);
      refreshed = true;
    }
    try {
      const user = await fetchChzzkUser(tokens.accessToken);
      if (i > 0) console.log(`치지직 유저 조회 성공 — ${i + 1}번째 시도${refreshed ? " (토큰 갱신 후)" : ""}`);
      return user;
    } catch (err) {
      if (!(err instanceof ChzzkTokenRejectedError)) throw err;
      console.error(`${err.message} — ${i + 1}번째 시도`);
    }
  }
  throw new ChzzkTokenRejectedError("치지직 유저 정보 조회가 계속 거절됨 — 프론트가 로그인 재시도");
}

// GET /open/v1/users/me 로 channelId, channelName 조회
async function fetchChzzkUser(accessToken: string): Promise<ChzzkUser> {
  const res = await fetch(CHZZK_USER_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401) {
    // 거절 사유(치지직 응답의 code/message)만 남김 — 토큰 값은 절대 안 남김.
    const body = await res.json().catch(() => null);
    const reason = body ? `${body.code ?? ""} ${String(body.message ?? "").slice(0, 120)}`.trim() : "";
    throw new ChzzkTokenRejectedError(`치지직 유저 정보 조회 거절 (status 401${reason ? `, ${reason}` : ""})`);
  }
  if (!res.ok) {
    throw new Error(`치지직 유저 정보 조회 실패 (status ${res.status})`);
  }

  const body = await res.json();
  const channelId = body?.content?.channelId;
  if (typeof channelId !== "string") {
    throw new Error("치지직 유저 응답에 channelId가 없습니다.");
  }
  return { channelId, channelName: body?.content?.channelName ?? "" };
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  }
  return createClient(url, serviceRoleKey);
}

// users 테이블에 upsert. channel_name(+ 이번에 가져온 프로필 이미지)만 갱신하고 is_public/banned/created_at은
// 기존 값 유지(upsert에 안 넣은 컬럼은 건드리지 않음). profileImageUrl이 undefined면(치지직 조회 실패)
// 저장된 이미지는 그대로 둠.
async function upsertUser(user: ChzzkUser, profileImageUrl: string | null | undefined): Promise<void> {
  const admin = getAdminClient();
  const row: Record<string, unknown> = { channel_id: user.channelId, channel_name: user.channelName };
  if (profileImageUrl !== undefined) {
    row.profile_image_url = profileImageUrl;
    row.profile_image_checked_at = new Date().toISOString();
  }
  const { error } = await admin
    .from("users")
    .upsert(row, { onConflict: "channel_id" });
  if (error) {
    throw new Error(`users upsert 실패: ${error.message}`);
  }
}

// 관리자 페이지에서 밴된 유저인지 확인. 밴 상태면 로그인 자체를 막음(세션 토큰 미발급).
async function isBanned(channelId: string): Promise<boolean> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("banned")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (error) {
    throw new Error(`banned 조회 실패: ${error.message}`);
  }
  return data?.banned === true;
}

// 치지직 조회가 이번에 실패했을 때 — 예전에 저장해둔 이미지라도 돌려줌.
async function getSavedProfileImage(channelId: string): Promise<string | null> {
  const admin = getAdminClient();
  const { data } = await admin.from("users").select("profile_image_url").eq("channel_id", channelId).maybeSingle();
  return data?.profile_image_url ?? null;
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const { code, state } = await req.json();
    if (!code || !state) {
      return new Response(JSON.stringify({ error: "missing_code_or_state" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tokens = await exchangeCodeForToken(code, state);
    const user = await fetchChzzkUserWithRetry(tokens);
    if (user.channelId === OWNER_CHANNEL_ID) await saveStreamerTokens(user.channelId, tokens);
    const fetchedImage = await fetchChzzkChannelImage(user.channelId);
    await upsertUser(user, fetchedImage);

    if (await isBanned(user.channelId)) {
      return new Response(JSON.stringify({ error: "banned" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await issueSessionToken(user);
    const profileImageUrl = fetchedImage !== undefined ? fetchedImage : await getSavedProfileImage(user.channelId);

    return new Response(
      JSON.stringify({ token, channelId: user.channelId, channelName: user.channelName, profileImageUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    if (err instanceof ChzzkTokenRejectedError) {
      console.error(err.message);
      return new Response(JSON.stringify({ error: "chzzk_token_rejected" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // clientSecret 등 민감정보는 이 경로(에러 메시지들)에 절대 안 섞이도록 위에서 주의해서 짬
    console.error(err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "oauth_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
