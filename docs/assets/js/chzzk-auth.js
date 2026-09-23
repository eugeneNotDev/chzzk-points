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
    }).catch(() => {});
  }
  return res;
}

// 로그인 상태인 페이지에서 한 번 /me를 백그라운드로 조용히 호출해서, 그 사이 밴 당했는지를
// 확인함. mypage.html/shop.html은 화면을 그리려고 어차피 ME_URL을 직접 호출하니 따로 필요
// 없고, index.html/notice.html/ranking.html/admin.html처럼 /me를 안 쓰는 페이지에서 호출함.
// (밴 감지 자체는 authFetch가 처리 — 여기선 그냥 그 authFetch를 한 번 트리거만 해주는 역할.)
function verifySessionInBackground() {
  if (!isLoggedIn()) return;
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

function renderShopTitleBadgeHtml(shopName) {
  return shopName ? `<span class="title-badge">[${escapeHtmlForAuth(shopName)}]</span> ` : "";
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
