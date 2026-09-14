// 포인트 사용 엔드포인트. 프론트엔드(shop.html)의 "사용" 버튼이 이 함수를 호출한다
// (Authorization: Bearer <세션토큰>).
//
// POST { itemId: string }
//   성공: { balance, item: { id, name, cost } }
//   실패: 401 { error: "unauthorized" } (미로그인)
//         403 { error: "banned" } (밴된 계정)
//         400 { error: "invalid_request" | "item_not_found" | "not_live" | "insufficient_balance"
//               | "cooldown" }  (cooldown이면 retryAfterSeconds도 같이 내려줌)
//
// 상품 목록(shop_items)은 코드가 아니라 DB 테이블이라, 상품 추가/가격 변경/방송중 전용 토글/
// 쿨타임은 전부 Supabase 테이블 편집기에서 바로 할 수 있다 (배포 불필요) — 0010_shop_items.sql,
// 0013_shop_cooldown.sql 참고.
//
// 동시성 참고:
//   - 다른 유저끼리는 서로 영향이 없다. 잔액도 쿨타임도 전부 channel_id로 스코프된 조회/기록이라
//     각자 자기 행만 보고 쓴다 — Postgres가 서로 다른 행에 대한 동시 트랜잭션을 알아서 처리해주므로
//     "다른 사람이 동시에 써서 꼬이는" 문제는 애초에 없음.
//   - 같은 유저가 아주 짧은 간격(수십~수백ms)으로 연타하면, 쿨타임/잔액 체크가 두 요청 모두
//     통과해버릴 이론적 여지는 여전히 있음(체크와 기록 사이에 완전한 원자성은 없음). 다만 이제
//     쿨타임이 생겨서 두 번째 요청부터는 대부분 걸러지고, 그 틈을 완전히 막으려면 postgres
//     함수(RPC)로 "조회+기록"을 한 트랜잭션에 묶어야 함 — 지금 규모에선 과설계라 보류.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { isChannelLive } from "../_shared/live.ts";

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  }
  return createClient(url, serviceRoleKey);
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isBanned(admin: ReturnType<typeof getAdminClient>, channelId: string): Promise<boolean> {
  const { data, error } = await admin.from("users").select("banned").eq("channel_id", channelId).maybeSingle();
  if (error) throw new Error(`banned 조회 실패: ${error.message}`);
  return data?.banned === true;
}

async function getBalance(admin: ReturnType<typeof getAdminClient>, channelId: string): Promise<number> {
  const { data, error } = await admin.from("points_ledger").select("amount").eq("channel_id", channelId);
  if (error) throw new Error(`points_ledger 조회 실패: ${error.message}`);
  return (data ?? []).reduce((sum: number, row: { amount: number }) => sum + row.amount, 0);
}

// 이 유저가 이 상품을 마지막으로 쓴 뒤 몇 초가 지났는지. 한 번도 안 썼으면 null(쿨타임 없음과 동일하게 취급).
async function secondsSinceLastUse(
  admin: ReturnType<typeof getAdminClient>,
  channelId: string,
  itemId: string,
): Promise<number | null> {
  const { data, error } = await admin
    .from("spend_events")
    .select("created_at")
    .eq("channel_id", channelId)
    .eq("item_id", itemId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`spend_events 조회 실패: ${error.message}`);
  if (!data) return null;
  return (Date.now() - new Date(data.created_at).getTime()) / 1000;
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const session = await requireSession(req);
  if (!session) return jsonResponse({ error: "unauthorized" }, 401);

  try {
    const admin = getAdminClient();
    if (await isBanned(admin, session.channelId)) return jsonResponse({ error: "banned" }, 403);

    const body = await req.json().catch(() => ({}));
    const itemId = typeof body.itemId === "string" ? body.itemId : null;
    if (!itemId) return jsonResponse({ error: "invalid_request" }, 400);

    const { data: item, error: itemError } = await admin
      .from("shop_items")
      .select("id, name, cost, requires_live, is_active, cooldown_seconds")
      .eq("id", itemId)
      .maybeSingle();
    if (itemError) throw new Error(`shop_items 조회 실패: ${itemError.message}`);
    if (!item || !item.is_active) return jsonResponse({ error: "item_not_found" }, 400);

    if (item.requires_live && !(await isChannelLive())) {
      return jsonResponse({ error: "not_live" }, 400);
    }

    if (item.cooldown_seconds > 0) {
      const elapsed = await secondsSinceLastUse(admin, session.channelId, item.id);
      if (elapsed !== null && elapsed < item.cooldown_seconds) {
        const retryAfterSeconds = Math.ceil(item.cooldown_seconds - elapsed);
        return jsonResponse({ error: "cooldown", retryAfterSeconds }, 400);
      }
    }

    const balance = await getBalance(admin, session.channelId);
    if (balance < item.cost) return jsonResponse({ error: "insufficient_balance" }, 400);

    // reason은 관리자 포인트 로그/마이페이지 로그에 그대로 노출되니 상품 코드가 아니라
    // 사람이 읽을 문구로 남긴다 (예전엔 "spend:water"처럼 코드로 남겨서 뭘 산건지 알아보기
    // 힘들었음 — 0015_backfill_spend_reason_names.sql 참고).
    const { error: ledgerError } = await admin.from("points_ledger").insert({
      channel_id: session.channelId,
      amount: -item.cost,
      reason: `포인트 상점 사용: ${item.name}`,
    });
    if (ledgerError) throw new Error(`points_ledger insert 실패: ${ledgerError.message}`);

    // 오버레이 표시용 이름 스냅샷 — 세션 토큰의 channelName을 그대로 쓴다(추가 조회 불필요).
    const { error: eventError } = await admin.from("spend_events").insert({
      channel_id: session.channelId,
      channel_name: session.channelName,
      item_id: item.id,
    });
    if (eventError) throw new Error(`spend_events insert 실패: ${eventError.message}`);

    const newBalance = await getBalance(admin, session.channelId);
    return jsonResponse(
      {
        balance: newBalance,
        item: { id: item.id, name: item.name, cost: item.cost, cooldownSeconds: item.cooldown_seconds },
      },
      200,
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return jsonResponse({ error: "spend_failed" }, 500);
  }
});
