// 치지직 로그인 흐름 + 세션 토큰 관리.
// index.html, mypage.html, ranking.html, shop.html이 전부 이 파일을 <script>로 불러와 씀.
//
// 세션 방식: 이 서비스는 프론트(GitHub Pages)와 API(Supabase Edge Functions)가
// 서로 다른 도메인이라 쿠키 대신 토큰 방식을 씀.
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
const PREDICTIONS_URL = `${FUNCTIONS_BASE_URL}/predictions`;
// 공지사항 첨부파일(이미지/파일) Storage 버킷 — 공개 버킷이라 signed URL 없이 퍼블릭 URL로
// 바로 접근 가능함 (0031_notice_attachments.sql, supabase/functions/notices 참고).
// 업로드(쓰기)는 signed upload URL로만 하니 버킷 이름 자체는 시크릿이 아님.
const NOTICE_ATTACHMENTS_BUCKET = "notice-attachments";
const NOTICE_ATTACHMENTS_PUBLIC_BASE = `https://azowisiuyeohhfxxmewb.supabase.co/storage/v1/object/public/${NOTICE_ATTACHMENTS_BUCKET}`;
// 공지사항 작성/수정/삭제, 관리자 페이지 등 "관리자만" 가능한 UI를 보여줄지 판단할 때 쓰는 값.
// 방송/사이트 관리 전부 이 계정(유진 알파)으로 함 — 검머짐은 개발 중 로그인 테스트용 부계정이라
// 여기 안 씀. 시크릿이 아니라 공개된 channelId라서 프론트에 그대로 둬도 됨
// (실제 쓰기 권한 체크는 서버(notices/admin 함수)가 세션 토큰으로 다시 검증함 — 이건 UI 노출용).
const OWNER_CHANNEL_ID = "37a1acfaa35d56311bf428dc96142e9f";
const TOKEN_STORAGE_KEY = "chzzk_points_token";
const CHANNEL_ID_STORAGE_KEY = "chzzk_points_channel_id";
const CHANNEL_NAME_STORAGE_KEY = "chzzk_points_channel_name";
const STATE_STORAGE_KEY = "chzzk_points_oauth_state";
const SIDEBAR_COLLAPSED_KEY = "chzzk_points_sidebar_collapsed";
const NOTICE_LAST_SEEN_KEY = "chzzk_points_notice_last_seen_at";
// 모바일 상단바 포인트 표시용 — /me 응답의 balance를 받을 때마다 갱신해두는 캐시(표시용일 뿐,
// 실제 잔액 판단은 항상 서버가 함).
const BALANCE_CACHE_KEY = "chzzk_points_balance_cache";

// 로그인 버튼 onclick에 연결. 랜덤 state를 만들어 sessionStorage에 저장해두고
// 치지직 인증 페이지(account-interlock)로 이동함. 콜백에서 이 state와 대조해서
// CSRF(다른 사람이 만든 인증 요청을 가로채는 것)를 막음.
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
// oauth-callback을 호출해서 토큰을 받아 저장하고, URL에서 code/state를 지움.
// 없으면 아무 일도 안 하고 조용히 리턴.
async function handleOAuthCallbackIfPresent() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return;

  const savedState = sessionStorage.getItem(STATE_STORAGE_KEY);
  sessionStorage.removeItem(STATE_STORAGE_KEY);
  // 결과가 성공이든 실패든 URL은 항상 정리함 (새로고침 시 code가 재사용되는 걸 방지)
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

// 로그아웃 — 로컬 토큰만 지움 (서버에 별도 revoke는 두지 않음, MVP 범위 밖)
function logout() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(CHANNEL_ID_STORAGE_KEY);
  localStorage.removeItem(CHANNEL_NAME_STORAGE_KEY);
  localStorage.removeItem(BALANCE_CACHE_KEY);
}

// Edge Function 호출 공통 래퍼. 로그인 상태면 Authorization 헤더를 자동으로 붙여줌.
// 401이 오면 세션 만료로 보고 로컬 로그아웃 처리 (호출부에서 로그인 화면으로 유도).
// 403 { error: "banned" }가 오면 — 로그인은 유효했지만(토큰 자체는 안 만료) 그 사이 밴된
// 경우 — 강제 로그아웃 + 안내 후 홈으로 보냄. (토큰 자체를 서버에서 즉시 무효화하는 건
// 아니라서 "완전한" 강제 로그아웃은 아니지만, 로그인 상태에서 호출되는 API들이 /me를 통해
// 밴 여부를 다시 확인하기 때문에 사실상 곧바로 걸러짐 — me/index.ts, verifySessionInBackground 참고)
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

  const isMeProfileCall = String(url).startsWith(ME_URL) && !String(url).includes("action=");
  if (isMeProfileCall) lastMeFetchAt = Date.now();

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
    // 보냄(me/index.ts 참고). 그 필드가 있으면 조용히 localStorage 토큰을 갈아끼움.
    // 다른 엔드포인트 응답엔 이 필드가 없어서(.refreshedToken이 undefined) 사실상 아무 일도 안 함.
    res.clone().json().then((body) => {
      if (typeof body.refreshedToken === "string" && body.refreshedToken) {
        localStorage.setItem(TOKEN_STORAGE_KEY, body.refreshedToken);
      }
      // /me 프로필 응답이면 잔액을 캐싱해서 모바일 상단바 포인트 표시를 갱신함.
      if (isMeProfileCall && typeof body.balance === "number") {
        localStorage.setItem(BALANCE_CACHE_KEY, String(body.balance));
        renderMobileUser();
      }
    }).catch(() => {});
  }
  return res;
}

// 로그인 상태인 페이지에서 한 번 /me를 백그라운드로 조용히 호출해서, 그 사이 밴 당했는지를
// 확인함. mypage.html/shop.html은 화면을 그리려고 어차피 ME_URL을 직접 호출하니 따로 필요
// 없고, index.html/notice.html/ranking.html/admin.html처럼 /me를 안 쓰는 페이지에서 호출함.
// (밴 감지 자체는 authFetch가 처리 — 여기선 그냥 그 authFetch를 한 번 트리거만 해주는 역할.)
function verifySessionInBackground() {
  refreshMeInBackground();
}

// /me를 백그라운드로 한 번 부름(밴 확인 + 모바일 상단바 잔액 갱신 겸용). 페이지를 옮길 때마다
// 여러 곳에서 불려도 30초 안에 이미 /me를 불렀으면(페이지가 직접 부른 것 포함 — authFetch가
// 시각을 기록함) 건너뜀.
let lastMeFetchAt = 0;
const ME_REFRESH_INTERVAL_MS = 30 * 1000;
function refreshMeInBackground() {
  if (!isLoggedIn()) return;
  if (Date.now() - lastMeFetchAt < ME_REFRESH_INTERVAL_MS) return;
  authFetch(ME_URL).catch(() => {});
}

// 사이드바 하단의 로그인/로그아웃 영역을 그림.
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

  // 모든 페이지가 페이지 스크립트 시작 시 이 함수를 부르므로, 모바일 상단바/더보기 시트의
  // 로그인 상태 표시와 잔액 갱신도 여기서 같이 챙김.
  renderMobileUser();
  refreshMeInBackground();
}

const SIDEBAR_ICON_LOGOUT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`;
const SIDEBAR_ICON_LOGIN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>`;

