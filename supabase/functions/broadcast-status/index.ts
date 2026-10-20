// 지금 방송 중인지 여부.
//
// 치지직 공식 "Open API"에는 특정 채널 하나의 라이브 여부를 바로 물어보는 엔드포인트가 없음
// (라이브 목록 API만 있고, 그마저 별도의 client-credentials 인증이 필요함).
// 그래서 치지직 웹사이트 자체가 쓰는 비공식 공개 엔드포인트를 씀 — streamlink 같은
// 외부 오픈소스 프로젝트들도 이 방식을 쓰고 있음. 인증 불필요, 문서화는 안 돼있어서
// 치지직 쪽에서 예고 없이 바뀔 수 있다는 점은 감안해야 함.
// (실제 조회 로직은 _shared/live.ts에 — attendance-check도 같은 로직이 필요해서 공용으로 뺌.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getLiveInfo } from "../_shared/live.ts";

// 오늘(한국 날짜) 방송이 이미 켜졌다 꺼졌는지 — 홈 화면이 방송 끝난 밤에도 "오늘 19:00에 만나요"를
// 계속 띄우던 것 대신 "오늘 방송은 끝났어요"를 보여주려고. live-tracker가 남기는 broadcast_sessions의
// 마지막 방송 시작 날짜가 오늘이면 끝난 것으로 봄. 1분 캐시(호출 많아도 DB는 분당 1번).
let endedCache: { at: number; v: boolean } | null = null;
async function endedToday(): Promise<boolean> {
  if (endedCache && Date.now() - endedCache.at < 60_000) return endedCache.v;
  let v = false;
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (url && key) {
      const { data } = await createClient(url, key)
        .from("broadcast_sessions")
        .select("open_date")
        .order("last_seen_live_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
      v = typeof data?.open_date === "string" && data.open_date.slice(0, 10) === today;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
  }
  endedCache = { at: Date.now(), v };
  return v;
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const { isLive, liveTitle } = await getLiveInfo();
  const ended = isLive ? false : await endedToday();
  return new Response(JSON.stringify({ isLive, liveTitle, endedToday: ended }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
