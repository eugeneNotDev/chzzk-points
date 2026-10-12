// 유진 팬보드 앱(홈 화면 설치)용 서비스 워커 — chzzk-auth.js의 setupAppMode가 등록함.
// 페이지·파일을 저장(캐시)하지 않음: fetch를 가로채지 않아서 사이트는 항상 평소처럼 최신으로 불러옴.
// 방송 알림(푸시)은 다음 단계에서 여기에 추가.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
