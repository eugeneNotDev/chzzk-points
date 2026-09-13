// 치지직 OAuth 콜백 처리.
//
// 요청: POST { code: string, state: string }   (docs/assets/js/chzzk-auth.js 가 호출)
// 응답: { token: string, channelId: string, channelName: string }
//   - token: 우리 서비스 전용 세션 토큰 (_shared/session.ts). 프론트가 localStorage에 저장.
//
// 흐름: code를 clientSecret과 함께 치지직 토큰 엔드포인트로 교환
//      → GET /open/v1/users/me 로 channelId/channelName 확보
//      → users 테이블에 upsert (service_role 클라이언트, RLS 우회)
//      → 세션 토큰 발급해서 리턴
//
// 참고: 치지직 오픈 API 응답은 전부 { code, message, content: {...} } 래퍼 구조.
//   토큰 엔드포인트: POST https://openapi.chzzk.naver.com/auth/v1/token
//   유저 조회: GET https://openapi.chzzk.naver.com/open/v1/users/me (Authorization: Bearer <accessToken>)
//
// clientSecret은 이 함수의 환경변수로만 존재해야 한다 (Supabase 프로젝트 설정에서 등록).
// 절대 응답 바디나 로그에 clientSecret을 남기지 말 것.
//
// verify_jwt는 supabase/config.toml에서 이 함수만 꺼져있다 (로그인 전이라 우리 세션 토큰이 아직 없음).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { issueSessionToken } from "../_shared/session.ts";

const CHZZK_TOKEN_URL = "https://openapi.chzzk.naver.com/auth/v1/token";
const CHZZK_USER_ME_URL = "https://openapi.chzzk.naver.com/open/v1/users/me";

interface ChzzkUser {
  channelId: string;
  channelName: string;
}

// code로 치지직 액세스 토큰 교환
async function exchangeCodeForToken(code: string, state: string): Promise<{ accessToken: string }> {
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
  return { accessToken };
}

// GET /open/v1/users/me 로 channelId, channelName 조회
async function fetchChzzkUser(accessToken: string): Promise<ChzzkUser> {
  const res = await fetch(CHZZK_USER_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

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

// users 테이블에 upsert. channel_name만 갱신하고 is_public/created_at은 기존 값 유지
// (upsert에 안 넣은 컬럼은 건드리지 않음).
async function upsertUser(user: ChzzkUser): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin
    .from("users")
    .upsert(
      { channel_id: user.channelId, channel_name: user.channelName },
      { onConflict: "channel_id" },
    );
  if (error) {
    throw new Error(`users upsert 실패: ${error.message}`);
  }
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

    const { accessToken } = await exchangeCodeForToken(code, state);
    const user = await fetchChzzkUser(accessToken);
    await upsertUser(user);
    const token = await issueSessionToken(user);

    return new Response(
      JSON.stringify({ token, channelId: user.channelId, channelName: user.channelName }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    // clientSecret 등 민감정보는 이 경로(에러 메시지들)에 절대 안 섞이도록 위에서 주의해서 짬
    console.error(err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "oauth_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
