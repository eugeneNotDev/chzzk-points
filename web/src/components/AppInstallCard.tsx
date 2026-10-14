// 마이페이지 "앱으로 설치" 카드 — 기기/브라우저에 맞는 설치 방법 + 방송 시작 알림 켜기.
import { useEffect, useState } from "react";
import { Bell, Download } from "lucide-react";
import { useAuth } from "../lib/auth";
import { disableLivePush, enableLivePush, isPushOn, isStandalone, pushSupported, sendTestPush, useInstallPrompt } from "../lib/pwa";
import { Card } from "./Card";
import styles from "./AppInstallCard.module.css";

const PUSH_ERRORS: Record<string, string> = {
  denied: "알림이 차단돼 있어요. 휴대폰 설정 → 알림에서 허용한 뒤 다시 켜 주세요.",
  dismissed: "알림 허용을 눌러야 켜져요.",
  not_open: "아직 준비 중인 기능이에요.",
  too_many_devices: "알림은 기기 10개까지 켤 수 있어요.",
};

export function AppInstallCard() {
  const { isLoggedIn, isAdmin } = useAuth();
  const prompt = useInstallPrompt();
  const ua = navigator.userAgent || "";
  const isIos = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const inApp = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|everytimeApp|DaumApps|; wv\)/i.test(ua);
  const standalone = isStandalone();

  let body;
  if (standalone) body = <p className={styles.ok}>앱으로 실행 중이에요.</p>;
  else if (inApp)
    body = (
      <p className="muted">
        지금은 다른 앱 안의 브라우저라 설치가 안 돼요. 오른쪽 위 메뉴에서 <b>다른 브라우저로 열기</b>(크롬·사파리)를 누른 뒤 다시 들어와 주세요.
      </p>
    );
  else if (prompt.available)
    body = (
      <>
        <p className="muted">홈 화면에 아이콘이 생기고, 주소창 없이 앱처럼 열려요.</p>
        <button type="button" className="btn btn-primary" onClick={prompt.install}>
          <Download size={18} aria-hidden="true" />앱 설치하기
        </button>
      </>
    );
  else if (isIos)
    body = (
      <ol className={styles.steps}>
        <li>
          사파리 아래쪽 <b>공유 버튼</b>(네모에 위 화살표)을 눌러요.
        </li>
        <li>
          <b>홈 화면에 추가</b>를 눌러요.
        </li>
        <li>
          홈 화면에 생긴 <b>유진 팬보드</b> 아이콘으로 열면 돼요.
        </li>
      </ol>
    );
  else
    body = (
      <p className="muted">
        브라우저 메뉴(⋮)에서 <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 눌러 주세요. 이미 설치했다면 홈 화면 아이콘으로 열면 돼요.
      </p>
    );

  return (
    <Card>
      <div className={styles.head}>
        <img src="/assets/img/app-icon-192.png" alt="" width={44} height={44} />
        <strong>앱으로 설치</strong>
      </div>
      <div className={styles.body}>{body}</div>
      {isLoggedIn && (
        <div className={styles.push}>
          {isIos && !standalone ? (
            <p className="muted">
              아이폰은 위 방법대로 <b>홈 화면에 추가한 앱</b>에서 알림을 켤 수 있어요.
            </p>
          ) : !pushSupported() ? (
            <p className="muted">이 브라우저는 알림을 지원하지 않아요. 크롬(안드로이드)이나 홈 화면에 추가한 앱(아이폰)에서 켜 주세요.</p>
          ) : (
            <PushToggle isAdmin={isAdmin} />
          )}
        </div>
      )}
    </Card>
  );
}

function PushToggle({ isAdmin }: { isAdmin: boolean }) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });

  useEffect(() => {
    isPushOn()
      .then(setOn)
      .catch(() => setOn(false))
      .finally(() => {
        setBusy(false);
        if (Notification.permission === "denied") setStatus({ text: "이 기기에서 알림이 차단돼 있어요. 휴대폰 설정 → 알림에서 허용해 주세요.", error: true });
      });
  }, []);

  async function toggle(next: boolean) {
    setBusy(true);
    setOn(next);
    try {
      if (next) {
        setStatus({ text: "알림을 켜는 중…" });
        await enableLivePush();
        setStatus({ text: "알림을 켰어요. 방송이 시작되면 알려드릴게요." });
      } else {
        await disableLivePush();
        setStatus({ text: "알림을 껐어요." });
      }
    } catch (err) {
      setOn(false);
      const code = err instanceof Error ? err.message : "";
      setStatus({ text: PUSH_ERRORS[code] || "알림을 켜지 못했어요. 잠시 후 다시 시도해 주세요.", error: true });
    }
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    try {
      const d = await sendTestPush();
      setStatus(d.total ? { text: `테스트 알림을 보냈어요 (기기 ${d.sent}/${d.total}).`, error: !d.sent } : { text: "알림 켠 기기가 없어요. 먼저 위 스위치를 켜 주세요.", error: true });
    } catch {
      setStatus({ text: "테스트 알림을 보내지 못했어요.", error: true });
    }
    setBusy(false);
  }

  return (
    <>
      <label className={styles.toggleRow}>
        <Bell size={18} aria-hidden="true" />
        <span className={styles.toggleText}>
          <strong>방송 시작하면 알림 받기</strong>
          <span className="muted">방송이 켜지면 이 기기로 알림이 와요.</span>
        </span>
        <span className="switch">
          <input type="checkbox" role="switch" checked={on} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
          <span className="slider" />
        </span>
      </label>
      <p className={`status ${status.error ? "error" : "ok"}`}>{status.text}</p>
      {isAdmin && (
        <button type="button" className="btn btn-sm" disabled={busy} onClick={test}>
          나에게 테스트 알림 보내기
        </button>
      )}
    </>
  );
}