function escapeHtmlForAuth(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 포인트 구간 칭호(브론즈~다이아)는 더 이상 "[브론즈]" 같은 텍스트 배지로 안 보여줌 — 포인트
// 총합에 따라 구간이 갈리는 규칙 자체는 그대로 두고(0022_title_tiers.sql), 대신 랭킹/마이페이지에
// 보이는 이름 텍스트 자체를 그 구간 색으로 칠하는 방식으로 바뀜(요청사항). 상점에서 "구매"한
// 칭호는 지금까지처럼 "[칭호명]" 배지로 그대로 보여줌 — 둘은 성격이 달라서(자동 vs 직접 구매)
// 구분을 유지함. 그래서 함수가 둘로 나뉨: 이름 텍스트에 구간 색을 입히는 쪽과, 구매 칭호
// 배지를 만드는 쪽.
function applyTierColorToName(escapedName, tierColor) {
  const safeColor = typeof tierColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(tierColor) ? tierColor : "";
  return safeColor ? `<span style="color:${safeColor}">${escapedName}</span>` : escapedName;
}

// ── 칭호 배지 ────────────────────────────────────────────────────────────────
// 상점/관리자 칭호는 "색 + 디자인 + 왕관" 조합으로 그려짐. DB엔 titles.color 한 칸에 이 조합을
// 문자열 하나로 저장함(서버는 형식만 검사하고 그대로 저장 — 새 디자인을 추가해도 서버/DB는 안 바꿔도 됨):
//   "#00e5a0"                      단색 배지(기본)
//   "rainbow"                      무지개 배지
//   "shine-ffd43b"                 메탈 광택 + 반짝 스윕
//   "shine-crown-ffd43b"           메탈 + 반짝 + 왕관 아이콘
//   "glow-rainbow"                 빛나는 테두리(무지개)
//   "book-star-00e5a0"             단색 + 책 아이콘 + 반짝이 별
//   "basic-ff6bb5-5dc8ff"          두 가지 색 그라데이션(핑크 → 하늘)
//   "glass-1b1e24-t-f2c230"        유리 + 배경색(검정) + 글자색(금)
// 즉 "[디자인-][아이콘-][star-]색" — 색은 # 없는 6자리 hex, rainbow, "hex-hex"(그라데이션),
// "hex-t-hex"(배경+글자). 서버 규칙상 전체가 영문 소문자로 시작하는 32자 이하라서, 두 가지 색인데
// 붙는 게 하나도 없으면 앞에 "basic-"을 붙임. 가장 긴 조합("shine-crown-star-" + 15자)이 딱
// 32자라 디자인/아이콘 id는 5글자 이하로 지을 것(6글자면 hex랑 헷갈릴 수도 있음). 모르는 값은 기본 민트 단색.
const DEFAULT_TITLE_COLOR = "#00e5a0";
const TITLE_COLOR_PRESETS = [
  { name: "민트", value: "#00e5a0" },
  { name: "하늘", value: "#5dc8ff" },
  { name: "파랑", value: "#4c6ef5" },
  { name: "보라", value: "#9b6bff" },
  { name: "핑크", value: "#ff6bb5" },
  { name: "빨강", value: "#ff4d5a" },
  { name: "주황", value: "#ff922b" },
  { name: "노랑", value: "#ffd43b" },
  { name: "연두", value: "#94d82d" },
  { name: "흰색", value: "#f1f3f5" },
  { name: "회색", value: "#868e96" },
  { name: "검정", value: "#1b1d21" },
  { name: "금", value: "#f2c230" },
  { name: "은", value: "#c9d1d9" },
  { name: "동", value: "#cd7f32" },
  { name: "무지개", value: "rainbow" },
];
// 디자인 목록 — 색상 예시처럼 여기 한 줄 추가하고 CSS(.title-badge--<id>)만 만들면 선택지에 뜸.
const TITLE_DESIGNS = [
  { id: "basic", name: "기본" },
  { id: "shine", name: "메탈 반짝" },
  { id: "glow", name: "빛나는 테두리" },
  { id: "glass", name: "유리" },
];
const TITLE_DESIGN_IDS = new Set(TITLE_DESIGNS.map((d) => d.id));
// 배지 앞에 붙는 아이콘 — 색은 왕관처럼 글자색 단색. 왕관만 원래 쓰던 모양 그대로고 나머지는
// Phosphor Icons(https://phosphoricons.com, MIT License, Copyright (c) 2023 Phosphor Icons)의 fill 아이콘.
// 새 아이콘은 여기 한 줄 추가(id 5글자 이하, 디자인 id/"star"/"t"랑 겹치면 안 됨).
const TITLE_CROWN_INNER = `<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/><circle cx="3" cy="7" r="1.6"/><circle cx="12" cy="4" r="1.6"/><circle cx="21" cy="7" r="1.6"/>`;
const TITLE_ICONS = [
  { id: "crown", name: "왕관", viewBox: "0 0 24 24", inner: TITLE_CROWN_INNER },
  { id: "cup", name: "트로피", d: "M232,64H208V48a8,8,0,0,0-8-8H56a8,8,0,0,0-8,8V64H24A16,16,0,0,0,8,80V96a40,40,0,0,0,40,40h3.65A80.13,80.13,0,0,0,120,191.61V216H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16H136V191.58c31.94-3.23,58.44-25.64,68.08-55.58H208a40,40,0,0,0,40-40V80A16,16,0,0,0,232,64ZM48,120A24,24,0,0,1,24,96V80H48v32q0,4,.39,8ZM232,96a24,24,0,0,1-24,24h-.5a81.81,81.81,0,0,0,.5-8.9V80h24Z" },
  { id: "medal", name: "메달", d: "M216,96A88,88,0,1,0,72,163.83V240a8,8,0,0,0,11.58,7.16L128,225l44.43,22.21A8.07,8.07,0,0,0,176,248a8,8,0,0,0,8-8V163.83A87.85,87.85,0,0,0,216,96ZM56,96a72,72,0,1,1,72,72A72.08,72.08,0,0,1,56,96Zm16,0a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z" },
  { id: "shld", name: "방패", d: "M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.27,47,25.53a8,8,0,0,0,4.2,0c1-.26,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm-37,87.43-30.31,12.12L158.4,163.2a8,8,0,1,1-12.8,9.6L128,149.33,110.4,172.8a8,8,0,1,1-12.8-9.6l17.74-23.65L85,127.43A8,8,0,1,1,91,112.57l29,11.61V96a8,8,0,0,1,16,0v28.18l29-11.61A8,8,0,1,1,171,127.43Z" },
  { id: "sword", name: "검", d: "M216,32H152a8,8,0,0,0-6.34,3.12l-64,83.21L72,108.69a16,16,0,0,0-22.64,0l-8.69,8.7a16,16,0,0,0,0,22.63l22,22-32,32a16,16,0,0,0,0,22.63l8.69,8.68a16,16,0,0,0,22.62,0l32-32,22,22a16,16,0,0,0,22.64,0l8.69-8.7a16,16,0,0,0,0-22.63l-9.64-9.64,83.21-64A8,8,0,0,0,224,104V40A8,8,0,0,0,216,32Zm-8,68.06-81.74,62.88L115.32,152l50.34-50.34a8,8,0,0,0-11.32-11.31L104,140.68,93.07,129.74,155.94,48H208Z" },
  { id: "gem", name: "보석", d: "M246,98.73l-56-64A8,8,0,0,0,184,32H72a8,8,0,0,0-6,2.73l-56,64a8,8,0,0,0,.17,10.73l112,120a8,8,0,0,0,11.7,0l112-120A8,8,0,0,0,246,98.73ZM222.37,96H180L144,48h36.37ZM74.58,112l30.13,75.33L34.41,112Zm106.84,0h40.17l-70.3,75.33ZM75.63,48H112L76,96H33.63Z" },
  { id: "star5", name: "별", d: "M234.29,114.85l-45,38.83L203,211.75a16.4,16.4,0,0,1-24.5,17.82L128,198.49,77.47,229.57A16.4,16.4,0,0,1,53,211.75l13.76-58.07-45-38.83A16.46,16.46,0,0,1,31.08,86l59-4.76,22.76-55.08a16.36,16.36,0,0,1,30.27,0l22.75,55.08,59,4.76a16.46,16.46,0,0,1,9.37,28.86Z" },
  { id: "heart", name: "하트", d: "M240,102c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,228.66,16,172,16,102A62.07,62.07,0,0,1,78,40c20.65,0,38.73,8.88,50,23.89C139.27,48.88,157.35,40,178,40A62.07,62.07,0,0,1,240,102Z" },
  { id: "fire", name: "불꽃", d: "M173.79,51.48a221.25,221.25,0,0,0-41.67-34.34,8,8,0,0,0-8.24,0A221.25,221.25,0,0,0,82.21,51.48C54.59,80.48,40,112.47,40,144a88,88,0,0,0,176,0C216,112.47,201.41,80.48,173.79,51.48ZM96,184c0-27.67,22.53-47.28,32-54.3,9.48,7,32,26.63,32,54.3a32,32,0,0,1-64,0Z" },
  { id: "bolt", name: "번개", d: "M213.85,125.46l-112,120a8,8,0,0,1-13.69-7l14.66-73.33L45.19,143.49a8,8,0,0,1-3-13l112-120a8,8,0,0,1,13.69,7L153.18,90.9l57.63,21.61a8,8,0,0,1,3,12.95Z" },
  { id: "spark", name: "반짝", d: "M208,144a15.78,15.78,0,0,1-10.42,14.94L146,178l-19,51.62a15.92,15.92,0,0,1-29.88,0L78,178l-51.62-19a15.92,15.92,0,0,1,0-29.88L78,110l19-51.62a15.92,15.92,0,0,1,29.88,0L146,110l51.62,19A15.78,15.78,0,0,1,208,144ZM152,48h16V64a8,8,0,0,0,16,0V48h16a8,8,0,0,0,0-16H184V16a8,8,0,0,0-16,0V32H152a8,8,0,0,0,0,16Zm88,32h-8V72a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0V96h8a8,8,0,0,0,0-16Z" },
  { id: "book", name: "책", d: "M240,56V200a8,8,0,0,1-8,8H160a24,24,0,0,0-24,23.94,7.9,7.9,0,0,1-5.12,7.55A8,8,0,0,1,120,232a24,24,0,0,0-24-24H24a8,8,0,0,1-8-8V56a8,8,0,0,1,8-8H88a32,32,0,0,1,32,32v87.73a8.17,8.17,0,0,0,7.47,8.25,8,8,0,0,0,8.53-8V80a32,32,0,0,1,32-32h64A8,8,0,0,1,240,56Z" },
  { id: "cap", name: "학사모", d: "M176,207.24a119,119,0,0,0,16-7.73V240a8,8,0,0,1-16,0Zm11.76-88.43-56-29.87a8,8,0,0,0-7.52,14.12L171,128l17-9.06Zm64-29.87-120-64a8,8,0,0,0-7.52,0l-120,64a8,8,0,0,0,0,14.12L32,117.87v48.42a15.91,15.91,0,0,0,4.06,10.65C49.16,191.53,78.51,216,128,216a130,130,0,0,0,48-8.76V130.67L171,128l-43,22.93L43.83,106l0,0L25,96,128,41.07,231,96l-18.78,10-.06,0L188,118.94a8,8,0,0,1,4,6.93v73.64a115.63,115.63,0,0,0,27.94-22.57A15.91,15.91,0,0,0,224,166.29V117.87l27.76-14.81a8,8,0,0,0,0-14.12Z" },
  { id: "pen", name: "연필", d: "M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM192,108.68,147.31,64l24-24L216,84.68Z" },
  { id: "music", name: "음표", d: "M212.92,17.71a7.89,7.89,0,0,0-6.86-1.46l-128,32A8,8,0,0,0,72,56V166.1A36,36,0,1,0,88,196V102.25l112-28V134.1A36,36,0,1,0,216,164V24A8,8,0,0,0,212.92,17.71Z" },
  { id: "mic", name: "마이크", d: "M80,128V64a48,48,0,0,1,96,0v64a48,48,0,0,1-96,0Zm128,0a8,8,0,0,0-16,0,64,64,0,0,1-128,0,8,8,0,0,0-16,0,80.11,80.11,0,0,0,72,79.6V240a8,8,0,0,0,16,0V207.6A80.11,80.11,0,0,0,208,128Z" },
  { id: "game", name: "게임패드", d: "M247.44,173.75a.68.68,0,0,0,0-.14L231.05,89.44c0-.06,0-.12,0-.18A60.08,60.08,0,0,0,172,40H83.89a59.88,59.88,0,0,0-59,49.52L8.58,173.61a.68.68,0,0,0,0,.14,36,36,0,0,0,60.9,31.71l.35-.37L109.52,160h37l39.71,45.09c.11.13.23.25.35.37A36.08,36.08,0,0,0,212,216a36,36,0,0,0,35.43-42.25ZM104,112H96v8a8,8,0,0,1-16,0v-8H72a8,8,0,0,1,0-16h8V88a8,8,0,0,1,16,0v8h8a8,8,0,0,1,0,16Zm40-8a8,8,0,0,1,8-8h24a8,8,0,0,1,0,16H152A8,8,0,0,1,144,104Zm84.37,87.47a19.84,19.84,0,0,1-12.9,8.23A20.09,20.09,0,0,1,198,194.31L167.8,160H172a60,60,0,0,0,51-28.38l8.74,45A19.82,19.82,0,0,1,228.37,191.47Z" },
  { id: "headp", name: "헤드폰", d: "M232,128v56a24,24,0,0,1-24,24H192a24,24,0,0,1-24-24V144a24,24,0,0,1,24-24h23.65a87.71,87.71,0,0,0-87-80H128a88,88,0,0,0-87.64,80H64a24,24,0,0,1,24,24v40a24,24,0,0,1-24,24H48a24,24,0,0,1-24-24V128A104.11,104.11,0,0,1,201.89,54.66,103.41,103.41,0,0,1,232,128Z" },
  { id: "chat", name: "채팅", d: "M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24ZM84,140a12,12,0,1,1,12-12A12,12,0,0,1,84,140Zm44,0a12,12,0,1,1,12-12A12,12,0,0,1,128,140Zm44,0a12,12,0,1,1,12-12A12,12,0,0,1,172,140Z" },
  { id: "paint", name: "팔레트", d: "M200.77,53.89A103.27,103.27,0,0,0,128,24h-1.07A104,104,0,0,0,24,128c0,43,26.58,79.06,69.36,94.17A32,32,0,0,0,136,192a16,16,0,0,1,16-16h46.21a31.81,31.81,0,0,0,31.2-24.88,104.43,104.43,0,0,0,2.59-24A103.28,103.28,0,0,0,200.77,53.89ZM84,168a12,12,0,1,1,12-12A12,12,0,0,1,84,168Zm0-56a12,12,0,1,1,12-12A12,12,0,0,1,84,112Zm44-24a12,12,0,1,1,12-12A12,12,0,0,1,128,88Zm44,24a12,12,0,1,1,12-12A12,12,0,0,1,172,112Z" },
  { id: "cam", name: "카메라", d: "M208,56H180.28L166.65,35.56A8,8,0,0,0,160,32H96a8,8,0,0,0-6.65,3.56L75.71,56H48A24,24,0,0,0,24,80V192a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V80A24,24,0,0,0,208,56Zm-44,76a36,36,0,1,1-36-36A36,36,0,0,1,164,132Z" },
  { id: "cafe", name: "커피", d: "M208,80H32a8,8,0,0,0-8,8v48a96.3,96.3,0,0,0,32.54,72H32a8,8,0,0,0,0,16H208a8,8,0,0,0,0-16H183.46a96.59,96.59,0,0,0,27-40.09A40,40,0,0,0,248,128v-8A40,40,0,0,0,208,80Zm24,48a24,24,0,0,1-17.2,23,95.78,95.78,0,0,0,1.2-15V97.38A24,24,0,0,1,232,120ZM112,56V24a8,8,0,0,1,16,0V56a8,8,0,0,1-16,0Zm32,0V24a8,8,0,0,1,16,0V56a8,8,0,0,1-16,0ZM80,56V24a8,8,0,0,1,16,0V56a8,8,0,0,1-16,0Z" },
  { id: "cake", name: "케이크", d: "M208,88H136V79a32.06,32.06,0,0,0,24-31c0-28-26.44-45.91-27.56-46.66a8,8,0,0,0-8.88,0C122.44,2.09,96,20,96,48a32.06,32.06,0,0,0,24,31v9H48a24,24,0,0,0-24,24v23.33a40.84,40.84,0,0,0,8,24.24V200a24,24,0,0,0,24,24H200a24,24,0,0,0,24-24V159.57a40.84,40.84,0,0,0,8-24.24V112A24,24,0,0,0,208,88ZM112,48c0-13.57,10-24.46,16-29.79,6,5.33,16,16.22,16,29.79a16,16,0,0,1-32,0Zm104,87.33c0,13.25-10.46,24.31-23.32,24.66A24,24,0,0,1,168,136a8,8,0,0,0-16,0,24,24,0,0,1-48,0,8,8,0,0,0-16,0,24,24,0,0,1-24.68,24C50.46,159.64,40,148.58,40,135.33V112a8,8,0,0,1,8-8H208a8,8,0,0,1,8,8Z" },
  { id: "bowl", name: "라면", d: "M81.77,55c5.35-6.66,6.67-11.16,6.12-13.14-.42-1.49-2.41-2.26-2.43-2.26A8,8,0,0,1,88,24a8.11,8.11,0,0,1,2.38.36c1,.31,9.91,3.33,12.79,12.76,2.46,8.07-.55,17.45-8.94,27.89-5.35,6.66-6.67,11.16-6.12,13.14.42,1.49,2.37,2.24,2.39,2.25A8,8,0,0,1,88,96a8.11,8.11,0,0,1-2.38-.36c-1-.31-9.91-3.33-12.79-12.76C70.37,74.81,73.38,65.43,81.77,55Zm31.06,27.89c2.88,9.43,11.79,12.45,12.79,12.76A8.11,8.11,0,0,0,128,96a8,8,0,0,0,2.5-15.6s-2-.76-2.39-2.25c-.55-2,.77-6.48,6.12-13.14,8.39-10.44,11.4-19.82,8.94-27.89-2.88-9.43-11.78-12.45-12.79-12.76A8.11,8.11,0,0,0,128,24a8,8,0,0,0-2.54,15.59s2,.77,2.43,2.26c.55,2-.77,6.48-6.12,13.14C113.38,65.43,110.37,74.81,112.83,82.88Zm40,0c2.88,9.43,11.79,12.45,12.79,12.76A8.11,8.11,0,0,0,168,96a8,8,0,0,0,2.5-15.6s-2-.76-2.39-2.25c-.55-2,.77-6.48,6.12-13.14,8.39-10.44,11.4-19.82,8.94-27.89-2.88-9.43-11.78-12.45-12.79-12.76A8.11,8.11,0,0,0,168,24a8,8,0,0,0-2.54,15.59s2,.77,2.43,2.26c.55,2-.77,6.48-6.12,13.14C153.38,65.43,150.37,74.81,152.83,82.88ZM224,112H32a8,8,0,0,0-8,8,104.35,104.35,0,0,0,56,92.28V216a16,16,0,0,0,16,16h64a16,16,0,0,0,16-16v-3.72A104.35,104.35,0,0,0,232,120,8,8,0,0,0,224,112Z" },
  { id: "pizza", name: "피자", d: "M239.54,63a15.91,15.91,0,0,0-7.25-9.9,201.49,201.49,0,0,0-208.58,0,16,16,0,0,0-5.37,22l96,157.27a16,16,0,0,0,27.36,0l96-157.27A15.82,15.82,0,0,0,239.54,63Zm-55.1,68.53a40,40,0,0,0-41.38,67.77L128,224,96.5,172.43a40,40,0,1,0-41.35-67.76L48.8,94.26a152,152,0,0,1,158.39,0Z" },
  { id: "icecr", name: "아이스크림", d: "M208,97.37V96A80,80,0,0,0,48,96v1.37A24,24,0,0,0,56,144h3.29l54.82,95.94a16,16,0,0,0,27.78,0L196.71,144H200a24,24,0,0,0,8-46.63ZM146.89,198.94,115.5,144h19.29l21.75,38.06ZM77.71,144H97.07l40.61,71.06L128,232Zm88,21.94L153.21,144h25.08Z" },
  { id: "gift", name: "선물", d: "M216,72H180.92c.39-.33.79-.65,1.17-1A29.53,29.53,0,0,0,192,49.57,32.62,32.62,0,0,0,158.44,16,29.53,29.53,0,0,0,137,25.91a54.94,54.94,0,0,0-9,14.48,54.94,54.94,0,0,0-9-14.48A29.53,29.53,0,0,0,97.56,16,32.62,32.62,0,0,0,64,49.57,29.53,29.53,0,0,0,73.91,71c.38.33.78.65,1.17,1H40A16,16,0,0,0,24,88v32a16,16,0,0,0,16,16v64a16,16,0,0,0,16,16h60a4,4,0,0,0,4-4V120H40V88h80v32h16V88h80v32H136v92a4,4,0,0,0,4,4h60a16,16,0,0,0,16-16V136a16,16,0,0,0,16-16V88A16,16,0,0,0,216,72ZM84.51,59a13.69,13.69,0,0,1-4.5-10A16.62,16.62,0,0,1,96.59,32h.49a13.69,13.69,0,0,1,10,4.5c8.39,9.48,11.35,25.2,12.39,34.92C109.71,70.39,94,67.43,84.51,59Zm87,0c-9.49,8.4-25.24,11.36-35,12.4C137.7,60.89,141,45.5,149,36.51a13.69,13.69,0,0,1,10-4.5h.49A16.62,16.62,0,0,1,176,49.08,13.69,13.69,0,0,1,171.49,59Z" },
  { id: "cat", name: "고양이", d: "M222.83,33.54a16,16,0,0,0-18.14,3.15c-.14.14-.26.27-.38.41L187.05,57A111.28,111.28,0,0,0,69,57L51.69,37.1c-.12-.14-.24-.27-.38-.41a16,16,0,0,0-18.14-3.15A16.4,16.4,0,0,0,24,48.46V136c0,49,40.06,89.63,91.56,95.32a4,4,0,0,0,4.44-4v-32l-13.42-13.43a8.22,8.22,0,0,1-.41-11.37,8,8,0,0,1,11.49-.18L128,180.68l10.34-10.35a8,8,0,0,1,11.49.18,8.22,8.22,0,0,1-.41,11.37L136,195.31v32a4,4,0,0,0,4.44,4C191.94,225.62,232,185,232,136V48.46A16.4,16.4,0,0,0,222.83,33.54ZM84,152a12,12,0,1,1,12-12A12,12,0,0,1,84,152Zm20-64a8,8,0,1,1-16,0V69a8,8,0,0,1,16,0Zm32,0a8,8,0,1,1-16,0V64a8,8,0,0,1,16,0Zm16,0V69a8,8,0,0,1,16,0V88a8,8,0,1,1-16,0Zm20,64a12,12,0,1,1,12-12A12,12,0,0,1,172,152Z" },
  { id: "paw", name: "발바닥", d: "M240,108a28,28,0,1,1-28-28A28,28,0,0,1,240,108ZM72,108a28,28,0,1,0-28,28A28,28,0,0,0,72,108ZM92,88A28,28,0,1,0,64,60,28,28,0,0,0,92,88Zm72,0a28,28,0,1,0-28-28A28,28,0,0,0,164,88Zm23.12,60.86a35.3,35.3,0,0,1-16.87-21.14,44,44,0,0,0-84.5,0A35.25,35.25,0,0,1,69,148.82,40,40,0,0,0,88,224a39.48,39.48,0,0,0,15.52-3.13,64.09,64.09,0,0,1,48.87,0,40,40,0,0,0,34.73-72Z" },
  { id: "fish", name: "물고기", d: "M168,76a12,12,0,1,1-12-12A12,12,0,0,1,168,76Zm48.72,67.64c-19.37,34.9-55.44,53.76-107.24,56.1l-22,51.41A8,8,0,0,1,80.1,256l-.51,0a8,8,0,0,1-7.19-5.78L57.6,198.39,5.8,183.56a8,8,0,0,1-1-15.05l51.41-22c2.35-51.78,21.21-87.84,56.09-107.22,24.75-13.74,52.74-15.84,71.88-15.18,18.64.64,36,4.27,38.86,6a8,8,0,0,1,2.83,2.83c1.69,2.85,5.33,20.21,6,38.85C232.55,90.89,230.46,118.89,216.72,143.64Zm-4.3-100.07c-14.15-3-64.1-11-100.3,14.75a81.21,81.21,0,0,0-16,15.07,36,36,0,0,0,39.35,38.44,8,8,0,0,1,8.73,8.73,36,36,0,0,0,38.47,39.34,80.81,80.81,0,0,0,15-16C223.42,107.73,215.42,57.74,212.42,43.57Z" },
  { id: "bird", name: "새", d: "M236.44,73.34,213.21,57.86A60,60,0,0,0,156,16h-.29C122.79,16.16,96,43.47,96,76.89V96.63L11.63,197.88l-.1.12A16,16,0,0,0,24,224h88A104.11,104.11,0,0,0,216,120V100.28l20.44-13.62a8,8,0,0,0,0-13.32ZM126.15,133.12l-60,72a8,8,0,1,1-12.29-10.24l60-72a8,8,0,1,1,12.29,10.24ZM164,80a12,12,0,1,1,12-12A12,12,0,0,1,164,80Z" },
  { id: "bfly", name: "나비", d: "M128,100.17a108.42,108.42,0,0,0-8-12.64V56a8,8,0,0,1,16,0V87.53A108.42,108.42,0,0,0,128,100.17ZM232.7,50.48C229,45.7,221.84,40,209,40c-16.85,0-38.46,11.28-57.81,30.16A140.07,140.07,0,0,0,136,87.53V180a8,8,0,0,1-16,0V87.53a140.07,140.07,0,0,0-15.15-17.37C85.49,51.28,63.88,40,47,40,34.16,40,27,45.7,23.3,50.48c-6.82,8.77-12.18,24.08-.21,71.2,6.05,23.83,19.51,33,30.63,36.42A44,44,0,0,0,128,205.27a44,44,0,0,0,74.28-47.17c11.12-3.4,24.57-12.59,30.63-36.42C239.63,95.24,244.85,66.1,232.7,50.48Z" },
  { id: "tulip", name: "꽃", d: "M208,48a87.48,87.48,0,0,0-35.36,7.43c-15.1-25.37-39.92-38-41.06-38.59a8,8,0,0,0-7.16,0c-1.14.58-26,13.22-41.06,38.59A87.48,87.48,0,0,0,48,48a8,8,0,0,0-8,8V96a88.11,88.11,0,0,0,80,87.63v35.43L83.58,200.84a8,8,0,1,0-7.16,14.32l48,24a8,8,0,0,0,7.16,0l48-24a8,8,0,0,0-7.16-14.32L136,219.06V183.63A88.11,88.11,0,0,0,216,96V56A8,8,0,0,0,208,48ZM56,96V64.44A72.1,72.1,0,0,1,120,136v31.56A72.1,72.1,0,0,1,56,96Zm144,0a72.1,72.1,0,0,1-64,71.56V136a72.1,72.1,0,0,1,64-71.56Z" },
  { id: "leaf", name: "잎", d: "M223.45,40.07a8,8,0,0,0-7.52-7.52C139.8,28.08,78.82,51,52.82,94a87.09,87.09,0,0,0-12.76,49A101.72,101.72,0,0,0,46.7,175.2a4,4,0,0,0,6.61,1.43l85-86.3a8,8,0,0,1,11.32,11.32L56.74,195.94,42.55,210.13a8.2,8.2,0,0,0-.6,11.1,8,8,0,0,0,11.71.43l16.79-16.79c14.14,6.84,28.41,10.57,42.56,11.07q1.67.06,3.33.06A86.93,86.93,0,0,0,162,203.18C205,177.18,227.93,116.21,223.45,40.07Z" },
  { id: "lucky", name: "클로버", d: "M228,120c0,22.63-6,36.72-17.93,41.87a27.3,27.3,0,0,1-11,2.13,41.75,41.75,0,0,1-8.4-.93,4.05,4.05,0,0,1-2.52-1.64,368.49,368.49,0,0,0-47.75-55.26,8,8,0,0,0-11,11.62c14.84,13.91,64.13,63.49,78.32,120.27a8,8,0,0,1-5.82,9.7A8.13,8.13,0,0,1,200,248a8,8,0,0,1-7.75-6.06c-4.12-16.47-11.65-32.48-20.46-47.09a25.85,25.85,0,0,1-1.9,7.21C164.72,214,150.63,220,128,220s-36.72-6-41.88-17.94c-5.45-12.58-.39-30.82,15-54.21.68-1,1.36-2,2-3l-3,2C82.84,158.27,68.35,164,56.89,164a27.3,27.3,0,0,1-11-2.13C34,156.72,28,142.63,28,120s6-36.72,17.93-41.88c12.59-5.45,30.83-.39,54.22,15l3,2q-1-1.5-2-3c-15.41-23.39-20.47-41.63-15-54.22C91.28,26,105.37,20,128,20s36.72,6,41.88,17.93c5.45,12.59.39,30.83-15,54.22q-1,1.53-2,3l3-2c23.39-15.41,41.63-20.47,54.22-15C222,83.28,228,97.37,228,120Z" },
  { id: "moon", name: "달", d: "M235.54,150.21a104.84,104.84,0,0,1-37,52.91A104,104,0,0,1,32,120,103.09,103.09,0,0,1,52.88,57.48a104.84,104.84,0,0,1,52.91-37,8,8,0,0,1,10,10,88.08,88.08,0,0,0,109.8,109.8,8,8,0,0,1,10,10Z" },
  { id: "sun", name: "해", d: "M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm8,24a64,64,0,1,0,64,64A64.07,64.07,0,0,0,128,64ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z" },
  { id: "snow", name: "눈송이", d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm42.37,119.22,18.94-6.76a8,8,0,1,1,5.38,15.08l-15.48,5.52,4.52,16.87a8,8,0,0,1-5.66,9.8A8.23,8.23,0,0,1,176,184a8,8,0,0,1-7.73-5.93l-5.57-20.8L136,141.86v30.83l13.66,13.65a8,8,0,0,1-11.32,11.32L128,187.31l-10.34,10.35a8,8,0,0,1-11.32-11.32L120,172.69V141.86L93.3,157.27l-5.57,20.8A8,8,0,0,1,80,184a8.23,8.23,0,0,1-2.07-.27,8,8,0,0,1-5.66-9.8l4.52-16.87-15.48-5.52a8,8,0,0,1,5.38-15.08l18.94,6.76L112,128,85.63,112.78l-18.94,6.76A8.18,8.18,0,0,1,64,120a8,8,0,0,1-2.69-15.54l15.48-5.52L72.27,82.07a8,8,0,0,1,15.46-4.14l5.57,20.8L120,114.14V83.31L106.34,69.66a8,8,0,0,1,11.32-11.32L128,68.69l10.34-10.35a8,8,0,0,1,11.32,11.32L136,83.31v30.83l26.7-15.41,5.57-20.8a8,8,0,0,1,15.46,4.14l-4.52,16.87,15.48,5.52A8,8,0,0,1,192,120a8.18,8.18,0,0,1-2.69-.46l-18.94-6.76L144,128Z" },
  { id: "cloud", name: "구름", d: "M160.06,40A88.1,88.1,0,0,0,81.29,88.67h0A87.48,87.48,0,0,0,72,127.73,8.18,8.18,0,0,1,64.57,136,8,8,0,0,1,56,128a103.66,103.66,0,0,1,5.34-32.92,4,4,0,0,0-4.75-5.18A64.09,64.09,0,0,0,8,152c0,35.19,29.75,64,65,64H160a88.09,88.09,0,0,0,87.93-91.48C246.11,77.54,207.07,40,160.06,40Z" },
  { id: "orbit", name: "행성", d: "M245.11,60.68c-7.65-13.19-27.85-16.16-58.5-8.66A96,96,0,0,0,32.81,140.3C5.09,169,5.49,186,10.9,195.32,16,204.16,26.64,208,40.64,208a124.11,124.11,0,0,0,28.79-4,96,96,0,0,0,153.78-88.25c12.51-13,20.83-25.35,23.66-35.92C248.83,72.51,248.24,66.07,245.11,60.68Zm-13.69,15c-6.11,22.78-48.65,57.31-87.52,79.64-67.81,39-113.62,41.52-119.16,32-1.46-2.51-.65-7.24,2.22-13a80.06,80.06,0,0,1,10.28-15.05,95.53,95.53,0,0,0,6.23,14.18,4,4,0,0,0,4,2.12,122.14,122.14,0,0,0,16.95-3.32c21.23-5.55,46.63-16.48,71.52-30.78s47-30.66,62.45-46.15A122.74,122.74,0,0,0,209.7,82.45a4,4,0,0,0,.17-4.52,96.26,96.26,0,0,0-9.1-12.46c14.21-2.35,27.37-2.17,30.5,3.24C232.19,70.28,232.24,72.63,231.42,75.69Z" },
  { id: "skull", name: "해골", d: "M128,16C70.65,16,24,60.86,24,116c0,34.1,18.27,66,48,84.28V216a16,16,0,0,0,16,16h8a4,4,0,0,0,4-4V200.27a8.17,8.17,0,0,1,7.47-8.25,8,8,0,0,1,8.53,8v28a4,4,0,0,0,4,4h16a4,4,0,0,0,4-4V200.27a8.17,8.17,0,0,1,7.47-8.25,8,8,0,0,1,8.53,8v28a4,4,0,0,0,4,4h8a16,16,0,0,0,16-16V200.28C213.73,182,232,150.1,232,116,232,60.86,185.35,16,128,16ZM92,152a20,20,0,1,1,20-20A20,20,0,0,1,92,152Zm72,0a20,20,0,1,1,20-20A20,20,0,0,1,164,152Z" },
  { id: "ghost", name: "유령", d: "M128,24a96.11,96.11,0,0,0-96,96v96a8,8,0,0,0,13.07,6.19l24.26-19.85L93.6,222.19a8,8,0,0,0,10.13,0L128,202.34l24.27,19.85a8,8,0,0,0,10.13,0l24.27-19.85,24.26,19.85A8,8,0,0,0,224,216V120A96.11,96.11,0,0,0,128,24ZM100,128a12,12,0,1,1,12-12A12,12,0,0,1,100,128Zm56,0a12,12,0,1,1,12-12A12,12,0,0,1,156,128Z" },
  { id: "rkt", name: "로켓", d: "M101.85,191.14C97.34,201,82.29,224,40,224a8,8,0,0,1-8-8c0-42.29,23-57.34,32.86-61.85a8,8,0,0,1,6.64,14.56c-6.43,2.93-20.62,12.36-23.12,38.91,26.55-2.5,36-16.69,38.91-23.12a8,8,0,1,1,14.56,6.64Zm122-144a16,16,0,0,0-15-15c-12.58-.75-44.73.4-71.4,27.07h0L88,108.7A8,8,0,0,1,76.67,97.39l26.56-26.57A4,4,0,0,0,100.41,64H74.35A15.9,15.9,0,0,0,63,68.68L28.7,103a16,16,0,0,0,9.07,27.16l38.47,5.37,44.21,44.21,5.37,38.49a15.94,15.94,0,0,0,10.78,12.92,16.11,16.11,0,0,0,5.1.83A15.91,15.91,0,0,0,153,227.3L187.32,193A16,16,0,0,0,192,181.65V155.59a4,4,0,0,0-6.83-2.82l-26.57,26.56a8,8,0,0,1-11.71-.42,8.2,8.2,0,0,1,.6-11.1l49.27-49.27h0C223.45,91.86,224.6,59.71,223.85,47.12Z" },
  { id: "smile", name: "스마일", d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24ZM92,96a12,12,0,1,1-12,12A12,12,0,0,1,92,96Zm82.92,60c-10.29,17.79-27.39,28-46.92,28s-36.63-10.2-46.92-28a8,8,0,1,1,13.84-8c7.47,12.91,19.21,20,33.08,20s25.61-7.1,33.08-20a8,8,0,1,1,13.84,8ZM164,120a12,12,0,1,1,12-12A12,12,0,0,1,164,120Z" },
  { id: "peace", name: "브이", d: "M96.55,36.14a16,16,0,0,1,11-19.52c8.61-2.46,17.65,3,20,11.65l16,59.78a4,4,0,0,1-3.18,5A31.79,31.79,0,0,0,128,98c-.56.37-1.1.76-1.64,1.17-.33-.58-.67-1.16-1-1.72a31.74,31.74,0,0,0-14-11.72,3.94,3.94,0,0,1-2.25-2.62ZM80.4,176.65a16.17,16.17,0,0,0,3.23.33A16,16,0,0,0,86.8,145.3l-19.59-4a16,16,0,0,0-6.41,31.35Zm-19.6-53,34.64,7.07a16,16,0,1,0,6.4-31.35L67.21,92.33A16,16,0,0,0,48.33,104.8,16,16,0,0,0,60.8,123.68Zm102-28.16,23.55,4.81A4,4,0,0,0,191,97.44l16.42-61.3a16,16,0,0,0-30.91-8.28l-16.8,62.7A4,4,0,0,0,162.81,95.52Zm37.34,31.74a23.89,23.89,0,0,0-15.67-11L148.87,109a16,16,0,0,0-15.12,5,14,14,0,0,0-2.43,3.57,16,16,0,0,0,1.72,17,16.5,16.5,0,0,0,9.8,5.93l15.24,3.11a8.06,8.06,0,0,1,6.32,9.36,28,28,0,0,0,2.77,19,8.19,8.19,0,0,1-1.93,10.41,8,8,0,0,1-11.94-2.43,44,44,0,0,1-5.48-22.09L139.27,156A31.78,31.78,0,0,1,119,142.32c-.38-.57-.73-1.15-1.06-1.74a32.12,32.12,0,0,1-6.87,4A32,32,0,0,1,83.63,193a32.32,32.32,0,0,1-6.43-.65l-19.59-4h-.06a2.61,2.61,0,0,0-3,3.57A80.19,80.19,0,0,0,128,240h.61c43.77-.33,79.39-36.62,79.39-80.9v-3.34A55.72,55.72,0,0,0,200.15,127.26Z" },
];
const TITLE_ICON_MAP = new Map(TITLE_ICONS.map((i) => [i.id, i]));
function titleIconSvg(id, className = "tb-icon") {
  const icon = TITLE_ICON_MAP.get(id);
  if (!icon) return "";
  const inner = icon.inner || `<path d="${icon.d}"/>`;
  return `<svg class="${className}" viewBox="${icon.viewBox || "0 0 256 256"}" fill="currentColor" aria-hidden="true">${inner}</svg>`;
}
// 두 가지 색 섞는 방식 — grad: 왼쪽→오른쪽 그라데이션 / ink: 첫 번째 색은 배경, 두 번째 색은 글자
const TITLE_MIX_MODES = [
  { id: "grad", name: "그라데이션" },
  { id: "ink", name: "배경색 + 글자색" },
];

// 저장된 값 → { color: "#rrggbb" | "rainbow", color2: "#rrggbb" | null, mix, design, icon: id | null, star }
function parseTitleStyle(value) {
  const fallback = { color: DEFAULT_TITLE_COLOR, color2: null, mix: "grad", design: "basic", icon: null, star: false };
  if (typeof value !== "string" || !value) return fallback;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return { ...fallback, color: v };
  if (v === "rainbow") return { ...fallback, color: "rainbow" };
  const isHex6 = (t) => /^[0-9a-f]{6}$/.test(t);
  const parts = v.split("-");
  const last = parts.pop();
  let color;
  let color2 = null;
  let mix = "grad";
  if (last === "rainbow") {
    color = "rainbow";
  } else if (isHex6(last)) {
    const n = parts.length;
    if (n >= 2 && parts[n - 1] === "t" && isHex6(parts[n - 2])) {
      color = `#${parts[n - 2]}`;
      color2 = `#${last}`;
      mix = "ink";
      parts.length = n - 2;
    } else if (n >= 1 && isHex6(parts[n - 1])) {
      color = `#${parts[n - 1]}`;
      color2 = `#${last}`;
      parts.length = n - 1;
    } else {
      color = `#${last}`;
    }
  } else {
    return fallback;
  }
  let design = "basic";
  let icon = null;
  let star = false;
  for (const p of parts) {
    if (p === "star") star = true;
    else if (TITLE_ICON_MAP.has(p)) icon = p;
    else if (TITLE_DESIGN_IDS.has(p)) design = p;
  }
  return { color, color2, mix, design, icon, star };
}

// { color, color2, mix, design, icon, star } → 저장할 값
function composeTitleStyle({ color, color2, mix, design, icon, star }) {
  const isHex = (c) => /^#[0-9a-fA-F]{6}$/.test(c || "");
  const c = color === "rainbow" ? "rainbow" : (isHex(color) ? color.toLowerCase() : DEFAULT_TITLE_COLOR);
  // 무지개는 그 자체로 여러 색이라 두 번째 색이랑은 같이 안 씀
  const c2 = c !== "rainbow" && isHex(color2) ? color2.toLowerCase() : null;
  const d = TITLE_DESIGN_IDS.has(design) ? design : "basic";
  const ic = TITLE_ICON_MAP.has(icon) ? icon : null;
  if (d === "basic" && !ic && !star && !c2) return c;
  let colorPart = c === "rainbow" ? "rainbow" : c.slice(1);
  if (c2) colorPart += `${mix === "ink" ? "-t-" : "-"}${c2.slice(1)}`;
  const tokens = [d !== "basic" ? d : null, ic, star ? "star" : null].filter(Boolean);
  if (!tokens.length) tokens.push("basic");
  return [...tokens, colorPart].join("-");
}

function normalizeTitleColor(value) {
  return composeTitleStyle(parseTitleStyle(value));
}

// "#abc", "abc123", "#ABC123" 같이 사람이 대충 친 값을 "#rrggbb"로. 형식이 틀리면 null.
function parseHexColorInput(text) {
  const t = String(text || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(t)) return `#${t.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(t)) return `#${t.split("").map((ch) => ch + ch).join("").toLowerCase()}`;
  return null;
}

function hexLuminance(hex) {
  const channel = (i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

// 두 색 섞기 — 메탈 광택용 밝은/어두운 색을 칭호 색에서 자동으로 뽑을 때 씀.
function mixHex(hex, targetHex, t) {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(targetHex.slice(i, i + 2), 16));
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

// 배지 글자색 — 흰 글자 대비가 3 이상이면(굵은 작은 글자 기준) 흰색, 아니면 검은색.
// 두 가지 색 그라데이션이면 두 색의 중간색 기준.
function titleBadgeTextColor(value) {
  const { color, color2 } = parseTitleStyle(value);
  if (color === "rainbow") return "#ffffff";
  const base = color2 ? mixHex(color, color2, 0.5) : color;
  const contrastWhite = 1.05 / (hexLuminance(base) + 0.05);
  return contrastWhite >= 3 ? "#ffffff" : "#111418";
}

// 디자인별 글자색 — 배경+글자 모드면 두 번째 색 그대로, 빛나는 테두리/유리는 어두운 바탕이라 밝게.
function titleBadgeForeground({ color, color2, mix, design }) {
  if (color2 && mix === "ink") return color2;
  const base = color2 ? mixHex(color, color2, 0.5) : color;
  if (design === "glow") return mixHex(base, "#ffffff", 0.35);
  if (design === "glass") {
    const light = mixHex(base, "#ffffff", 0.55);
    return hexLuminance(light) < 0.2 ? "#e9ecef" : light;
  }
  return titleBadgeTextColor(base);
}

const TITLE_STAR_PATH = `<path fill="currentColor" d="M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6z"/>`;
const TITLE_STARS_HTML = `<span class="tb-stars" aria-hidden="true">${[1, 2, 3].map((i) => `<svg class="tb-star tb-star--${i}" viewBox="0 0 24 24">${TITLE_STAR_PATH}</svg>`).join("")}</span>`;

function titleBadgeHtml(name, value) {
  const style = parseTitleStyle(value);
  const { color, color2, mix, design, icon, star } = style;
  const classes = ["title-badge"];
  if (design !== "basic") classes.push(`title-badge--${design}`);
  if (color === "rainbow") classes.push("title-badge--rainbow");
  if (color2) classes.push(mix === "ink" ? "title-badge--ink" : "title-badge--duo");
  if (icon) classes.push("title-badge--icon");
  if (star) classes.push("title-badge--starred");
  let styleAttr = "";
  if (color !== "rainbow") {
    const vars = [
      `--badge-bg:${color}`,
      `--badge-fg:${titleBadgeForeground(style)}`,
      `--badge-light:${mixHex(color, "#ffffff", 0.55)}`,
      `--badge-dark:${mixHex(color, "#000000", 0.32)}`,
    ];
    if (color2) {
      vars.push(`--badge-bg2:${color2}`, `--badge-light2:${mixHex(color2, "#ffffff", 0.55)}`, `--badge-dark2:${mixHex(color2, "#000000", 0.32)}`);
    }
    styleAttr = ` style="${vars.join(";")}"`;
  }
  const sweep = design === "shine" ? `<span class="tb-sweep" aria-hidden="true"></span>` : "";
  return `<span class="${classes.join(" ")}"${styleAttr}>${sweep}${icon ? titleIconSvg(icon) : ""}<span class="tb-text">${escapeHtmlForAuth(name)}</span>${star ? TITLE_STARS_HTML : ""}</span>`;
}

// 랭킹/홈에서 이름 앞에 붙이는 장착 칭호(뒤에 한 칸 띄움).
function renderShopTitleBadgeHtml(shopName, color) {
  return shopName ? `${titleBadgeHtml(shopName, color)} ` : "";
}

// 칭호 꾸미기 UI — 상점 칭호 상품 추가/수정 모달, 관리자 칭호 지급 폼에서 같이 씀.
//  - 색: 예시 동그라미 중에 고르거나, "+" 동그라미(색상표)나 HEX 칸으로 직접 지정
//  - 두 가지 색: 켜면 색 줄이 하나 더 생기고 섞는 방식(그라데이션 / 배경+글자)을 고름
//  - 디자인: 기본 / 메탈 반짝 / 빛나는 테두리 / 유리 (각 버튼에 지금 색으로 미리보기)
//  - 아이콘: 왕관/책/하트 등 목록에서 하나 골라서 글자 앞에 붙임(색은 글자색 단색)
//  - 반짝이 별: 체크하면 모서리에 반짝이 별
// 전부 서로 같이 쓸 수 있음(무지개만 두 번째 색이랑 같이 안 됨). 아래 미리보기는 실제 배지 모양 그대로.
//   const picker = createTitleColorPicker(hostEl, { initialColor, getPreviewName: () => input.value });
//   picker.getColor() → 저장할 값 / picker.setColor(값) / picker.refreshPreview()
function createTitleColorPicker(hostEl, { initialColor, getPreviewName } = {}) {
  let state = parseTitleStyle(initialColor);
  // 색상표(input[type=color])는 일반 색만 다룰 수 있어서, 무지개일 땐 마지막 일반 색을 기억해둠.
  let lastHex = state.color === "rainbow" ? DEFAULT_TITLE_COLOR : state.color;
  // 두 가지 색을 껐다 켜도 전에 고른 두 번째 색이 돌아오게 기억
  let lastHex2 = state.color2 || "#5dc8ff";
  const swatchesHtml = (group, withRainbow) => `
    ${TITLE_COLOR_PRESETS.filter((p) => withRainbow || p.value !== "rainbow").map((p) => `
      <button type="button" class="title-color-swatch${p.value === "rainbow" ? " title-color-swatch--rainbow" : ""}" role="radio" data-group="${group}" data-color="${p.value}"
        style="--swatch:${p.value === "rainbow" ? "transparent" : p.value};--swatch-fg:${titleBadgeTextColor(p.value)}" title="${p.name}" aria-label="${p.name}"></button>`).join("")}
    <label class="title-color-swatch title-color-custom" data-group="${group}" title="색상표에서 직접 고르기" aria-label="색상표에서 직접 고르기">
      <svg class="title-color-custom-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      <input type="color" class="title-color-input">
    </label>`;
  const hexFieldHtml = (group) => `
    <label class="title-color-hex-field">
      <span>HEX</span>
      <input type="text" class="title-color-hex-input" data-group="${group}" maxlength="7" spellcheck="false" autocomplete="off" placeholder="#00e5a0">
    </label>`;
  hostEl.innerHTML = `
    <div class="title-color-picker">
      <div class="title-color-group" data-group="1">
        <div class="title-color-group-head"><span class="title-color-group-label"></span>${hexFieldHtml("1")}</div>
        <div class="title-color-swatches" role="radiogroup" aria-label="칭호 색상">${swatchesHtml("1", true)}</div>
      </div>
      <div class="title-duo-bar">
        <label class="title-option-toggle title-duo-toggle"><input type="checkbox" class="title-duo-input"> 두 가지 색 섞기</label>
        <div class="title-mix-options" role="radiogroup" aria-label="섞는 방식">
          ${TITLE_MIX_MODES.map((m) => `<button type="button" class="title-mix-option" role="radio" data-mix="${m.id}">${m.name}</button>`).join("")}
        </div>
        <button type="button" class="title-duo-swap" title="두 색 순서 바꾸기">⇄ 순서 바꾸기</button>
        <span class="title-duo-note">무지개는 두 번째 색이랑 같이 못 써요</span>
      </div>
      <div class="title-color-group" data-group="2">
        <div class="title-color-group-head"><span class="title-color-group-label"></span>${hexFieldHtml("2")}</div>
        <div class="title-color-swatches" role="radiogroup" aria-label="두 번째 색">${swatchesHtml("2", false)}</div>
      </div>
      <div class="title-design-row">
        <span class="title-design-label">디자인</span>
        <div class="title-design-options" role="radiogroup" aria-label="칭호 디자인">
          ${TITLE_DESIGNS.map((d) => `
            <button type="button" class="title-design-option" role="radio" data-design="${d.id}">
              <span class="title-design-sample"></span><span class="title-design-name">${d.name}</span>
            </button>`).join("")}
        </div>
      </div>
      <div class="title-extra-row">
        <span class="title-design-label">장식</span>
        <button type="button" class="title-icon-toggle" aria-expanded="false">
          <span class="title-icon-current"></span>
          <svg class="title-icon-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <label class="title-option-toggle"><input type="checkbox" class="title-star-input"> 반짝이 별</label>
      </div>
      <div class="title-icon-panel" hidden>
        <div class="title-icon-grid" role="radiogroup" aria-label="아이콘">
          <button type="button" class="title-icon-option title-icon-option--none" role="radio" data-icon="" title="아이콘 없음" aria-label="아이콘 없음">없음</button>
          ${TITLE_ICONS.map((i) => `<button type="button" class="title-icon-option" role="radio" data-icon="${i.id}" title="${i.name}" aria-label="${i.name}">${titleIconSvg(i.id, "title-icon-glyph")}</button>`).join("")}
        </div>
      </div>
      <div class="title-color-preview">
        <span class="title-color-preview-label">미리보기</span>
        <span class="title-color-preview-badge"></span>
        <span class="title-color-preview-name">닉네임</span>
      </div>
    </div>`;
  const group1 = hostEl.querySelector('.title-color-group[data-group="1"]');
  const group2 = hostEl.querySelector('.title-color-group[data-group="2"]');
  const swatches = Array.from(hostEl.querySelectorAll(".title-color-swatch[data-color]"));
  const customLabels = { 1: group1.querySelector(".title-color-custom"), 2: group2.querySelector(".title-color-custom") };
  const customInputs = { 1: customLabels[1].querySelector("input"), 2: customLabels[2].querySelector("input") };
  const hexInputs = { 1: group1.querySelector(".title-color-hex-input"), 2: group2.querySelector(".title-color-hex-input") };
  const groupLabels = { 1: group1.querySelector(".title-color-group-label"), 2: group2.querySelector(".title-color-group-label") };
  const duoInput = hostEl.querySelector(".title-duo-input");
  const duoBar = hostEl.querySelector(".title-duo-bar");
  const mixButtons = Array.from(hostEl.querySelectorAll(".title-mix-option"));
  const swapButton = hostEl.querySelector(".title-duo-swap");
  const designButtons = Array.from(hostEl.querySelectorAll(".title-design-option"));
  const iconToggle = hostEl.querySelector(".title-icon-toggle");
  const iconCurrent = hostEl.querySelector(".title-icon-current");
  const iconPanel = hostEl.querySelector(".title-icon-panel");
  const iconButtons = Array.from(hostEl.querySelectorAll(".title-icon-option"));
  const starInput = hostEl.querySelector(".title-star-input");
  const badgeSlot = hostEl.querySelector(".title-color-preview-badge");

  function setGroupColor(group, value) {
    if (group === "1") {
      state = { ...state, color: value };
      // 무지개를 고르면 두 번째 색은 꺼짐(다시 일반 색 고르고 켜면 전에 고른 색이 돌아옴)
      if (value === "rainbow") state.color2 = null;
    } else {
      state = { ...state, color2: value };
    }
  }

  function render({ keepHexInput = null } = {}) {
    const isRainbow = state.color === "rainbow";
    if (!isRainbow) lastHex = state.color;
    if (state.color2) lastHex2 = state.color2;
    const duoOn = Boolean(state.color2);
    ["1", "2"].forEach((g) => {
      const current = g === "1" ? state.color : (state.color2 || lastHex2);
      const isPreset = swatches.some((b) => b.dataset.group === g && b.dataset.color === current);
      swatches.filter((b) => b.dataset.group === g).forEach((b) => {
        const on = b.dataset.color === current;
        b.classList.toggle("is-selected", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
      customLabels[g].classList.toggle("is-selected", !isPreset);
      customLabels[g].style.setProperty("--swatch", isPreset ? "" : current);
      customLabels[g].style.setProperty("--swatch-fg", titleBadgeTextColor(current));
      customInputs[g].value = g === "1" ? lastHex : lastHex2;
      if (keepHexInput !== g) hexInputs[g].value = current === "rainbow" ? "" : current;
      hexInputs[g].placeholder = current === "rainbow" ? "무지개" : "#00e5a0";
      hexInputs[g].classList.remove("is-invalid");
    });
    group2.hidden = !duoOn;
    duoInput.checked = duoOn;
    duoInput.disabled = isRainbow;
    duoBar.classList.toggle("is-on", duoOn);
    duoBar.classList.toggle("is-rainbow", isRainbow);
    mixButtons.forEach((b) => {
      const on = b.dataset.mix === state.mix;
      b.classList.toggle("is-selected", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
    const labels = !duoOn ? ["색", ""] : state.mix === "ink" ? ["배경색", "글자색"] : ["왼쪽 색", "오른쪽 색"];
    groupLabels[1].textContent = labels[0];
    groupLabels[2].textContent = labels[1];
    designButtons.forEach((b) => {
      const on = b.dataset.design === state.design;
      b.classList.toggle("is-selected", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.querySelector(".title-design-sample").innerHTML =
        titleBadgeHtml("가나", composeTitleStyle({ ...state, design: b.dataset.design, icon: null, star: false }));
    });
    const currentIcon = TITLE_ICON_MAP.get(state.icon);
    iconCurrent.innerHTML = currentIcon
      ? `${titleIconSvg(currentIcon.id, "title-icon-glyph")}<span>아이콘: ${currentIcon.name}</span>`
      : `<span>아이콘 붙이기</span>`;
    iconToggle.classList.toggle("has-icon", Boolean(currentIcon));
    iconButtons.forEach((b) => {
      const on = (b.dataset.icon || null) === (state.icon || null);
      b.classList.toggle("is-selected", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
    starInput.checked = state.star;
    const name = (getPreviewName ? String(getPreviewName() || "") : "").trim() || "칭호";
    badgeSlot.innerHTML = titleBadgeHtml(name, composeTitleStyle(state));
  }

  // HEX 칸: 올바른 코드가 되는 순간 바로 반영(입력 중인 글자는 건드리지 않음), 칸을 벗어날 때
  // 형식이 틀려 있으면 현재 색으로 되돌림.
  ["1", "2"].forEach((g) => {
    const input = hexInputs[g];
    input.addEventListener("input", () => {
      const parsed = parseHexColorInput(input.value);
      if (parsed && /^#?[0-9a-fA-F]{6}$/.test(input.value.trim())) {
        setGroupColor(g, parsed);
        render({ keepHexInput: g });
      } else {
        input.classList.toggle("is-invalid", input.value.trim().length > 0);
      }
    });
    input.addEventListener("change", () => {
      const parsed = parseHexColorInput(input.value);
      if (parsed) setGroupColor(g, parsed);
      render();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    });
    customInputs[g].addEventListener("input", () => {
      const parsed = parseHexColorInput(customInputs[g].value);
      if (parsed) setGroupColor(g, parsed);
      render();
    });
  });
  swatches.forEach((b) => b.addEventListener("click", () => { setGroupColor(b.dataset.group, b.dataset.color); render(); }));
  duoInput.addEventListener("change", () => {
    state = { ...state, color2: duoInput.checked && state.color !== "rainbow" ? lastHex2 : null };
    render();
  });
  mixButtons.forEach((b) => b.addEventListener("click", () => { state = { ...state, mix: b.dataset.mix }; render(); }));
  swapButton.addEventListener("click", () => {
    if (!state.color2 || state.color === "rainbow") return;
    state = { ...state, color: state.color2, color2: state.color };
    render();
  });
  designButtons.forEach((b) => b.addEventListener("click", () => { state = { ...state, design: b.dataset.design }; render(); }));
  iconToggle.addEventListener("click", () => {
    iconPanel.hidden = !iconPanel.hidden;
    iconToggle.setAttribute("aria-expanded", iconPanel.hidden ? "false" : "true");
    iconToggle.classList.toggle("is-open", !iconPanel.hidden);
  });
  iconButtons.forEach((b) => b.addEventListener("click", () => { state = { ...state, icon: b.dataset.icon || null }; render(); }));
  starInput.addEventListener("change", () => { state = { ...state, star: starInput.checked }; render(); });
  render();

  return {
    getColor: () => composeTitleStyle(state),
    setColor: (value) => {
      state = parseTitleStyle(value);
      lastHex = state.color === "rainbow" ? DEFAULT_TITLE_COLOR : state.color;
      lastHex2 = state.color2 || "#5dc8ff";
      iconPanel.hidden = true;
      iconToggle.classList.remove("is-open");
      iconToggle.setAttribute("aria-expanded", "false");
      render();
    },
    refreshPreview: render,
  };
}

// 공지사항 첨부파일 — storage_path("notices/xxxx-파일명")로 퍼블릭 URL을 만듦. 세그먼트별로
// encodeURIComponent를 걸어야 파일명에 한글/공백이 섞여있어도(정책상 공백은 서버가 이미
// "_"로 바꿔서 저장하지만, 한글은 그대로 저장함) 안전하게 URL에 들어감 — "/"까지 인코딩되면
// 안 되니 세그먼트로 나눠서 각각 인코딩 후 다시 합침.
function noticeAttachmentUrl(storagePath) {
  const encoded = String(storagePath).split("/").map(encodeURIComponent).join("/");
  return `${NOTICE_ATTACHMENTS_PUBLIC_BASE}/${encoded}`;
}

function formatNoticeFileSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const NOTICE_FILE_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;
const NOTICE_DOWNLOAD_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>`;

// 공지 첨부파일을 이미지 갤러리 + 일반 파일 다운로드 목록 HTML로 렌더링함. notice.html의
// 게시판 뷰, index.html의 미리보기 팝업이 이 함수를 그대로 씀(중복 방지 — 둘 다 보기 전용
// 렌더링이라 완전히 같은 모양이면 됨). attachments는 notice_attachments 행 배열를 그대로
// 받음 — anon 클라이언트로 테이블을 직접 조회한 결과라 컬럼명 그대로(snake_case)임:
// kind/file_name/storage_path/mime_type/size_bytes (notices.created_at 등과 같은 이유,
// Edge Function JSON 응답의 camelCase와는 다름 — 그쪽은 predictions/admin 함수 참고).
// 반환값 { galleryHtml, fileListHtml } — 비어있으면 빈 문자열이라 호출부에서 hidden 처리하면 됨.
function renderNoticeAttachmentsHtml(attachments) {
  if (!attachments || attachments.length === 0) return { galleryHtml: "", fileListHtml: "" };
  const images = attachments.filter((a) => a.kind === "image");
  const files = attachments.filter((a) => a.kind === "file");

  const galleryHtml = images.map((a) => {
    const url = noticeAttachmentUrl(a.storage_path);
    const name = escapeHtmlForAuth(a.file_name);
    return `
      <span class="notice-gallery-thumb">
        <a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${name}" loading="lazy"></a>
        <a class="notice-gallery-download-btn" href="${url}?download=${encodeURIComponent(a.file_name)}" title="다운로드" aria-label="다운로드">${NOTICE_DOWNLOAD_ICON_SVG}</a>
      </span>`;
  }).join("");

  const fileListHtml = files.map((a) => {
    const url = noticeAttachmentUrl(a.storage_path);
    return `
      <a class="notice-file-row" href="${url}?download=${encodeURIComponent(a.file_name)}">
        <span class="notice-file-icon">${NOTICE_FILE_ICON_SVG}</span>
        <span class="notice-file-name">${escapeHtmlForAuth(a.file_name)}</span>
        <span class="notice-file-size">${formatNoticeFileSize(a.size_bytes)}</span>
      </a>`;
  }).join("");

  return { galleryHtml, fileListHtml };
}

// 사이드바 접기/펴기 토글 버튼 연결. localStorage에 상태를 저장해서 다른 페이지로 이동해도 유지됨.
// (각 페이지 <body> 맨 앞의 인라인 스크립트가 렌더링 시작 전에 미리 같은 클래스를 적용해두기 때문에,
//  페이지를 열자마자 "펼쳐졌다가 순간적으로 접히는" 깜빡임이 없음.)
function initSidebarToggle() {
  const toggleBtn = document.getElementById("sidebar-toggle");
  if (!toggleBtn) return;
  // 라우터(spa-router.js)로 페이지를 넘길 때마다 페이지 스크립트가 다시 실행되면서 이 함수도
  // 다시 호출되는데, 사이드바 자체는 페이지 전환 때 다시 그려지지 않고 계속 같은 엘리먼트라서
  // 매번 리스너를 새로 붙이면 클릭 이벤트가 중복으로 쌓임 — 그래서 한 번 붙였으면 건너뜀.
  if (toggleBtn.dataset.bound === "1") return;
  toggleBtn.dataset.bound = "1";
  toggleBtn.addEventListener("click", () => {
    const next = !document.body.classList.contains("sidebar-collapsed");
    document.body.classList.toggle("sidebar-collapsed", next);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
  });
}

// 사이드바의 "관리자" 링크는 기본 hidden — 관리자 계정으로 로그인된 경우에만 보여줌.
// 각 페이지 <nav class="sidebar-nav">에 <a href="admin.html" id="admin-nav-link" hidden> 를 두고
// renderSidebarUser() 근처에서 한 번 호출하면 됨.
function initAdminNav() {
  const el = document.getElementById("admin-nav-link");
  if (!el) return;
  el.hidden = !isAdmin();
}

// 사이드바 "공지사항" 링크에 새 글 알림 점(.notice-nav-badge)을 띄움. 서버에 유저별 열람
// 기록을 두지 않고 localStorage에 "마지막으로 확인한 시각"만 남기는 가벼운 방식이라, 기기를
// 바꾸면 다시 뜰 수 있음 — 공지사항처럼 가볍게 훑어보는 용도엔 그 정도로 충분하다고 판단함.
// 이 기능을 막 배포한 시점엔 아무도 아직 "확인"한 적이 없어서 기존 공지 전체가 전부 새 글처럼
// 떠버리는 걸 막기 위해, localStorage에 값이 아예 없는 최초 1회는 점을 띄우지 않고 조용히
// 지금 최신 글 시각으로 기준값만 채워둠(그 다음부터 진짜 새 공지가 생기면 정상적으로 뜸).
// index/notice/ranking/attendance/mypage/shop/admin html이 전부 사이드바 초기화 직후 이 함수를
// 호출함 — supabase-client를 자체적으로 import함(같은 assets/js 디렉터리 기준 상대경로라
// "./supabase-client.js" — 페이지 쪽 inline script가 쓰는 "./assets/js/supabase-client.js"와
// 다름에 주의: 이 파일은 <script src>로 로드된 별도 스크립트라 동적 import 기준 경로가
// chzzk-auth.js 자신의 위치이지 문서 위치가 아님).
async function initNoticeBadge() {
  try {
    const { supabase } = await import("./supabase-client.js");
    const { data, error } = await supabase
      .from("notices")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return;

    const lastSeen = localStorage.getItem(NOTICE_LAST_SEEN_KEY);
    if (!lastSeen) {
      localStorage.setItem(NOTICE_LAST_SEEN_KEY, data.created_at);
      return;
    }
    setNoticeBadgeVisible(new Date(data.created_at) > new Date(lastSeen));
  } catch {
    // 배지는 있으면 좋은 부가기능이라 실패해도 조용히 무시함(페이지 핵심 기능엔 영향 없음).
  }
}

function setNoticeBadgeVisible(visible) {
  document.querySelectorAll(".notice-nav-badge").forEach((el) => {
    el.hidden = !visible;
  });
}

// 지금까지 저장된 "마지막으로 확인한 시각"을 건드리지 않고 그냥 읽기만 함. 공지 목록/미리보기가
// 각 글 옆에 "새 글" 표시를 달 때, 이 값보다 나중에 올라온 글만 새 글로 표시하는 기준으로 씀 —
// markNoticesSeen()으로 값을 갱신하기 *전에* 호출해야 의미가 있음(안 그러면 방금 갱신된 "지금"
// 시각과 비교하게 돼서 전부 새 글이 아닌 걸로 나옴). 값이 아예 없으면(이 기기에서 공지사항을
// 한 번도 확인한 적 없음) null을 그대로 돌려줌 — 호출부에서 null이면 "새 글 없음"으로 취급해야
// initNoticeBadge()의 최초 1회 무음 처리와 일관됨(안 그러면 신규 유저 눈엔 기존 글이 전부 새
// 글처럼 보여버림).
function getNoticeLastSeenAt() {
  try {
    return localStorage.getItem(NOTICE_LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

// notice.html이 목록을 불러온 직후 호출함 — 지금 시각을 "마지막으로 확인함" 기준으로 저장하고
// 배지를 곧바로 숨김. 방금 불러온 목록엔 그 시점까지의 모든 공지가 들어있으니, 가장 최근 글의
// created_at이 아니라 그냥 현재 시각을 기준으로 잡아도 됨 — 더 단순하고 서버-클라이언트 시계
// 오차를 신경 쓸 필요도 없음.
function markNoticesSeen() {
  localStorage.setItem(NOTICE_LAST_SEEN_KEY, new Date().toISOString());
  setNoticeBadgeVisible(false);
}

// 사이드바 "포인트 상점" 아코디언 그룹(펼치면 일반 상점/칭호 상점 하위 링크가 나오는 형태).
// 펼침 상태는 일부러 localStorage에 저장하지 않음 — 새로고침/최초 접속 시엔 항상 접힌
// 상태로 시작하고, 눌러야만 펼쳐지게 하기 위함(디폴트로 펼쳐져 있던 걸 고쳐달라는 피드백
// 반영). SPA 페이지 전환 중에는(spa-router.js가 .main-content만 갈아끼우고 사이드바
// 엘리먼트 자체는 그대로 두므로) body 클래스가 자연히 유지돼서 펼친 채로 다른 페이지로
// 이동해도 다시 접히지 않음 — 진짜 새로고침(F5)이나 새 탭으로 열 때만 초기 상태로 리셋됨.
function initShopNavGroup() {
  const toggleBtn = document.getElementById("shop-nav-toggle");
  if (toggleBtn && toggleBtn.dataset.bound !== "1") {
    toggleBtn.dataset.bound = "1";
    toggleBtn.addEventListener("click", () => {
      document.body.classList.toggle("shop-nav-expanded");
    });
  }

  // 하위 링크(일반 상점/칭호 상점) 클릭 처리. spa-router.js의 document 클릭 리스너는
  // e.defaultPrevented가 true면 맨 처음에 그냥 return하므로, 여기서 먼저
  // preventDefault를 호출해두면 이 핸들러가 라우팅을 전적으로 책임지게 됨.
  // (같은 shop.html 안에서의 앵커 이동은 spa-router가 "이미 있는 페이지"로 보고
  // 아무것도 안 하는 죽은 클릭이 되는 문제를 이렇게 피함.)
  document.querySelectorAll(".sidebar-nav-sublink").forEach((link) => {
    if (link.dataset.bound === "1") return;
    link.dataset.bound = "1";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = link.dataset.shopAnchor;
      const href = link.getAttribute("href");

      if (isOnShopPage()) {
        history.pushState({ spaPage: "shop.html" }, "", href);
        showShopSection(targetId);
      } else if (typeof spaNavigate === "function") {
        // shop.html 스크립트가 다시 실행되는 시점엔 아직 location.hash가 갱신 전이라
        // (spa-router가 pushState를 스크립트 실행보다 나중에 하기 때문) 목표 섹션 id를
        // 전역에 잠깐 남겨두고 shop.html 쪽에서 꺼내 쓰게 함.
        window.__pendingShopScrollTarget = targetId;
        spaNavigate(href);
      } else {
        location.href = href;
      }

      // 이 클릭 자체가 "포인트 상점으로 이동"이라는 의도이므로, 목적지 페이지 스크립트가
      // 실제로 실행되기 전(라우터가 fetch+전환하는 짧은 순간)이라도 사이드바 하이라이트는
      // 클릭 즉시 반영함 — location.href 기준으로 판단하면 spa-router가 history.pushState를
      // 스크립트 실행보다 나중에 하는 탓에 한 박자 늦게(또는 아예 안) 반영되는 문제가 있었음.
      // 페이지 전환이 끝나면 아래 updateShopNavActiveState()가 다시 한 번 정확하게 맞춰줌.
      setShopNavActive(targetId);
    });
  });

  updateShopNavActiveState();
}

// 지금 보고 있는 페이지가 shop.html인지 판단. location.pathname/href는 spa-router.js가
// 실제 이동을 다 끝낸 뒤에야(history.pushState) 갱신되기 때문에 그 시점까지 못 믿고, 대신
// shop.html에만 있는 DOM(#general-shop-section)의 존재 여부로 판단함 — main-content는
// 페이지 스크립트가 다시 실행되기 전에 이미 교체돼 있어서 이 방식은 항상 정확함.
function isOnShopPage() {
  return document.getElementById("general-shop-section") !== null;
}

// shop.html 안에서 일반 상점/칭호 상점 중 하나만 보이게 전환함(둘 다 같은 자리에 있고
// 서로 완전히 분리된 탭처럼 동작 — 스크롤이 아니라 표시/숨김으로 바꿈). shop.html이 아닌
// 페이지에서는 두 섹션 엘리먼트가 없어서 아무 일도 안 하고 조용히 리턴.
function showShopSection(targetId) {
  const generalEl = document.getElementById("general-shop-section");
  const titleEl = document.getElementById("title-shop-section");
  if (!generalEl || !titleEl) return;
  const showTitle = targetId === "title-shop-section";
  generalEl.hidden = showTitle;
  titleEl.hidden = !showTitle;
  // 두 섹션이 #global-status 하나를 공유해서, 일반 상점에서 "OOO 사용했어요!" 메시지가 뜬
  // 채로 칭호 상점 탭으로 넘어가도(페이지 재실행 없이 이 함수만 호출되는 탭 전환이라) 그
  // 메시지가 그대로 남아있던 버그가 있었음 — 지금 보고 있는 섹션과 무관한 안내라 헷갈림.
  // 섹션을 바꿀 때마다 비워서 각 탭이 "깨끗한 상태"로 시작하게 함.
  const statusEl = document.getElementById("global-status");
  if (statusEl) {
    statusEl.textContent = "";
    statusEl.className = "status-msg";
  }
}

// 토글 버튼 + 하위 링크 중 하나(targetId)를 즉시 활성 표시로 바꿈. 실제로 shop.html로
// 이동했는지와 무관하게, 하위 링크를 누른 시점에 바로 호출해서 하이라이트가 늦게 뜨는
// 문제를 없앰.
function setShopNavActive(targetId) {
  const toggleBtn = document.getElementById("shop-nav-toggle");
  if (toggleBtn) toggleBtn.classList.add("active");
  document.querySelectorAll(".sidebar-nav-sublink").forEach((link) => {
    link.classList.toggle("active", link.dataset.shopAnchor === targetId);
  });
}

// "포인트 상점" 토글 버튼/하위 링크의 active 표시를 현재 페이지·해시 기준으로 갱신.
// spa-router.js의 active 갱신 루프는 .sidebar-nav-sublink는 건드리지 않고 건너뛰므로
// (하위 링크는 href가 전부 shop.html#...라 단순 href 비교로는 구분이 안 됨) 이 함수가 전담.
// 각 페이지 스크립트 맨 끝에서 initShopNavGroup()을 통해 매번 호출되므로, 다른 페이지로
// 넘어갔을 때 토글/하위 링크의 active를 지우는 것도 이 함수가 담당.
function updateShopNavActiveState() {
  const toggleBtn = document.getElementById("shop-nav-toggle");
  const onShopPage = isOnShopPage();

  if (toggleBtn) toggleBtn.classList.toggle("active", onShopPage);

  if (!onShopPage) {
    document.querySelectorAll(".sidebar-nav-sublink").forEach((link) => link.classList.remove("active"));
    return;
  }

  // location.hash는 direct load/새로고침/뒤로가기(popstate)에선 이미 정확하지만, 하위 링크로
  // 막 넘어온 직후엔 아직 안 바뀌어 있을 수 있어서(위 클릭 핸들러 주석 참고) 그 경우엔
  // window.__pendingShopScrollTarget(클릭 핸들러가 남겨둔 값)을 우선 씀.
  const currentAnchor = window.__pendingShopScrollTarget || (location.hash ? location.hash.slice(1) : "");
  document.querySelectorAll(".sidebar-nav-sublink").forEach((link) => {
    link.classList.toggle("active", link.dataset.shopAnchor === currentAnchor);
  });
}

// ============================================================================
// 모바일 전용 상단바 + 하단 탭바 + "더보기" 시트
// ----------------------------------------------------------------------------
// 폰 폭(720px 이하)에서는 사이드바를 숨기고(style.css), 대신 이 세 가지를 보여줌.
//   - 상단바: 로고 + (로그아웃 상태) 작은 로그인 버튼 / (로그인 상태) 포인트 + 프로필
//   - 하단 탭바: 홈 · 공지 · 투표 · 출석 · 더보기
//   - 더보기 시트: 내 정보 + 랭킹/일반 상점/칭호 상점/마이페이지/(관리자) + 로그아웃
// 마크업을 8개 HTML에 복붙하지 않으려고 이 파일이 처음 로드될 때 한 번만 body에 끼워 넣음.
// 라우터(spa-router.js)는 .main-content만 갈아끼우므로 이 요소들은 페이지를 옮겨도 그대로
// 남아있고, 탭의 <a href>는 사이드바 링크와 똑같이 라우터가 가로채서 SPA로 이동함.
// PC 폭에서는 CSS로 전부 숨겨져 있어서 기존 화면엔 아무 영향 없음.
// ============================================================================

const M_ICONS = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>`,
  notice: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M8 9h8"/><path d="M8 13h8"/><path d="M8 17h4"/></svg>`,
  predict: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>`,
  attendance: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>`,
  more: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>`,
  ranking: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 5H4v2a4 4 0 0 0 4 4"/><path d="M16 5h4v2a4 4 0 0 1-4 4"/><path d="M12 13v3"/><path d="M9 20h6"/><path d="M10 20v-2h4v2"/></svg>`,
  shop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>`,
  title: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9L12 3z"/></svg>`,
  mypage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>`,
  admin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l7 4v6c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-4z"/></svg>`,
};

// 하단 탭에 고정된 페이지들. 나머지 페이지(랭킹/상점/마이페이지/관리자)에 있을 땐 "더보기" 탭이 켜짐.
const M_TAB_PAGES = ["index.html", "notice.html", "predict.html", "attendance.html"];

function initMobileNav() {
  // 사이드바가 있는 "사이트 페이지"에서만 — overlay.html(방송 오버레이) 같은 곳엔 안 붙임.
  if (!document.querySelector(".sidebar")) return;
  if (document.getElementById("m-topbar")) return;

  const topbar = document.createElement("header");
  topbar.id = "m-topbar";
  topbar.className = "m-topbar";
  topbar.innerHTML = `
    <a href="index.html" class="m-brand">
      <img src="assets/img/brand-mark.png" alt="">
      <span>유진 팬보드</span>
    </a>
    <div class="m-topbar-user" id="m-topbar-user"></div>
  `;

  const tabbar = document.createElement("nav");
  tabbar.id = "m-tabbar";
  tabbar.className = "m-tabbar";
  tabbar.setAttribute("aria-label", "메뉴");
  tabbar.innerHTML = `
    <a href="index.html" class="m-tab" data-page="index.html"><span class="m-tab-icon">${M_ICONS.home}</span><span>홈</span></a>
    <a href="notice.html" class="m-tab" data-page="notice.html"><span class="m-tab-icon">${M_ICONS.notice}<span class="notice-nav-badge" hidden></span></span><span>공지</span></a>
    <a href="predict.html" class="m-tab" data-page="predict.html"><span class="m-tab-icon">${M_ICONS.predict}</span><span>투표</span></a>
    <a href="attendance.html" class="m-tab" data-page="attendance.html"><span class="m-tab-icon">${M_ICONS.attendance}</span><span>출석</span></a>
    <button type="button" class="m-tab" id="m-more-btn"><span class="m-tab-icon">${M_ICONS.more}</span><span>더보기</span></button>
  `;

  const backdrop = document.createElement("div");
  backdrop.id = "m-sheet-backdrop";
  backdrop.className = "m-sheet-backdrop";
  backdrop.hidden = true;

  const sheet = document.createElement("div");
  sheet.id = "m-sheet";
  sheet.className = "m-sheet";
  sheet.hidden = true;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "더보기");
  sheet.innerHTML = `
    <div class="m-sheet-grabber"></div>
    <div class="m-sheet-user" id="m-sheet-user"></div>
    <div class="m-sheet-grid">
      <a href="ranking.html" class="m-sheet-item" data-page="ranking.html">${M_ICONS.ranking}<span>랭킹</span></a>
      <a href="shop.html#general-shop-section" class="m-sheet-item" data-shop-anchor="general-shop-section">${M_ICONS.shop}<span>일반 상점</span></a>
      <a href="shop.html#title-shop-section" class="m-sheet-item" data-shop-anchor="title-shop-section">${M_ICONS.title}<span>칭호 상점</span></a>
      <a href="mypage.html" class="m-sheet-item" data-page="mypage.html">${M_ICONS.mypage}<span>마이페이지</span></a>
      <a href="admin.html" class="m-sheet-item" data-page="admin.html" id="m-sheet-admin" hidden>${M_ICONS.admin}<span>관리자</span></a>
    </div>
    <div class="m-sheet-footer" id="m-sheet-footer"></div>
  `;

  // 상단바는 sticky라 문서 맨 앞에 있어야 화면 위에 붙음(뒤에 두면 페이지 맨 아래에 깔림).
  // 나머지는 fixed라 위치 상관없음.
  document.body.prepend(topbar);
  document.body.append(tabbar, backdrop, sheet);

  document.getElementById("m-more-btn").addEventListener("click", () => {
    if (sheet.hidden) openMobileSheet();
    else closeMobileSheet();
  });
  backdrop.addEventListener("click", closeMobileSheet);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sheet.hidden) closeMobileSheet();
  });

  // 시트 안 메뉴를 누르면 시트는 닫고 이동은 라우터에 맡김. 상점 두 개는 같은 shop.html 안에서
  // 섹션만 바꾸는 특수 동작이 있어서(initShopNavGroup 참고) 숨겨진 사이드바의 같은 하위 링크를
  // 대신 눌러서 그 로직을 그대로 재사용함.
  sheet.querySelectorAll(".m-sheet-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      const anchor = item.dataset.shopAnchor;
      if (anchor) {
        e.preventDefault();
        const sidebarLink = document.querySelector(`.sidebar-nav-sublink[data-shop-anchor="${anchor}"]`);
        if (sidebarLink) sidebarLink.click();
        else location.href = item.getAttribute("href");
      }
      closeMobileSheet();
    });
  });

  // 뒤로가기로 페이지가 바뀌면 시트가 열린 채 남지 않게.
  window.addEventListener("popstate", closeMobileSheet);

  renderMobileUser();
  updateMobileNavActive(currentPageNameForMobileNav());
}

function openMobileSheet() {
  const sheet = document.getElementById("m-sheet");
  const backdrop = document.getElementById("m-sheet-backdrop");
  if (!sheet || !backdrop) return;
  renderMobileUser();
  sheet.hidden = false;
  backdrop.hidden = false;
  document.body.classList.add("m-sheet-open");
  document.getElementById("m-more-btn")?.classList.add("open");
}

function closeMobileSheet() {
  const sheet = document.getElementById("m-sheet");
  const backdrop = document.getElementById("m-sheet-backdrop");
  if (!sheet || !backdrop) return;
  sheet.hidden = true;
  backdrop.hidden = true;
  document.body.classList.remove("m-sheet-open");
  document.getElementById("m-more-btn")?.classList.remove("open");
}

function currentPageNameForMobileNav() {
  const file = location.pathname.split("/").pop() || "index.html";
  return file;
}

// 하단 탭/시트 메뉴의 현재 페이지 표시. spa-router.js가 페이지를 바꿀 때도 호출함.
function updateMobileNavActive(pageName) {
  const tabbar = document.getElementById("m-tabbar");
  if (!tabbar) return;
  const inTabs = M_TAB_PAGES.includes(pageName);
  tabbar.querySelectorAll("a.m-tab").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === pageName);
  });
  document.getElementById("m-more-btn")?.classList.toggle("active", !inTabs);
  document.querySelectorAll(".m-sheet-item").forEach((item) => {
    const isShop = !!item.dataset.shopAnchor;
    item.classList.toggle("active", isShop ? pageName === "shop.html" && location.hash.slice(1) === item.dataset.shopAnchor : item.dataset.page === pageName);
  });
  closeMobileSheet();
}

function formatPointsShort(n) {
  return `${Number(n).toLocaleString("ko-KR")}P`;
}

// 상단바 오른쪽 + 시트 맨 위/맨 아래의 로그인 상태 표시. 로그인/로그아웃, 잔액 갱신 때마다 호출.
function renderMobileUser() {
  const topEl = document.getElementById("m-topbar-user");
  const sheetUserEl = document.getElementById("m-sheet-user");
  const footerEl = document.getElementById("m-sheet-footer");
  const adminItem = document.getElementById("m-sheet-admin");
  if (!topEl || !sheetUserEl || !footerEl) return;

  if (adminItem) adminItem.hidden = !isAdmin();

  if (!isLoggedIn()) {
    topEl.innerHTML = `<button type="button" class="m-login-btn" id="m-login-btn">로그인</button>`;
    document.getElementById("m-login-btn").addEventListener("click", startLogin);
    sheetUserEl.innerHTML = `
      <div class="m-sheet-user-text">
        <div class="m-sheet-user-name">로그인하고 포인트를 모아보세요</div>
        <div class="m-sheet-user-sub">방송 중 출석체크·투표로 포인트가 쌓여요</div>
      </div>
      <button type="button" class="m-sheet-login-btn" id="m-sheet-login-btn">치지직으로 로그인</button>
    `;
    document.getElementById("m-sheet-login-btn").addEventListener("click", startLogin);
    footerEl.innerHTML = "";
    return;
  }

  const name = getChannelName() || "(이름 없음)";
  const initial = escapeHtmlForAuth(Array.from(name)[0] || "?");
  const cached = localStorage.getItem(BALANCE_CACHE_KEY);
  const pointsHtml = cached !== null ? `<span class="m-point-pill">${formatPointsShort(cached)}</span>` : "";

  topEl.innerHTML = `
    <a href="mypage.html" class="m-topbar-profile" aria-label="마이페이지">
      ${pointsHtml}
      <span class="m-avatar">${initial}</span>
    </a>
  `;
  sheetUserEl.innerHTML = `
    <span class="m-avatar m-avatar-lg">${initial}</span>
    <div class="m-sheet-user-text">
      <div class="m-sheet-user-name">${escapeHtmlForAuth(name)}님</div>
      <div class="m-sheet-user-sub">내 포인트</div>
    </div>
    <span class="m-sheet-user-points">${cached !== null ? formatPointsShort(cached) : "-"}</span>
  `;
  footerEl.innerHTML = `<button type="button" class="m-sheet-logout-btn" id="m-sheet-logout-btn">로그아웃</button>`;
  document.getElementById("m-sheet-logout-btn").addEventListener("click", () => {
    logout();
    location.href = "index.html";
  });
}

initMobileNav();

// 입력칸 자동완성 끄기 — 브라우저가 예전에 입력했던 값(상품명, 제목 등)을 드롭다운으로 추천하는
// 걸 사이트 전체에서 막음. 페이지마다 일일이 속성을 다는 대신 여기서 한 번에: 지금 있는 입력칸 +
// 나중에 생기는 입력칸(SPA 페이지 전환, 모달/목록을 JS로 그리는 경우)까지 MutationObserver로 잡음.
function disableAutocompleteIn(root) {
  if (!root || !root.querySelectorAll) return;
  const targets = root.matches && root.matches("input, textarea, form") ? [root] : [];
  targets.push(...root.querySelectorAll("input, textarea, form"));
  for (const el of targets) {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (["checkbox", "radio", "color", "hidden", "file", "range", "button", "submit"].includes(type)) continue;
    if (el.getAttribute("autocomplete") !== "off") el.setAttribute("autocomplete", "off");
  }
}

if (!window.__autocompleteOffObserver) {
  disableAutocompleteIn(document);
  window.__autocompleteOffObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) disableAutocompleteIn(node);
      }
    }
  });
  window.__autocompleteOffObserver.observe(document.documentElement, { childList: true, subtree: true });
}
