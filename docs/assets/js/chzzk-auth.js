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
const FUNCTIONS_BASE_URL = "https://azowisiuyeohhfxxmewb.supabase.co/functions/v1";
const OAUTH_CALLBACK_URL = `${FUNCTIONS_BASE_URL}/oauth-callback`;
const ME_URL = `${FUNCTIONS_BASE_URL}/me`;
const SPEND_POINTS_URL = `${FUNCTIONS_BASE_URL}/spend-points`;
const ATTENDANCE_CHECK_URL = `${FUNCTIONS_BASE_URL}/attendance-check`;
const NOTICES_URL = `${FUNCTIONS_BASE_URL}/notices`;
const BROADCAST_STATUS_URL = `${FUNCTIONS_BASE_URL}/broadcast-status`;
const ADMIN_URL = `${FUNCTIONS_BASE_URL}/admin`;
const SHOP_ITEMS_URL = `${FUNCTIONS_BASE_URL}/shop-items`;
// 공지사항 작성/수정/삭제, 관리자 페이지 등 "관리자만" 가능한 UI를 보여줄지 판단할 때 쓰는 값.
// 방송/사이트 관리 전부 이 계정(유진 알파)으로 한다 — 검머짐은 개발 중 로그인 테스트용 부계정이라
// 여기 안 쓴다. 시크릿이 아니라 공개된 channelId라서 프론트에 그대로 둬도 된다
// (실제 쓰기 권한 체크는 서버(notices/admin 함수)가 세션 토큰으로 다시 검증함 — 이건 UI 노출용).
const OWNER_CHANNEL_ID = "37a1acfaa35d56311bf428dc96142e9f";
const TOKEN_STORAGE_KEY = "chzzk_points_token";
const CHANNEL_ID_STORAGE_KEY = "chzzk_points_channel_id";
const CHANNEL_NAME_STORAGE_KEY = "chzzk_points_channel_name";
const STATE_STORAGE_KEY = "chzzk_points_oauth_state";
const SIDEBAR_COLLAPSED_KEY = "chzzk_points_sidebar_collapsed";

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
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "banned") {
          alert("이용이 제한된 계정이에요. 문의가 필요하면 스트리머에게 직접 연락해주세요.");
          return;
        }
      }
      console.error("[chzzk-auth] 로그인 처리 실패", res.status);
      return;
    }
    const data = await res.json();
    localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
    localStorage.setItem(CHANNEL_ID_STORAGE_KEY, data.channelId ?? "");
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

// 로그인된 채널 ID (랭킹에서 본인 하이라이트 등에 사용). 없으면 null.
function getChannelId() {
  return localStorage.getItem(CHANNEL_ID_STORAGE_KEY);
}

// 로그인 상태인지 (토큰 존재 여부만 체크 — 실제 유효성은 서버가 401로 판단)
function isLoggedIn() {
  return getToken() !== null;
}

// 관리자 계정으로 로그인했는지 (UI 노출용 — 실제 권한 체크는 서버가 세션 토큰으로 다시 함)
function isAdmin() {
  return isLoggedIn() && getChannelId() === OWNER_CHANNEL_ID;
}

// 로그아웃 — 로컬 토큰만 지운다 (서버에 별도 revoke는 두지 않음, MVP 범위 밖)
function logout() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(CHANNEL_ID_STORAGE_KEY);
  localStorage.removeItem(CHANNEL_NAME_STORAGE_KEY);
}

// Edge Function 호출 공통 래퍼. 로그인 상태면 Authorization 헤더를 자동으로 붙여준다.
// 401이 오면 세션 만료로 보고 로컬 로그아웃 처리 (호출부에서 로그인 화면으로 유도).
// 403 { error: "banned" }가 오면 — 로그인은 유효했지만(토큰 자체는 안 만료) 그 사이 밴된
// 경우 — 강제 로그아웃 + 안내 후 홈으로 보낸다. (토큰 자체를 서버에서 즉시 무효화하는 건
// 아니라서 "완전한" 강제 로그아웃은 아니지만, 로그인 상태에서 호출되는 API들이 /me를 통해
// 밴 여부를 다시 확인하기 때문에 사실상 곧바로 걸러진다 — me/index.ts, verifySessionInBackground 참고)
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
  } else if (res.status === 403) {
    // body는 한 번만 읽을 수 있어서 clone해서 확인 — 호출부가 원본 res.json()을 또 읽을 수 있게.
    const body = await res.clone().json().catch(() => ({}));
    if (body.error === "banned" && isLoggedIn()) {
      logout();
      alert("이용이 제한된 계정이에요. 문의가 필요하면 스트리머에게 직접 연락해주세요.");
      location.href = "index.html";
    }
  } else if (res.ok) {
    // 슬라이딩 세션 — /me가 남은 유효기간이 얼마 안 남았을 때만 refreshedToken을 응답에 실어
    // 보낸다(me/index.ts 참고). 그 필드가 있으면 조용히 localStorage 토큰을 갈아끼운다.
    // 다른 엔드포인트 응답엔 이 필드가 없어서(.refreshedToken이 undefined) 사실상 아무 일도 안 함.
    res.clone().json().then((body) => {
      if (typeof body.refreshedToken === "string" && body.refreshedToken) {
        localStorage.setItem(TOKEN_STORAGE_KEY, body.refreshedToken);
      }
    }).catch(() => {});
  }
  return res;
}

