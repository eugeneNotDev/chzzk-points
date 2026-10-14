// 로그인 상태 + 서버 호출 공통 래퍼. 기존 사이트 chzzk-auth.js의 같은 이름 함수들을 옮긴 것.
// 세션은 쿠키 대신 토큰(localStorage) — 프론트(GitHub Pages)와 API(Supabase)가 다른 도메인이라.
//
// React 쪽에선 useAuth()로 로그인 상태를 구독함. 토큰이 바뀌면(로그인/로그아웃/다른 탭에서 변경)
// 구독 중인 화면이 전부 다시 그려짐.

import { useSyncExternalStore } from "react";
import { API, CHZZK_CLIENT_ID, CHZZK_REDIRECT_URI, OWNER_CHANNEL_ID, STORAGE } from "./config";
import { readStorage, writeStorage } from "./storage";
import { alertDialog } from "./dialog";

export type AuthState = {
  token: string | null;
  channelId: string | null;
  channelName: string | null;
  profileImage: string | null;
};

const listeners = new Set<() => void>();
let snapshot: AuthState = readAuth();

function readAuth(): AuthState {
  return {
    token: readStorage(STORAGE.token),
    channelId: readStorage(STORAGE.channelId),
    channelName: readStorage(STORAGE.channelName),
    profileImage: readStorage(STORAGE.profileImage),
  };
}

function emit() {
  snapshot = readAuth();
  listeners.forEach((l) => l());
}

// 다른 탭(기존 사이트 포함)에서 로그인/로그아웃하면 여기도 바로 반영.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === null || e.key.startsWith("chzzk_points_")) emit();
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useAuth() {
  const s = useSyncExternalStore(subscribe, () => snapshot);
  return {
    ...s,
    isLoggedIn: s.token !== null,
    isAdmin: s.token !== null && s.channelId === OWNER_CHANNEL_ID,
  };
}

export function getToken() {
  return snapshot.token;
}

export function startLogin() {
  const state = crypto.randomUUID();
  try {
    sessionStorage.setItem(STORAGE.oauthState, state);
  } catch {
    /* 무시 */
  }
  const params = new URLSearchParams({ clientId: CHZZK_CLIENT_ID, redirectUri: CHZZK_REDIRECT_URI, state });
  location.href = `https://chzzk.naver.com/account-interlock?${params.toString()}`;
}

// 치지직 로그인 후 돌아오면 주소에 ?code=&state= 가 붙어 있음 → oauth-callback에 교환해서 토큰 저장.
// (교체 전 베타에선 로그인 후 기존 사이트 홈으로 돌아가서 거기서 처리됨. 교체 후엔 이 함수가 처리.)
// 치지직 토큰이 거절되면(409 chzzk_token_rejected) 2분 안에 2번까지만 자동으로 다시 로그인.
const LOGIN_RETRY_KEY = "chzzk_points_login_retry";
export async function handleOAuthCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return;
  let saved: string | null = null;
  try {
    saved = sessionStorage.getItem(STORAGE.oauthState);
    sessionStorage.removeItem(STORAGE.oauthState);
  } catch {
    /* 무시 */
  }
  // 성공이든 실패든 주소는 정리(새로고침 때 code 재사용 방지)
  params.delete("code");
  params.delete("state");
  const rest = params.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
  if (!saved || saved !== state) {
    console.error("[auth] OAuth state가 일치하지 않아요. 다시 로그인해 주세요.");
    return;
  }
  try {
    const res = await fetch(API.oauthCallback, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, state }) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (res.status === 403 && body.error === "banned") {
        sessionStorage.removeItem(LOGIN_RETRY_KEY);
        alertDialog("이용이 제한된 계정이에요. 문의가 필요하면 스트리머에게 직접 연락해주세요.");
        return;
      }
      if (res.status === 409 && body.error === "chzzk_token_rejected") {
        let retry = { at: 0, count: 0 };
        try {
          retry = { ...retry, ...JSON.parse(sessionStorage.getItem(LOGIN_RETRY_KEY) || "{}") };
        } catch {
          /* 무시 */
        }
        if (Date.now() - retry.at > 2 * 60_000) retry = { at: Date.now(), count: 0 };
        if (retry.count < 2) {
          sessionStorage.setItem(LOGIN_RETRY_KEY, JSON.stringify({ at: retry.at, count: retry.count + 1 }));
          startLogin();
          return;
        }
      }
      sessionStorage.removeItem(LOGIN_RETRY_KEY);
      alertDialog("로그인에 실패했어요. 잠시 후 다시 시도해 주세요.");
      return;
    }
    sessionStorage.removeItem(LOGIN_RETRY_KEY);
    writeStorage(STORAGE.token, String(body.token ?? ""));
    writeStorage(STORAGE.channelId, String(body.channelId ?? ""));
    writeStorage(STORAGE.channelName, String(body.channelName ?? ""));
    saveProfileImage(body.profileImageUrl);
    emit();
  } catch (err) {
    console.error("[auth] 로그인 처리 중 오류", err);
  }
}

export function logout() {
  [STORAGE.token, STORAGE.channelId, STORAGE.channelName, STORAGE.balance, STORAGE.profileImage, STORAGE.rankKey].forEach((k) =>
    writeStorage(k, null),
  );
  emit();
}

export function saveProfileImage(url: unknown) {
  const next = typeof url === "string" && /^https:\/\//.test(url) ? url : null;
  if (next === readStorage(STORAGE.profileImage)) return;
  writeStorage(STORAGE.profileImage, next);
  emit();
}

// 치지직 프로필 원본(1500px)은 무거워서 네이버 이미지 서버면 120px 썸네일로.
export function profileThumbUrl(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith(".pstatic.net") && !u.search) return url + "?type=f120_120_na";
  } catch {
    /* 그대로 */
  }
  return url;
}

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

// Edge Function 호출 공통 래퍼 — 토큰 자동 첨부, 401이면 로그아웃, 403 banned면 강제 로그아웃,
// /me가 주는 refreshedToken(슬라이딩 세션)은 조용히 갈아끼움. JSON 본문을 돌려주고 실패면 ApiError를 던짐.
export async function apiFetch<T>(url: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }
  const res = await fetch(url, { method: options.method ?? (body ? "POST" : "GET"), headers, body });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (res.status === 401) {
    logout();
  } else if (res.status === 403 && data.error === "banned" && getToken()) {
    logout();
    alertDialog("이용이 제한된 계정이에요. 문의가 필요하면 스트리머에게 직접 연락해주세요.");
  }
  if (!res.ok) throw new ApiError(res.status, data);

  if (typeof data.refreshedToken === "string" && data.refreshedToken) {
    writeStorage(STORAGE.token, data.refreshedToken);
    emit();
  }
  return data as T;
}
