// 지금 방송 중인지 여부.
//
// 치지직 공식 "Open API"에는 특정 채널 하나의 라이브 여부를 바로 물어보는 엔드포인트가 없다
// (라이브 목록 API만 있고, 그마저 별도의 client-credentials 인증이 필요함).
// 그래서 치지직 웹사이트 자체가 쓰는 비공식 공개 엔드포인트를 쓴다 — streamlink 같은
// 외부 오픈소스 프로젝트들도 이 방식을 쓰고 있음. 인증 불필요, 문서화는 안 돼있어서
// 치지직 쪽에서 예고 없이 바뀔 수 있다는 점은 감안해야 함.
//
// GET https://api.chzzk.naver.com/service/v2/channels/{channelId}/live-detail
// 응답: { content: { status: "OPEN" | "CLOSE", liveTitle, ... } }

import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

const LIVE_DETAIL_URL = `https://api.chzzk.naver.com/service/v2/channels/${OWNER_CHANNEL_ID}/live-detail`;

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const res = await fetch(LIVE_DETAIL_URL);
    if (!res.ok) {
      throw new Error(`live-detail 조회 실패 (status ${res.status})`);
    }
    const body = await res.json();
    const isLive = body?.content?.status === "OPEN";
    const liveTitle = isLive ? body?.content?.liveTitle ?? null : null;

    return new Response(JSON.stringify({ isLive, liveTitle }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    // 조회 실패해도 페이지가 깨지면 안 되니, "모름" 대신 방송 꺼짐으로 안전하게 취급
    return new Response(JSON.stringify({ isLive: false, liveTitle: null, error: "status_check_failed" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
