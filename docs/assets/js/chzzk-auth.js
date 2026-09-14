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
// notifSeenIdKey는 이 파일 아래쪽(포인트 알림 폴링 섹션)에서 정의되지만, function/const 선언은
// 스크립트 로드 시 먼저 다 세팅되고 logout()은 클릭 시점에야 실제로 실행되니 순서 문제 없음.
function logout() {
  const channelId = getChannelId();
  if (channelId) localStorage.removeItem(notifSeenIdKey(channelId));
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

// ===== 관리자 포인트 지급/차감 알림(토스트) =====
// 관리자가 관리자 페이지에서 포인트를 지급/차감하면, 유저가 사이트 어느 페이지에 있든
// 짧은 주기로 조용히 폴링해서 토스트 알림을 띄운다.
//
// 실시간 웹소켓(Supabase Realtime) 대신 폴링을 쓰는 이유: 이 서비스는 Supabase Auth가 아니라
// 직접 만든 세션 토큰(JWT)을 쓰고 있어서, Realtime 구독을 "본인 데이터만" 보이게 안전하게
// 제한하려면 RLS/커스텀 클레임 연동 같은 추가 보안 설정이 필요함. 반면 폴링은 이미 있는
// /me 함수(session 토큰으로 본인 인증)를 그대로 재사용할 수 있어서 훨씬 간단하고 안전하다.
// 단점은 최대 폴링 주기만큼 알림이 늦게 뜰 수 있다는 것 — 지금 규모에선 이 정도 지연은 괜찮음.
//
// chzzk-auth.js는 <script src>로 한 번만 로드되고 spa-router.js가 페이지 이동 때 다시 끼워
// 넣지 않으므로(스크립트 태그 자체는 그대로 유지됨 — spa-router.js의 spaRunScripts 참고),
// 아래 setInterval은 사이트를 여는 동안 계속 살아있다. 매 tick마다 로그인 여부를 다시 확인하기
// 때문에, 로그인 전에 시작됐어도(비로그인 상태) 이후 로그인하면 다음 tick부터 자연스럽게 동작한다.
const POINTS_NOTIF_POLL_INTERVAL_MS = 20000;
const NOTIF_SEEN_ID_KEY_PREFIX = "chzzk_points_notif_seen_";

function notifSeenIdKey(channelId) {
  return `${NOTIF_SEEN_ID_KEY_PREFIX}${channelId}`;
}

function ensurePointsToastContainer() {
  let el = document.getElementById("points-toast-container");
  if (!el) {
    el = document.createElement("div");
    el.id = "points-toast-container";
    el.className = "toast-container";
    document.body.appendChild(el);
  }
  return el;
}

// event: { id, amount, reason, createdAt } — points_ledger 한 줄
function showPointsToast(event) {
  const container = ensurePointsToastContainer();
  const positive = event.amount > 0;
  const sign = positive ? "+" : "";
  const title = positive ? "포인트를 받았어요" : "포인트가 차감됐어요";
  const reasonText = event.reason && String(event.reason).trim() ? event.reason : "관리자 지급/차감";

  const toastEl = document.createElement("div");
  toastEl.className = `toast ${positive ? "positive" : "negative"}`;
  toastEl.innerHTML = `
    <p class="toast-title">${escapeHtmlForAuth(title)}</p>
    <p class="toast-body">${sign}${event.amount.toLocaleString("ko-KR")}P · ${escapeHtmlForAuth(reasonText)}</p>
  `;
  container.appendChild(toastEl);

  // 다음 프레임에 .show를 붙여서 CSS 트랜지션이 실제로 재생되게 함(같은 프레임에 붙이면 생략될 수 있음)
  requestAnimationFrame(() => requestAnimationFrame(() => toastEl.classList.add("show")));

  const AUTO_DISMISS_MS = 5000;
  setTimeout(() => {
    toastEl.classList.remove("show");
    toastEl.addEventListener("transitionend", () => toastEl.remove(), { once: true });
    setTimeout(() => toastEl.remove(), 600); // transitionend를 못 받는 경우 대비 fallback
  }, AUTO_DISMISS_MS);
}

async function pollPointsNotifications() {
  if (!isLoggedIn()) return;
  const channelId = getChannelId();
  if (!channelId) return;

  const key = notifSeenIdKey(channelId);
  const stored = localStorage.getItem(key);
  const hasBaseline = stored !== null && stored !== "";
  const url = hasBaseline
    ? `${ME_URL}?action=notifications&afterId=${encodeURIComponent(stored)}`
    : `${ME_URL}?action=notifications`;

  try {
    const res = await authFetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (hasBaseline && Array.isArray(data.events)) {
      data.events.forEach(showPointsToast);
    }
    if (typeof data.latestId === "number") {
      localStorage.setItem(key, String(data.latestId));
    }
  } catch (err) {
    console.error("[chzzk-auth] 포인트 알림 폴링 실패", err);
  }
}

let pointsNotifPollTimer = null;
function initPointsNotifPolling() {
  if (pointsNotifPollTimer) return; // 이중 시작 방지
  pollPointsNotifications();
  pointsNotifPollTimer = setInterval(pollPointsNotifications, POINTS_NOTIF_POLL_INTERVAL_MS);
}

initPointsNotifPolling();
