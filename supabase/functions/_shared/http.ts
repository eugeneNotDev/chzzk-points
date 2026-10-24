// 응답 공용 — JSON 응답에 CORS 헤더를 같이 붙임.
import { corsHeaders } from "./cors.ts";

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
