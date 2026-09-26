// "지금 방송 중인지" 확인하는 공용 헬퍼. broadcast-status, attendance-check 둘 다 씀.
//
// 치지직 공식 Open API에는 특정 채널 하나의 라이브 여부를 바로 물어보는 엔드포인트가 없어서,
// 치지직 웹사이트 자체가 쓰는 비공식 공개 엔드포인트를 씀 (broadcast-status/index.ts 참고 —
// 원래 거기 있던 로직을 attendance-check도 그대로 써야 해서 여기로 뺌).

import { OWNER_CHANNEL_ID } from "./config.ts";

const LIVE_DETAIL_URL = `https://api.chzzk.naver.com/service/v2/channels/${OWNER_CHANNEL_ID}/live-detail`;

export interface LiveInfo {
  isLive: boolean;
  liveTitle: string | null;
  // 이번 방송이 시작된 시각. 치지직이 "2026-09-26 21:00:03"처럼 한국 시간 문자열로 줌.
  // 출석체크가 "방송 1번에 출석 1번"을 지키려고 이 날짜를 씀(attendance-check 참고). 방송 중이
  // 아니거나 값이 없으면 null.
  openDate: string | null;
}

// broadcast-status는 로그인 없이도 누구나 호출 가능하고, attendance-check도 페이지 로드마다
// GET으로 불러서, 이 함수를 호출할 때마다 매번 치지직 쪽으로 실제 요청을 보내면 누군가 짧은
// 시간에 반복 호출했을 때(별 뜻 없이 새로고침을 연타하든, 악의적으로 스팸을 하든) 치지직
// 비공식 엔드포인트에 부하가 몰릴 수 있음 — 명시적인 rate limit이 없는 대신, 실제 값이
// 몇 초 안에 바뀔 일은 없으니 짧게 캐싱해서 호출 폭주가 와도 실제 외부 요청은 캐시 주기당
// 최대 1번만 나가게 함. Edge Function 인스턴스는 warm start면 모듈 스코프 변수가 유지되고,
// cold start면 그냥 캐시가 비어서 새로 요청하는 것뿐이라 안전함(여러 인스턴스 간 공유는
// 안 되지만, 이 용도로는 그 정도로 충분함).
const LIVE_INFO_CACHE_TTL_MS = 15_000;
let cachedLiveInfo: LiveInfo | null = null;
let cachedAt = 0;

async function fetchLiveInfo(): Promise<LiveInfo> {
  try {
    const res = await fetch(LIVE_DETAIL_URL);
    if (!res.ok) {
      throw new Error(`live-detail 조회 실패 (status ${res.status})`);
    }
    const body = await res.json();
    const isLive = body?.content?.status === "OPEN";
    const liveTitle = isLive ? body?.content?.liveTitle ?? null : null;
    const rawOpenDate = body?.content?.openDate;
    const openDate = isLive && typeof rawOpenDate === "string" ? rawOpenDate : null;
    return { isLive, liveTitle, openDate };
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    // 조회 실패해도 호출부가 깨지면 안 되니, "모름" 대신 방송 꺼짐으로 안전하게 취급함
    // (출석체크 쪽에서는 이게 "방송 안 켜짐"으로 처리되어 출석체크가 막히는 정도의 영향만 있음).
    return { isLive: false, liveTitle: null, openDate: null };
  }
}

export async function getLiveInfo(): Promise<LiveInfo> {
  const now = Date.now();
  if (cachedLiveInfo && now - cachedAt < LIVE_INFO_CACHE_TTL_MS) {
    return cachedLiveInfo;
  }
  const info = await fetchLiveInfo();
  cachedLiveInfo = info;
  cachedAt = now;
  return info;
}

export async function isChannelLive(): Promise<boolean> {
  return (await getLiveInfo()).isLive;
}

// 지금 방송이 시작된 날짜(KST, "YYYY-MM-DD"). 21시에 켜서 새벽 1시에 끄면 자정이 넘어도 계속
// 시작한 날짜가 나옴 — 출석을 이 날짜로 기록해서 방송 하나에 출석 한 번이 되게 함.
// openDate를 못 읽으면 null(호출부가 오늘 날짜로 대신함).
export function broadcastDateKst(info: LiveInfo): string | null {
  if (!info.openDate) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(info.openDate);
  return match ? match[1] : null;
}
