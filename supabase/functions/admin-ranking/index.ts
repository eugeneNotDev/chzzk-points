// 관리자용 랭킹 — 비공개 유저도 실제 이름/칭호를 그대로 보여줌(0043_admin_ranking.sql).
// ranking.html/index.html이 관리자로 로그인했을 때만 부르고, 실패하면 공개 랭킹(public.ranking 뷰)으로 돌아감.
// 관리자 전용 기능은 원래 admin 함수에 모으지만, 그 파일이 워낙 커서 읽기 전용인 이 기능만 따로 뺌.
//
// GET ?limit=50 → { rows: [{ channel_id, channel_name, total_points, is_public,
//                           tier_title_name, tier_title_color, shop_title_name, shop_title_color,
//                           special_titles: [{ name, color }] | null }] }
//   (public.ranking 뷰와 같은 모양·같은 순서 — 화면이 같은 코드로 그릴 수 있게)
// Authorization: Bearer <세션토큰> 필수, 관리자(OWNER_CHANNEL_ID)가 아니면 403.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405);

  const session = await requireSession(req);
  if (!session) return jsonResponse({ error: "unauthorized" }, 401);
  if (session.channelId !== OWNER_CHANNEL_ID) return jsonResponse({ error: "forbidden" }, 403);

  const rawLimit = Number(new URL(req.url).searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
    const admin = createClient(url, serviceRoleKey);

    const { data, error } = await admin.rpc("admin_ranking", { p_limit: limit });
    if (error) throw new Error(`admin_ranking 실패: ${error.message}`);
    // 특수 칭호(지난달 1위 + 관리자 지급, 0054_special_titles.sql)는 비공개 유저도 그대로 보여줌.
    const { data: sp, error: spErr } = await admin.rpc("ranking_special_titles");
    if (spErr) throw new Error(`ranking_special_titles 실패: ${spErr.message}`);
    const specialByChannel = new Map<string, unknown>((sp ?? []).map((r: { channel_id: string; titles: unknown }) => [r.channel_id, r.titles]));
    const rows = (data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      total_points: Number(r.total_points),
      special_titles: specialByChannel.get(r.channel_id as string) ?? null,
    }));
    return jsonResponse({ rows }, 200);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return jsonResponse({ error: "ranking_failed" }, 500);
  }
});
