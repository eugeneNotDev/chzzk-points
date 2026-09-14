// 포인트 상점 상품 관리 (관리자 전용). notices/index.ts와 같은 패턴 — 지금까지는 상품
// 추가/수정/삭제를 Supabase 테이블 편집기에서 직접 했는데(0010_shop_items.sql 참고),
// 매번 대시보드 들어가기 번거로워서 포인트 상점 페이지(shop.html)에 관리자만 보이는
// 인라인 수정 UI를 추가하며 이 함수를 새로 만들었다.
//
// GET                                    → 전체 상품 목록 (비활성화 포함, 가격 오름차순).
//                                           일반 유저는 shop_items 테이블을 anon 키로 직접 읽지만
//                                           (is_active=true만 RLS로 보임), 관리자는 비활성 상품도
//                                           관리해야 하니 이 함수로 전체를 내려준다.
// POST   { id, name, cost, description?, requiresLive?, cooldownSeconds?, sortOrder? }
//                                        → 새 상품 추가 (id는 소문자-하이픈 슬러그, 이후 수정 불가)
// PATCH  ?id=<item id>  { name?, cost?, description?, requiresLive?, cooldownSeconds?, sortOrder?, isActive? }
//                                        → 기존 상품 수정 (보낸 필드만 갱신)
// DELETE ?id=<item id>                   → 상품 삭제 (과거 구매 로그는 points_ledger.reason /
//                                           spend_events.item_name에 문구가 그대로 스냅샷 되어
//                                           있어서, 상품을 지워도 기존 로그 표시엔 영향 없음)
// (공통: Authorization: Bearer <세션토큰>, session.channelId가 OWNER_CHANNEL_ID와
//  일치해야만 허용 — 아니면 403)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

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

// 슬러그 형식: 소문자 영숫자 + 하이픈만 (points_ledger.reason에 그대로 안 들어가고
// spend_events.item_id로 쓰이는 값이라 URL/코드에서 다루기 까다로운 문자는 막는다).
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const session = await requireSession(req);
  if (!session) return jsonResponse({ error: "unauthorized" }, 401);
  if (session.channelId !== OWNER_CHANNEL_ID) return jsonResponse({ error: "forbidden" }, 403);

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  try {
    const admin = getAdminClient();

    if (req.method === "GET") {
      // 정렬은 가격 오름차순 — 예전엔 sort_order를 관리자가 직접 입력했는데, "가격 낮은 순
      // 정렬이면 굳이 따로 순서를 정할 필요 없다"는 피드백으로 가격 기준 자동 정렬로 바꿨다.
      // sort_order 컬럼 자체는 남겨뒀지만(0010_shop_items.sql) 이제 안 쓴다.
      const { data, error } = await admin
        .from("shop_items")
        .select("id, name, cost, description, requires_live, is_active, cooldown_seconds, created_at")
        .order("cost", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw new Error(`shop_items 조회 실패: ${error.message}`);
      return jsonResponse({ items: data ?? [] }, 200);
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const itemId = typeof body.id === "string" ? body.id.trim() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const cost = Number(body.cost);
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const requiresLive = body.requiresLive === true;
      const cooldownSeconds = Number.isFinite(Number(body.cooldownSeconds)) ? Math.max(0, Math.trunc(Number(body.cooldownSeconds))) : 0;
      const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : 0;

      if (!ID_PATTERN.test(itemId)) {
        return jsonResponse({ error: "invalid_id" }, 400);
      }
      if (name.length === 0) return jsonResponse({ error: "empty_name" }, 400);
      if (!Number.isFinite(cost) || cost <= 0) return jsonResponse({ error: "invalid_cost" }, 400);

      const { data, error } = await admin
        .from("shop_items")
        .insert({
          id: itemId,
          name,
          cost: Math.trunc(cost),
          description,
          requires_live: requiresLive,
          cooldown_seconds: cooldownSeconds,
          sort_order: sortOrder,
        })
        .select()
        .single();
      if (error) {
        if (error.code === "23505") return jsonResponse({ error: "duplicate_id" }, 409);
        throw new Error(`shop_items insert 실패: ${error.message}`);
      }
      return jsonResponse(data, 200);
    }

    if (req.method === "PATCH") {
      if (!id) return jsonResponse({ error: "missing_id" }, 400);
      const body = await req.json().catch(() => ({}));
      const update: Record<string, unknown> = {};

      if (body.name !== undefined) {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (name.length === 0) return jsonResponse({ error: "empty_name" }, 400);
        update.name = name;
      }
      if (body.cost !== undefined) {
        const cost = Number(body.cost);
        if (!Number.isFinite(cost) || cost <= 0) return jsonResponse({ error: "invalid_cost" }, 400);
        update.cost = Math.trunc(cost);
      }
      if (body.description !== undefined) {
        update.description = typeof body.description === "string" ? body.description.trim() : "";
      }
      if (body.requiresLive !== undefined) {
        update.requires_live = body.requiresLive === true;
      }
      if (body.cooldownSeconds !== undefined) {
        const cooldown = Number(body.cooldownSeconds);
        if (!Number.isFinite(cooldown) || cooldown < 0) return jsonResponse({ error: "invalid_cooldown" }, 400);
        update.cooldown_seconds = Math.trunc(cooldown);
      }
      if (body.sortOrder !== undefined) {
        const sortOrder = Number(body.sortOrder);
        if (!Number.isFinite(sortOrder)) return jsonResponse({ error: "invalid_sort_order" }, 400);
        update.sort_order = Math.trunc(sortOrder);
      }
      if (body.isActive !== undefined) {
        update.is_active = body.isActive === true;
      }

      if (Object.keys(update).length === 0) return jsonResponse({ error: "empty_update" }, 400);

      const { data, error } = await admin.from("shop_items").update(update).eq("id", id).select().single();
      if (error) throw new Error(`shop_items update 실패: ${error.message}`);
      return jsonResponse(data, 200);
    }

    // DELETE
    if (!id) return jsonResponse({ error: "missing_id" }, 400);
    const { error } = await admin.from("shop_items").delete().eq("id", id);
    if (error) throw new Error(`shop_items delete 실패: ${error.message}`);
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return jsonResponse({ error: "shop_item_failed" }, 500);
  }
});
