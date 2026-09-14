// "지금 방송 중인지" 확인하는 공용 헬퍼. broadcast-status, attendance-check 둘 다 쓴다.
//
// 치지직 공식 Open API에는 특정 채널 하나의 라이브 여부를 바로 물어보는 엔드포인트가 없어서,
// 치지직 웹사이트 자체가 쓰는 비공식 공개 엔드포인트를 쓴다 (broadcast-status/index.ts 참고 —
// 원래 거기 있던 로직을 attendance-check도 그대로 써야 해서 여기로 뺐다).

import { OWNER_CHANNEL_ID } from "./config.ts";

const LIVE_DETAIL_URL = `https://api.chzzk.naver.com/service/v2/channels/${OWNER_CHANNEL_ID}/live-detail`;

export interface LiveInfo {
  isLive: boolean;
  liveTitle: string | null;
}

export async function getLiveInfo(): Promise<LiveInfo> {
  try {
    const res = await fetch(LIVE_DETAIL_URL);
    if (!res.ok) {
      throw new Error(`live-detail 조회 실패 (status ${res.status})`);
    }
    const body = await res.json();
    const isLive = body?.content?.status === "OPEN";
    const liveTitle = isLive ? body?.content?.liveTitle ?? null : null;
    return { isLive, liveTitle };
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    // 조회 실패해도 호출부가 깨지면 안 되니, "모름" 대신 방송 꺼짐으로 안전하게 취급
    // (출석체크 쪽에서는 이게 "방송 안 켜짐"으로 처리되어 출석체크가 막히는 정도의 영향만 있음).
    return { isLive: false, liveTitle: null };
  }
}

export async function isChannelLive(): Promise<boolean> {
  return (await getLiveInfo()).isLive;
}
