// 로그인한 유저 본인의 프로필 + 포인트 잔액.
// mypage.html, shop.html이 이 함수를 쓴다 (Authorization: Bearer <세션토큰> 필수).
//
// GET  → { channelId, channelName, isPublic, balance }
// POST { isPublic: boolean } → is_public 갱신 후 위와 동일한 형태로 최신 상태 리턴
//
// verify_jwt는 config.toml에서 꺼져있다 (우리 세션 토큰을 Authorization에 쓰기 때문).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  }
  return createClient(url, serviceRoleKey);
}

async function getProfile(channelId: string) {
  const admin = getAdminClient();

  const { data: user, error: userError } = await admin
    .from("users")
    .select("channel_id, channel_name, is_public, banned")
    .eq("channel_id", channelId)
    .single();
  if (userError) throw new Error(`users 조회 실패: ${userError.message}`);

  const { data: ledgerRows, error: ledgerError } = await admin
    .from("points_ledger")
    .select("amount")
    .eq("channel_id", channelId);
  if (ledgerError) throw new Error(`points_ledger 조회 실패: ${ledgerError.message}`);

  const balance = (ledgerRows ?? []).reduce((sum, row) => sum + row.amount, 0);

  return {
    channelId: user.channel_id,
    channelName: user.channel_name,
    isPublic: user.is_public,
    banned: user.banned,
    balance,
  };
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const session = await requireSession(req);
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // 로그인은 이미 했는데(토큰을 갖고 있는데) 그 사이 밴 당한 경우 — 매 /me 호출마다 다시
    // 체크해서 강제로 걸러낸다. mypage.html/shop.html은 로그인 상태면 항상 /me를 먼저 부르고,
    // 다른 페이지들도 verifySessionInBackground()로 /me를 한 번씩 백그라운드 호출하기 때문에
    // (chzzk-auth.js 참고) 밴된 유저는 어느 페이지를 열든 곧 로그아웃 처리된다.
    // (로그인 자체를 막는 처리는 oauth-callback에 별도로 있음 — 거긴 아직 토큰이 없는 시점이라서.)
    const admin = getAdminClient();
    const { data: bannedCheck, error: bannedError } = await admin
      .from("users")
      .select("banned")
      .eq("channel_id", session.channelId)
      .maybeSingle();
    if (bannedError) throw new Error(`banned 조회 실패: ${bannedError.message}`);
    if (bannedCheck?.banned === true) {
      return new Response(JSON.stringify({ error: "banned" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body.isPublic === "boolean") {
        const admin = getAdminClient();
        const { error } = await admin
          .from("users")
          .update({ is_public: body.isPublic })
          .eq("channel_id", session.channelId);
        if (error) throw new Error(`is_public 갱신 실패: ${error.message}`);
      }
    }

    const profile = await getProfile(session.channelId);
    return new Response(JSON.stringify(profile), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "me_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
