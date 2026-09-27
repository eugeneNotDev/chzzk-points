// 치지직 공식 Open API 중 "Client 인증"(Client-Id/Client-Secret 헤더)으로 부르는 것들 공용 헬퍼.
// 지금은 채널 정보 조회(GET /open/v1/channels)로 프로필 이미지만 가져옴 — oauth-callback(로그인할 때)과
// me(프로필 조회 때, 오래됐으면 다시 확인)가 같이 씀. clientSecret은 서버 환경변수로만 존재하고 절대
// 응답/로그에 안 남김.

const CHZZK_CHANNELS_URL = "https://openapi.chzzk.naver.com/open/v1/channels";

// 채널의 프로필 이미지 주소. 기본 이미지라 주소가 없으면 null.
// 치지직 쪽 오류/네트워크 문제는 undefined로 돌려줌(= "이번엔 모름" — 호출부가 기존 값을 그대로 둠).
export async function fetchChzzkChannelImage(channelId: string): Promise<string | null | undefined> {
  const clientId = Deno.env.get("CHZZK_CLIENT_ID");
  const clientSecret = Deno.env.get("CHZZK_CLIENT_SECRET");
  if (!clientId || !clientSecret) return undefined;
  try {
    const url = `${CHZZK_CHANNELS_URL}?channelIds=${encodeURIComponent(channelId)}`;
    const res = await fetch(url, {
      headers: { "Client-Id": clientId, "Client-Secret": clientSecret, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      console.error(`치지직 채널 정보 조회 실패 (status ${res.status})`);
      return undefined;
    }
    const body = await res.json();
    const list = body?.content?.data;
    if (!Array.isArray(list)) return undefined;
    const channel = list.find((c: { channelId?: string }) => c?.channelId === channelId);
    const image = channel?.channelImageUrl;
    // 화면에 <img src>로 그대로 들어가는 값이라 https 주소만 받음.
    if (typeof image === "string" && /^https:\/\//.test(image)) return image;
    return null;
  } catch (err) {
    console.error(`치지직 채널 정보 조회 오류: ${err instanceof Error ? err.message : err}`);
    return undefined;
  }
}
