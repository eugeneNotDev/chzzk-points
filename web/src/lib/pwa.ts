// 앱(홈 화면 설치, PWA) + 방송 알림(웹 푸시). 기존 사이트 chzzk-auth.js의 같은 기능을 옮김.
// 서비스 워커는 기존 사이트의 /sw.js를 그대로 씀(경로·범위가 같아야 이미 알림을 켠 기기가 그대로 이어짐).
// sw.js는 페이지를 캐시하지 않음 — 하는 일은 알림 받기/누르기뿐.
import { useSyncExternalStore } from "react";
import { API } from "./config";
import { apiFetch } from "./auth";

const VAPID_PUBLIC_KEY = "BES4148X2XksCDdVlj_nvE-ssFjVhcP566hsxfBOblJxdpRdeaVDOmwPvJlEpTvojLjWH8fw5Q6fBQFu6bmPR_I";

type InstallPromptEvent = Event & { prompt: () => void; userChoice: Promise<unknown> };
let installPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function setupAppMode() {
  const head = document.head;
  const add = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    head.appendChild(el);
  };
  if (!head.querySelector('link[rel="manifest"]')) {
    add("link", { rel: "manifest", href: "/manifest.webmanifest" });
    add("link", { rel: "apple-touch-icon", href: "/assets/img/app-icon-180.png" });
    add("meta", { name: "apple-mobile-web-app-title", content: "유진 팬보드" });
    add("meta", { name: "apple-mobile-web-app-status-bar-style", content: "black" });
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => console.warn("[app] 서비스 워커 등록 실패", err));
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    emit();
  });
}

export function useInstallPrompt() {
  const p = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => installPrompt,
  );
  return {
    available: !!p,
    async install() {
      if (!installPrompt) return;
      installPrompt.prompt();
      try {
        await installPrompt.userChoice;
      } catch {
        /* 무시 */
      }
      installPrompt = null;
      emit();
    },
  };
}

// ── 방송 알림 ──
export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
function vapidKeyBytes() {
  const s = VAPID_PUBLIC_KEY.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export async function getPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? await reg.pushManager.getSubscription() : null;
}
export async function isPushOn() {
  const sub = await getPushSubscription();
  if (!sub || Notification.permission !== "granted") return false;
  const res = await apiFetch<{ subscribed: boolean }>(API.push, { body: { action: "status", endpoint: sub.endpoint } });
  return res.subscribed === true;
}
// 알림 켜기 — 브라우저 허용 창 → 구독 → 서버에 저장. 실패하면 이유를 Error.message로 던짐.
export async function enableLivePush() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "denied" : "dismissed");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes() });
  try {
    await apiFetch(API.push, { body: { action: "subscribe", subscription: sub.toJSON() } });
  } catch (e) {
    const code = (e as { body?: { error?: string } }).body?.error;
    throw new Error(code || "failed");
  }
}
export async function disableLivePush() {
  const sub = await getPushSubscription();
  if (!sub) return;
  await apiFetch(API.push, { body: { action: "unsubscribe", endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
export function sendTestPush() {
  return apiFetch<{ sent: number; total: number }>(API.push, { body: { action: "test" } });
}
