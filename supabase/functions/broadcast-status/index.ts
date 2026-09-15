// 지금 방송 중인지 여부.
//
// 치지직 공식 "Open API"에는 특정 채널 하나의 라이브 여부를 바로 물어보는 엔드포인트가 없음
// (라이브 목록 API만 있고, 그마저 별도의 client-credentials 인증이 필요함).
// 그래서 치지직 웹사이트 자체가 쓰는 비공식 공개 엔드포인트를 씀 — streamlink 같은
// 외부 오픈소스 프로젝트들도 이 방식을 쓰고 있음. 인증 불필요, 문서화는 안 돼있어서
// 치지직 쪽에서 예고 없이 바뀔 수 있다는 점은 감안해야 함.
// (실제 조회 로직은 _shared/live.ts에 — attendance-check도 같은 로직이 필요해서 공용으로 뺌.)

import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getLiveInfo } from "../_shared/live.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const { isLive, liveTitle } = await getLiveInfo();
  return new Response(JSON.stringify({ isLive, liveTitle }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
