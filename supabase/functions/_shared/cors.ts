// 모든 Edge Function이 공통으로 쓰는 CORS 헤더.
// 프론트엔드(GitHub Pages) 도메인에서 오는 요청만 허용한다.
// 로컬에서 테스트할 때는 ALLOWED_ORIGIN을 환경변수로 덮어써서 쓸 수 있게 해둔다.

// TODO: Deno.env.get("ALLOWED_ORIGIN") ?? "https://eugeneNotDev.github.io" 로 대체
const ALLOWED_ORIGIN = "https://eugeneNotDev.github.io";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
