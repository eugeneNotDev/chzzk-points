// 유진 팬보드 앱(홈 화면 설치)용 서비스 워커 — chzzk-auth.js의 setupAppMode가 등록함.
// 페이지·파일을 저장(캐시)하지 않음: fetch를 가로채지 않아서 사이트는 항상 평소처럼 최신으로 불러옴.
// 하는 일은 방송 알림(웹 푸시) 받기/누르기뿐 — 보내는 쪽은 Supabase push 함수.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : "" }; }
  const title = data.title || "유진 팬보드";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "assets/img/app-icon-192.png",
    // 안드로이드 상단바(알림 접기 전)에 뜨는 작은 아이콘 — 색은 무시되고 모양(투명도)만 쓰여서 흰 단색 아이콘을 따로 둠
    badge: "assets/img/app-badge-96.png",
    tag: data.tag || "live",
    renotify: true,
    data: { url: data.url || "./" },
  }));
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
