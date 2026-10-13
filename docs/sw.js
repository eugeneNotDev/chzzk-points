// 유진 팬보드 앱(홈 화면 설치)용 서비스 워커 — chzzk-auth.js의 setupAppMode가 등록함.
// 페이지·파일을 저장(캐시)하지 않음: fetch를 가로채지 않아서 사이트는 항상 평소처럼 최신으로 불러옴.
// 하는 일은 방송 알림(웹 푸시) 받기/누르기뿐 — 보내는 쪽은 Supabase push 함수.
const ICON_CACHE = "push-icons-v1";
const ICON_URL = "assets/img/app-icon-192.png";
const BADGE_URL = "assets/img/app-badge-96.png";

// 알림 아이콘을 미리 저장해 둠 — 폰이 잠겨 있을 때(절전) 알림이 오면 아이콘을 인터넷에서 못 받아와서
// 크롬이 대신 글자 아이콘(E)을 띄우는 일이 있어서, 저장해 둔 그림을 data: 주소로 바꿔 바로 넣음.
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(ICON_CACHE).then((c) => c.addAll([ICON_URL, BADGE_URL])).catch(() => {}));
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function iconDataUrl(url) {
  try {
    const cache = await caches.open(ICON_CACHE);
    let res = await cache.match(url);
    if (!res) {
      res = await fetch(url);
      if (!res.ok) return url;
      await cache.put(url, res.clone());
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return `data:${res.headers.get("content-type") || "image/png"};base64,${btoa(bin)}`;
  } catch (e) {
    return url;
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : "" }; }
  const title = data.title || "유진 팬보드";
  event.waitUntil((async () => {
    const [icon, badge] = await Promise.all([iconDataUrl(ICON_URL), iconDataUrl(BADGE_URL)]);
    await self.registration.showNotification(title, {
      body: data.body || "",
      icon,
      // 안드로이드 상단바(알림 접기 전)에 뜨는 작은 아이콘 — 색은 무시되고 모양(투명도)만 쓰여서 흰 단색 아이콘을 따로 둠
      badge,
      tag: data.tag || "live",
      renotify: true,
      data: { url: data.url || "./" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let url = (event.notification.data && event.notification.data.url) || "./";
  // 치지직 방송 주소는 바로 열면 앱이 아니라 웹으로 열려서, 치지직 앱을 열어주는 중간 페이지로 보냄(open-live.html).
  if (/^https:\/\/chzzk\.naver\.com\/live\//.test(url)) url = "open-live.html";
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url === url && "focus" in w) return w.focus();
    }
    return self.clients.openWindow(url);
  })());
});
