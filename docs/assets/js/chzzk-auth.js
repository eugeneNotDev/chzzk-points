// 치지직 로그인 흐름 + 세션 토큰 관리.
// index.html, mypage.html, ranking.html, shop.html이 전부 이 파일을 <script>로 불러와 쓴다.
//
// 세션 방식: 이 서비스는 프론트(GitHub Pages)와 API(Supabase Edge Functions)가
// 서로 다른 도메인이라 쿠키 대신 토큰 방식을 쓴다.
//   1) startLogin() → 치지직 로그인 페이지로 이동
//   2) 로그인 후 돌아오면 handleOAuthCallbackIfPresent() 가 code를 oauth-callback에 교환
//   3) 받은 토큰을 localStorage에 저장
//   4) 이후 authFetch()로 다른 Edge Function 호출 시 Authorization 헤더에 자동으로 붙음

const CHZZK_CLIENT_ID = "30d0a593-bc56-4239-ac79-3db1e0bf1202";
const CHZZK_REDIRECT_URI = "https://eugeneNotDev.github.io/chzzk-points/";
const OAUTH_CALLBACK_URL = "https://azowisiuyeohhfxxmewb.supabase.co/functions/v1/oauth-callback";
const TOKEN_STORAGE_KEY = "chzzk_points_token";
const CHANNEL_NAME_STORAGE_KEY = "chzzk_points_channel_name";
const STATE_STORAGE_KEY = "chzzk_points_oauth_state";

// 로그인 버튼 onclick에 연결. 랜덤 state를 만들어 sessionStorage에 저장해두고
// 치지직 인증 페이지(account-interlock)로 이동한다. 콜백에서 이 state와 대조해서
// CSRF(다른 사람이 만든 인증 요청을 가로채는 것)를 막는다.
function startLogin() {
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_STORAGE_KEY, state);

  const params = new URLSearchParams({
    clientId: CHZZK_CLIENT_ID,
    redirectUri: CHZZK_REDIRECT_URI,
    state,
  });
  location.href = `https://chzzk.naver.com/account-interlock?${params.toString()}`;
}

// 각 페이지 로드 시 한 번 호출. URL에 ?code=&state=가 있으면(=로그인 후 돌아온 상태)
// oauth-callback을 호출해서 토큰을 받아 저장하고, URL에서 code/state를 지운다.
// 없으면 아무 일도 안 하고 조용히 리턴.
async function handleOAuthCallbackIfPresent() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return;

  const savedState = sessionStorage.getItem(STATE_STORAGE_KEY);
  sessionStorage.removeItem(STATE_STORAGE_KEY);
  // 결과가 성공이든 실패든 URL은 항상 정리한다 (새로고침 시 code가 재사용되는 걸 방지)
  history.replaceState(null, "", location.pathname);

  if (!savedState || savedState !== state) {
    console.error("[chzzk-auth] OAuth state가 일치하지 않습니다. 로그인을 다시 시도해주세요.");
    return;
  }

  try {
    const res = await fetch(OAUTH_CALLBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state }),
    });
    if (!res.ok) {
      console.error("[chzzk-auth] 로그인 처리 실패", res.status);
      return;
    }
    const data = await res.json();
    localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
    localStorage.setItem(CHANNEL_NAME_STORAGE_KEY, data.channelName ?? "");
  } catch (err) {
    console.error("[chzzk-auth] 로그인 처리 중 오류", err);
  }
}

// 저장된 세션 토큰. 없으면 null.
function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

// 로그인된 채널 이름 (표시용). 없으면 null.
function getChannelName() {
  return localStorage.getItem(CHANNEL_NAME_STORAGE_KEY);
}

// 로그인 상태인지 (토큰 존재 여부만 체크 — 실제 유효성은 서버가 401로 판단)
function isLoggedIn() {
  return getToken() !== null;
}

// 로그아웃 — 로컬 토큰만 지운다 (서버에 별도 revoke는 두지 않음, MVP 범위 밖)
function logout() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(CHANNEL_NAME_STORAGE_KEY);
}

// Edge Function 호출 공통 래퍼. 로그인 상태면 Authorization 헤더를 자동으로 붙여준다.
// 401이 오면 세션 만료로 보고 로컬 로그아웃 처리 (호출부에서 로그인 화면으로 유도).
// 사용 예: authFetch(SPEND_POINTS_URL, { method: "POST", body: JSON.stringify({ itemId }) })
async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    logout();
  }
  return res;
}