// 로그인 상태인 페이지에서 한 번 /me를 백그라운드로 조용히 호출해서, 그 사이 밴 당했는지를
// 확인한다. mypage.html/shop.html은 화면을 그리려고 어차피 ME_URL을 직접 호출하니 따로 필요
// 없고, index.html/notice.html/ranking.html/admin.html처럼 /me를 안 쓰는 페이지에서 호출한다.
// (밴 감지 자체는 authFetch가 처리 — 여기선 그냥 그 authFetch를 한 번 트리거만 해주는 역할.)
function verifySessionInBackground() {
  if (!isLoggedIn()) return;
  authFetch(ME_URL).catch(() => {});
}

// 사이드바 하단의 로그인/로그아웃 영역을 그린다.
// index.html, mypage.html, ranking.html, shop.html 모두 <div id="sidebar-user"></div>를
// 두고 이 함수를 한 번 호출하면 됨.
function renderSidebarUser() {
  const el = document.getElementById("sidebar-user");
  if (!el) return;

  if (isLoggedIn()) {
    const name = getChannelName() || "(이름 없음)";
    el.innerHTML = `
      <p class="sidebar-user-name">${escapeHtmlForAuth(name)}님</p>
      <button class="secondary sidebar-icon-btn" id="sidebar-logout-btn" title="로그아웃" aria-label="로그아웃">
        <span class="icon">${SIDEBAR_ICON_LOGOUT}</span>
        <span class="label">로그아웃</span>
      </button>
    `;
    document.getElementById("sidebar-logout-btn").addEventListener("click", () => {
      logout();
      location.href = "index.html";
    });
  } else {
    el.innerHTML = `
      <button class="sidebar-icon-btn" id="sidebar-login-btn" title="치지직으로 로그인" aria-label="치지직으로 로그인">
        <span class="icon">${SIDEBAR_ICON_LOGIN}</span>
        <span class="label">치지직으로 로그인</span>
      </button>
    `;
    document.getElementById("sidebar-login-btn").addEventListener("click", startLogin);
  }
}

const SIDEBAR_ICON_LOGOUT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`;
const SIDEBAR_ICON_LOGIN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>`;

function escapeHtmlForAuth(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 사이드바 접기/펴기 토글 버튼 연결. localStorage에 상태를 저장해서 다른 페이지로 이동해도 유지된다.
// (각 페이지 <body> 맨 앞의 인라인 스크립트가 렌더링 시작 전에 미리 같은 클래스를 적용해두기 때문에,
//  페이지를 열자마자 "펼쳐졌다가 순간적으로 접히는" 깜빡임이 없다.)
function initSidebarToggle() {
  const toggleBtn = document.getElementById("sidebar-toggle");
  if (!toggleBtn) return;
  // 라우터(spa-router.js)로 페이지를 넘길 때마다 페이지 스크립트가 다시 실행되면서 이 함수도
  // 다시 호출되는데, 사이드바 자체는 페이지 전환 때 다시 그려지지 않고 계속 같은 엘리먼트라서
  // 매번 리스너를 새로 붙이면 클릭 이벤트가 중복으로 쌓인다 — 그래서 한 번 붙였으면 건너뜀.
  if (toggleBtn.dataset.bound === "1") return;
  toggleBtn.dataset.bound = "1";
  toggleBtn.addEventListener("click", () => {
    const next = !document.body.classList.contains("sidebar-collapsed");
    document.body.classList.toggle("sidebar-collapsed", next);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
  });
}

// 사이드바의 "관리자" 링크는 기본 hidden — 관리자 계정으로 로그인된 경우에만 보여준다.
// 각 페이지 <nav class="sidebar-nav">에 <a href="admin.html" id="admin-nav-link" hidden> 를 두고
// renderSidebarUser() 근처에서 한 번 호출하면 됨.
function initAdminNav() {
  const el = document.getElementById("admin-nav-link");
  if (!el) return;
  el.hidden = !isAdmin();
}
