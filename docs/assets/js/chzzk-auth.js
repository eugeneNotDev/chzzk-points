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
//   "shine-crown-ffd43b"           메탈 + 반짝 + 왕관
//   "glow-rainbow"                 빛나는 테두리(무지개)
//   "crown-star-00e5a0"            단색 + 왕관 + 반짝이 별
//   "basic-ff6bb5-5dc8ff"          두 가지 색 그라데이션(핑크 → 하늘)
//   "glass-1b1e24-t-f2c230"        유리 + 배경색(검정) + 글자색(금)
// 즉 "[디자인-][crown-][star-]색" — 색은 # 없는 6자리 hex, rainbow, "hex-hex"(그라데이션),
// "hex-t-hex"(배경+글자). 서버 규칙상 전체가 영문 소문자로 시작하는 32자 이하라서, 두 가지 색인데
// 붙는 게 하나도 없으면 앞에 "basic-"을 붙임. 가장 긴 조합("shine-crown-star-" + 15자)이 딱
// 32자라 디자인 id는 5글자 이하로 지을 것. 모르는 값은 기본 민트 단색.
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
// 두 가지 색 섞는 방식 — grad: 왼쪽→오른쪽 그라데이션 / ink: 첫 번째 색은 배경, 두 번째 색은 글자
const TITLE_MIX_MODES = [
  { id: "grad", name: "그라데이션" },
  { id: "ink", name: "배경색 + 글자색" },
];

// 저장된 값 → { color: "#rrggbb" | "rainbow", color2: "#rrggbb" | null, mix, design, crown, star }
function parseTitleStyle(value) {
  const fallback = { color: DEFAULT_TITLE_COLOR, color2: null, mix: "grad", design: "basic", crown: false, star: false };
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
  let crown = false;
  let star = false;
  for (const p of parts) {
    if (p === "crown") crown = true;
    else if (p === "star") star = true;
    else if (TITLE_DESIGN_IDS.has(p)) design = p;
  }
  return { color, color2, mix, design, crown, star };
}

// { color, color2, mix, design, crown, star } → 저장할 값
function composeTitleStyle({ color, color2, mix, design, crown, star }) {
  const isHex = (c) => /^#[0-9a-fA-F]{6}$/.test(c || "");
  const c = color === "rainbow" ? "rainbow" : (isHex(color) ? color.toLowerCase() : DEFAULT_TITLE_COLOR);
  // 무지개는 그 자체로 여러 색이라 두 번째 색이랑은 같이 안 씀
  const c2 = c !== "rainbow" && isHex(color2) ? color2.toLowerCase() : null;
  const d = TITLE_DESIGN_IDS.has(design) ? design : "basic";
  if (d === "basic" && !crown && !star && !c2) return c;
  let colorPart = c === "rainbow" ? "rainbow" : c.slice(1);
  if (c2) colorPart += `${mix === "ink" ? "-t-" : "-"}${c2.slice(1)}`;
  const tokens = [d !== "basic" ? d : null, crown ? "crown" : null, star ? "star" : null].filter(Boolean);
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

const TITLE_CROWN_SVG = `<svg class="tb-crown" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/><circle cx="3" cy="7" r="1.6" fill="currentColor"/><circle cx="12" cy="4" r="1.6" fill="currentColor"/><circle cx="21" cy="7" r="1.6" fill="currentColor"/></svg>`;
const TITLE_STAR_PATH = `<path fill="currentColor" d="M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6z"/>`;
const TITLE_STARS_HTML = `<span class="tb-stars" aria-hidden="true">${[1, 2, 3].map((i) => `<svg class="tb-star tb-star--${i}" viewBox="0 0 24 24">${TITLE_STAR_PATH}</svg>`).join("")}</span>`;

function titleBadgeHtml(name, value) {
  const style = parseTitleStyle(value);
  const { color, color2, mix, design, crown, star } = style;
  const classes = ["title-badge"];
  if (design !== "basic") classes.push(`title-badge--${design}`);
  if (color === "rainbow") classes.push("title-badge--rainbow");
  if (color2) classes.push(mix === "ink" ? "title-badge--ink" : "title-badge--duo");
  if (crown) classes.push("title-badge--crowned");
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
  return `<span class="${classes.join(" ")}"${styleAttr}>${sweep}${crown ? TITLE_CROWN_SVG : ""}<span class="tb-text">${escapeHtmlForAuth(name)}</span>${star ? TITLE_STARS_HTML : ""}</span>`;
}

// 랭킹/홈에서 이름 앞에 붙이는 장착 칭호(뒤에 한 칸 띄움).
function renderShopTitleBadgeHtml(shopName, color) {
  return shopName ? `${titleBadgeHtml(shopName, color)} ` : "";
}

// 칭호 꾸미기 UI — 상점 칭호 상품 추가/수정 모달, 관리자 칭호 지급 폼에서 같이 씀.
//  - 색: 예시 동그라미 중에 고르거나, "+" 동그라미(색상표)나 HEX 칸으로 직접 지정
//  - 두 가지 색: 켜면 색 줄이 하나 더 생기고 섞는 방식(그라데이션 / 배경+글자)을 고름
//  - 디자인: 기본 / 메탈 반짝 / 빛나는 테두리 / 유리 (각 버튼에 지금 색으로 미리보기)
//  - 왕관 / 반짝이 별: 체크하면 붙음
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
        <label class="title-option-toggle"><input type="checkbox" class="title-crown-input"> 왕관</label>
        <label class="title-option-toggle"><input type="checkbox" class="title-star-input"> 반짝이 별</label>
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
  const crownInput = hostEl.querySelector(".title-crown-input");
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
        titleBadgeHtml("가나", composeTitleStyle({ ...state, design: b.dataset.design, crown: false, star: false }));
    });
    crownInput.checked = state.crown;
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
  crownInput.addEventListener("change", () => { state = { ...state, crown: crownInput.checked }; render(); });
  starInput.addEventListener("change", () => { state = { ...state, star: starInput.checked }; render(); });
  render();

  return {
    getColor: () => composeTitleStyle(state),
    setColor: (value) => {
      state = parseTitleStyle(value);
      lastHex = state.color === "rainbow" ? DEFAULT_TITLE_COLOR : state.color;
      lastHex2 = state.color2 || "#5dc8ff";
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
