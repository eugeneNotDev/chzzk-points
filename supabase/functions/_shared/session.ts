// 자체 세션 토큰(JWT) 발급/검증.
//
// 이 프로젝트는 Supabase Auth를 쓰지 않는다 — 로그인 주체가 "치지직 채널"이라서,
// 치지직 OAuth로 확인한 channelId를 우리가 직접 서명한 토큰에 담아 프론트엔드에 내려준다.
// 프론트엔드는 이 토큰을 localStorage에 저장하고, 이후 모든 Edge Function 호출에
// `Authorization: Bearer <token>` 헤더로 붙여서 보낸다 (docs/assets/js/chzzk-auth.js 참고).
//
// 서명 비밀키(SESSION_JWT_SECRET)는 이 함수들의 환경변수로만 존재한다 (Supabase 프로젝트 설정에서 등록).
// 치지직 자체 accessToken/refreshToken과는 별개의, 우리 서비스 전용 세션 토큰이다.
//
// 만료는 7일로 잡는다. 만료되면 프론트엔드가 401을 받고 로그아웃 처리 후 재로그인 유도
// (별도 리프레시 플로우는 MVP에서 생략 — 치지직 로그인 자체가 몇 초면 끝나서 큰 불편은 아님).

import { create, verify, getNumericDate, type Header, type Payload } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

export interface SessionPayload {
  channelId: string;
  channelName: string;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7일

let cachedKey: CryptoKey | null = null;

async function getSigningKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const secret = Deno.env.get("SESSION_JWT_SECRET");
  if (!secret) {
    throw new Error("SESSION_JWT_SECRET 환경변수가 설정되지 않았습니다 (Supabase 프로젝트 설정에서 등록 필요).");
  }
  cachedKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return cachedKey;
}

// channelId/channelName을 담은 서명된 토큰 문자열을 만든다.
export async function issueSessionToken(payload: SessionPayload): Promise<string> {
  const key = await getSigningKey();
  const header: Header = { alg: "HS256", typ: "JWT" };
  const jwtPayload: Payload = {
    channelId: payload.channelId,
    channelName: payload.channelName,
    iat: getNumericDate(0),
    exp: getNumericDate(SESSION_TTL_SECONDS),
  };
  return await create(header, jwtPayload, key);
}

// 토큰을 검증하고 payload를 리턴한다. 서명이 틀리거나 만료됐거나 형식이 이상하면 null.
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const key = await getSigningKey();
    const payload = await verify(token, key);
    if (typeof payload.channelId !== "string" || typeof payload.channelName !== "string") {
      return null;
    }
    return { channelId: payload.channelId, channelName: payload.channelName };
  } catch {
    // 서명 불일치, 만료, 파싱 실패 등 — 전부 "인증 안 됨"으로 취급 (이유를 응답에 노출하지 않음)
    return null;
  }
}

// req의 Authorization 헤더(`Bearer <token>`)에서 토큰 문자열만 꺼낸다. 없으면 null.
export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

// spend-points, attendance-check 등 "로그인 필수" 함수들이 맨 앞에서 이렇게 쓰면 된다:
//   const session = await requireSession(req);
//   if (!session) return new Response("unauthorized", { status: 401, headers: corsHeaders });
export async function requireSession(req: Request): Promise<SessionPayload | null> {
  const token = extractBearerToken(req);
  if (!token) return null;
  return await verifySessionToken(token);
}
