// 가벼운 클라이언트 라우터.
//
// 이 사이트는 여전히 index.html / mypage.html / ranking.html / shop.html 네 개의 완전히
// 독립된 HTML 파일임 (주소창에 직접 쳐서 들어가거나 새로고침해도 항상 정상 동작함).
// 다만 사이드바 안 링크를 눌렀을 때 브라우저가 페이지를 통째로 다시 불러오면 사이드바까지
// 같이 깜빡이며 사라졌다 나타나서 어색함. 그래서 그런 "우리 사이트 안" 링크 클릭은
// 가로채서, <main class="main-content"> 안쪽만 fetch로 새로 받아와 교체하고, 사이드바는
// 손대지 않음.
//
// 전환 애니메이션은 브라우저가 지원하면(크롬/엣지 등) View Transitions API에 맡김 —
// 바뀐 부분만 브라우저가 알아서 자연스럽게 크로스페이드 해줌. 지원 안 하는 브라우저(사파리 등)는
// 직접 opacity를 트랜지션시키는 방식으로 대체함.
//
// 한 번 받아온 페이지는 메모리에 캐싱해서, 다시 그 페이지로 갈 때는 네트워크 왕복 없이
// 바로 전환됨 (링크에 마우스를 올리는 순간 미리 받아두기도 함 — 실제로 클릭했을 때 거의
// 지연 없이 넘어가는 느낌을 줌).
//
// 페이지별 <script>(모듈 아님, 평범한 스크립트)는 매번 새로 끼워 넣어서 다시 실행함.
// 그래서 각 페이지 스크립트는 최상위에 const/let을 두지 않고 즉시실행함수(IIFE)로 감싸져
// 있어야 함 — 안 그러면 같은 이름을 두 번째 실행할 때 "이미 선언된 식별자" 에러가 남.

const SPA_PAGES = ["index.html", "notice.html", "mypage.html", "attendance.html", "ranking.html", "shop.html", "admin.html"];
const spaPageCache = new Map();

function spaPageNameFromUrl(url) {
  const path = new URL(url, location.href).pathname;
  const file = path.split("/").pop() || "index.html";
  return SPA_PAGES.includes(file) ? file : null;
}

// 페이지 HTML을 가져옴. 한 번 받아온 페이지는 캐싱해서 재방문 시 네트워크 없이 바로 씀
// (사이트 자체가 4페이지짜리 개인 대시보드라 내용이 세션 도중 바뀔 일이 거의 없어서 안전함).
async function spaFetchPage(url) {
  if (spaPageCache.has(url)) return spaPageCache.get(url);
  const res = await fetch(url, { credentials: "same-origin", cache: "no-cache" });
  if (!res.ok) throw new Error(String(res.status));
  const html = await res.text();
  spaPageCache.set(url, html);
  return html;
}

// fetch로 받아온 문서에서 <body> 바로 아래 <script>들을 찾아 다시 실행함.
// src가 있는 외부 스크립트(chzzk-auth.js, spa-router.js 등)는 이미 로드돼 있으니 건너뜀.
function spaRunScripts(doc) {
  // 이전 페이지 스크립트가 등록해둔 정리 작업이 있으면 새 페이지 스크립트를 실행하기 전에
  // 먼저 실행함 — 주로 Supabase Realtime 구독 해제용. 페이지 스크립트는 매번 새로 끼워
  // 넣어서 실행되기 때문에(위 설명 참고) DOM이 바뀌는 것과 별개로 이전 페이지가 열어둔
  // 구독(예: 랭킹/공지 실시간 갱신 — ranking.html/notice.html/index.html 참고)은 저절로
  // 안 끊김. 그대로 두면 페이지를 옮겨다닐 때마다 구독이 계속 쌓임.
  if (typeof window.__pageCleanup === "function") {
    try {
      window.__pageCleanup();
    } catch (err) {
      console.error("[spa-router] 페이지 정리 중 오류", err);
    }
    window.__pageCleanup = null;
  }

  const scripts = Array.from(doc.querySelectorAll("body > script"));
  for (const oldScript of scripts) {
    if (oldScript.getAttribute("src")) continue;
    const newScript = document.createElement("script");
    newScript.textContent = oldScript.textContent;
    document.body.appendChild(newScript);
    document.body.removeChild(newScript);
  }
}

async function spaLoadPage(url, { pushState }) {
  const pageName = spaPageNameFromUrl(url);
  const mainEl = document.querySelector(".main-content");
  if (!pageName || !mainEl) {
    location.href = url;
    return;
  }

  let html;
  try {
    html = await spaFetchPage(url);
  } catch (err) {
    console.error("[spa-router] 페이지를 못 받아와서 일반 이동으로 전환합니다", err);
    location.href = url;
    return;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const newMain = doc.querySelector(".main-content");
  if (!newMain) {
    location.href = url;
    return;
  }

  const applyChanges = () => {
    document.title = doc.title;
    mainEl.innerHTML = newMain.innerHTML;
    document.querySelectorAll(".sidebar-nav a").forEach((a) => {
      a.classList.toggle("active", a.getAttribute("href") === pageName);
    });
    spaRunScripts(doc);
    window.scrollTo({ top: 0 });
  };

  if (document.startViewTransition) {
    await document.startViewTransition(applyChanges).finished.catch(() => {});
  } else {
    mainEl.classList.add("page-fade-out");
    await new Promise((resolve) => setTimeout(resolve, 120));
    applyChanges();
    mainEl.classList.remove("page-fade-out");
  }

  if (pushState) {
    history.pushState({ spaPage: pageName }, "", url);
  }
}

// 버튼의 onclick 등에서 써야 할 때(예: "홈으로 가서 로그인" 버튼)를 위한 진입점.
function spaNavigate(url) {
  spaLoadPage(url, { pushState: true });
}

function spaShouldIntercept(anchor) {
  if (!anchor) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin) return false;
  return spaPageNameFromUrl(url.href) !== null;
}

document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const anchor = e.target.closest("a[href]");
  if (!spaShouldIntercept(anchor)) return;
  e.preventDefault();
  if (spaPageNameFromUrl(anchor.href) === spaPageNameFromUrl(location.href)) return; // 이미 있는 페이지면 무시
  spaLoadPage(anchor.href, { pushState: true });
});

// 마우스를 올리는 순간 미리 받아둠 — 실제로 클릭했을 때는 캐시에서 바로 꺼내 쓰므로
// 네트워크 왕복 없이 즉시 전환되는 느낌을 줌.
document.addEventListener(
  "mouseover",
  (e) => {
    const anchor = e.target.closest("a[href]");
    if (spaShouldIntercept(anchor)) spaFetchPage(anchor.href).catch(() => {});
  },
  { passive: true }
);

window.addEventListener("popstate", () => {
  spaLoadPage(location.href, { pushState: false });
});
