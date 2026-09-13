// 가벼운 클라이언트 라우터.
//
// 이 사이트는 여전히 index.html / mypage.html / ranking.html / shop.html 네 개의 완전히
// 독립된 HTML 파일이다 (주소창에 직접 쳐서 들어가거나 새로고침해도 항상 정상 동작함).
// 다만 사이드바 안 링크를 눌렀을 때 브라우저가 페이지를 통째로 다시 불러오면 사이드바까지
// 같이 깜빡이며 사라졌다 나타나서 어색하다. 그래서 그런 "우리 사이트 안" 링크 클릭은
// 가로채서, <main class="main-content"> 안쪽만 fetch로 새로 받아와 교체하고, 사이드바는
// 손대지 않는다. 리액트 같은 프레임워크 없이도 이 정도는 순수 JS로 충분함.
//
// 페이지별 <script>(모듈 아님, 평범한 스크립트)는 매번 새로 끼워 넣어서 다시 실행한다.
// 그래서 각 페이지 스크립트는 최상위에 const/let을 두지 않고 즉시실행함수(IIFE)로 감싸져
// 있어야 한다 — 안 그러면 같은 이름을 두 번째 실행할 때 "이미 선언된 식별자" 에러가 난다.

const SPA_PAGES = ["index.html", "mypage.html", "ranking.html", "shop.html"];

function spaPageNameFromUrl(url) {
  const path = new URL(url, location.href).pathname;
  const file = path.split("/").pop() || "index.html";
  return SPA_PAGES.includes(file) ? file : null;
}

// fetch로 받아온 문서에서 <body> 바로 아래 <script>들을 찾아 다시 실행한다.
// src가 있는 외부 스크립트(chzzk-auth.js, spa-router.js 등)는 이미 로드돼 있으니 건너뜀.
function spaRunScripts(doc) {
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

  mainEl.classList.add("page-fade-out");
  await new Promise((resolve) => setTimeout(resolve, 120));

  let html;
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(String(res.status));
    html = await res.text();
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

  document.title = doc.title;
  mainEl.innerHTML = newMain.innerHTML;

  document.querySelectorAll(".sidebar-nav a").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === pageName);
  });

  spaRunScripts(doc);

  if (pushState) {
    history.pushState({ spaPage: pageName }, "", url);
  }

  window.scrollTo({ top: 0 });
  mainEl.classList.remove("page-fade-out");
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

window.addEventListener("popstate", () => {
  spaLoadPage(location.href, { pushState: false });
});
