// 치지직 OAuth: 프론트엔드에서 받은 code를 clientSecret과 함께
// https://chzzk.naver.com 쪽 토큰 엔드포인트로 교환하고,
// GET /open/v1/users/me 로 channelId를 받아 세션을 발급한다.
//
// clientSecret은 이 함수의 환경변수로만 존재해야 한다 (Supabase 프로젝트 설정에서 등록).
// 절대 응답 바디나 로그에 clientSecret을 남기지 말 것.
//
// TODO: code, state 파라미터 검증
// TODO: 토큰 교환 요청 (clientId, clientSecret, code, redirectUri)
// TODO: GET /open/v1/users/me 호출해서 channelId 확보
// TODO: users 테이블에 upsert
// TODO: 세션 쿠키 발급 (httpOnly, secure)

Deno.serve(async (req: Request) => {
  return new Response("TODO: oauth-callback", { status: 501 });
});
