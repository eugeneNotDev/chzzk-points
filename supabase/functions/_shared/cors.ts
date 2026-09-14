// 모든 Edge Function이 공통으로 쓰는 CORS 헤더.
// 프론트엔드(GitHub Pages) 도메인에서 오는 요청만 허용한다.
// 로컬에서 테스트할 때는 ALLOWED_ORIGIN을 환경변수로 덮어써서 쓸 수 있게 해둔다.

// 브라우저는 Origin 헤더의 호스트를 항상 소문자로 보낸다 (URL 스펙상 host 정규화).
// 여기 값이 대소문자 하나라도 다르면 브라우저가 CORS 검증에서 실제 요청을 막아버린다
// (OPTIONS preflight는 200이 떠도, 그 다음 본 요청이 아예 안 나가는 식으로 조용히 실패함).
// TODO: Deno.env.get("ALLOWED_ORIGIN") ?? "https://eugenenotdev.github.io" 로 대체
const ALLOWED_ORIGIN = "https://eugenenotdev.github.io";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

// preflight(OPTIONS) 요청이면 바로 응답을 리턴하고, 아니면 null을 리턴한다.
// 각 함수의 Deno.serve 맨 앞에서 이렇게 쓴다:
//   const preflight = handleCors(req);
//   if (preflight) return preflight;
export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
