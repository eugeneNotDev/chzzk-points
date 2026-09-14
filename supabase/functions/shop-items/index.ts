// 포인트 상점 상품 관리 (관리자 전용). notices/index.ts와 같은 패턴 — 지금까지는 상품
// 추가/수정/삭제를 Supabase 테이블 편집기에서 직접 했는데(0010_shop_items.sql 참고),
// 매번 대시보드 들어가기 번거로워서 포인트 상점 페이지(shop.html)에 관리자만 보이는
// 인라인 수정 UI를 추가하며 이 함수를 새로 만들었다.
//
// 상품은 두 종류다:
//  - 일반 상품: 소모성. 쿨타임/방송중 전용 여부가 있음.
//  - 칭호 상품(isTitleItem): 구매하면 titleName으로 지정한 문자열이 칭호로 영구 지급된다
//    (0020_purchasable_titles.sql). 기존에 있던 성취형 칭호(titles 테이블, 0016_titles.sql)
//    중에서 "고르는" 게 아니라, 상품을 만들 때마다 전용 칭호를 titles 테이블에 새로 만든다 —
//    titles.id를 상품 id와 그대로 맞춰서(1:1) 별도 매핑 없이 바로 찾을 수 있게 한다.
//    titles.min_points는 절대 못 찍을 만큼 큰 값(PURCHASE_ONLY_MIN_POINTS)을 넣어서 포인트
//    달성으로는 잠금해제가 안 되고 오직 구매(user_purchased_titles)로만 풀리게 만든다.
//
// GET                                    → 전체 상품 목록 (비활성화 포함, 가격 오름차순).
//                                           칭호 상품이면 연결된 titles.name도 함께 embed해서
//                                           내려준다(수정 모달에서 현재 칭호명을 바로 채워주려고 —
//                                           grants_title_id → titles(id) FK 관계로 자동 조인됨).
//                                           일반 유저는 shop_items 테이블을 anon 키로 직접 읽지만
//                                           (is_active=true만 RLS로 보임), 관리자는 비활성 상품도
//                                           관리해야 하니 이 함수로 전체를 내려준다.
// POST   { id, name, cost, description?, requiresLive?, cooldownSeconds?, showOnOverlay?,
//          isTitleItem?, titleName? }
//                                        → 새 상품 추가 (id는 소문자-하이픈 슬러그, 이후 수정 불가)
//   isTitleItem: true면 titleName(필수, 지급할 칭호 문구)으로 titles 테이블에 전용 칭호를
//   새로 만들고 이 상품에 연결한다(칭호 id = 상품 id). false/생략이면 그냥 소모성 상품이고
//   requiresLive/cooldownSeconds가 그대로 적용된다(칭호 상품은 둘 다 항상 false/0으로 저장됨 —
//   한 번 사면 끝인 상품이라 쿨타임/방송중 제한 개념 자체가 안 맞음).
//   showOnOverlay: false면 이 상품을 사용해도 overlay.html에 안 뜬다(기본 true).
// PATCH  ?id=<item id>  { name?, cost?, description?, requiresLive?, cooldownSeconds?,
//          isActive?, showOnOverlay?, titleName? }
//                                        → 기존 상품 수정 (보낸 필드만 갱신)
//   titleName: 이 상품이 칭호 상품(연결된 titles row가 있음)일 때만 유효 — 연결된 titles.name을
//   갱신한다. 칭호 상품이 아닌데 titleName을 보내면 not_title_item으로 거부.
// DELETE ?id=<item id>                   → 상품 삭제 (연결된 titles row는 안 지운다 — 이미 그
//                                           칭호를 산 유저들의 잠금해제 기록이 날아가면 안 되니까.
//                                           과거 구매 로그는 points_ledger.reason / spend_events.item_name에
//                                           문구가 그대로 스냅샷 되어 있어서, 상품을 지워도 기존
//                                           로그 표시엔 영향 없음)
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

// 칭호 상품 전용 칭호의 min_points — 절대 못 찍을 만큼 큰 값을 넣어서 포인트 달성으로는
// 잠금해제가 안 되고 오직 구매(user_purchased_titles)로만 풀리게 한다.
const PURCHASE_ONLY_MIN_POINTS = 999999999999;

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
      // titles(name): grants_title_id가 있으면 연결된 칭호 이름을 같이 내려줘서, 수정 모달을
      // 열 때 현재 칭호명을 바로 채워줄 수 있게 한다(FK 관계라 PostgREST가 자동으로 조인해줌).
      const { data, error } = await admin
        .from("shop_items")
        .select(
          "id, name, cost, description, requires_live, is_active, cooldown_seconds, grants_title_id, show_on_overlay, created_at, titles(name)",
        )
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
      const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : 0;
      const showOnOverlay = body.showOnOverlay === undefined ? true : body.showOnOverlay === true;
      const isTitleItem = body.isTitleItem === true;
      const titleName = typeof body.titleName === "string" ? body.titleName.trim() : "";
      // 칭호 상품은 한 번 사면 끝인 상품이라 쿨타임/방송중 제한 개념이 안 맞아서 항상 0/false로
      // 강제한다 — 프론트도 이 상품 유형에서는 해당 입력칸 자체를 안 보여줌.
      const requiresLive = isTitleItem ? false : body.requiresLive === true;
      const cooldownSeconds = isTitleItem
        ? 0
        : Number.isFinite(Number(body.cooldownSeconds))
        ? Math.max(0, Math.trunc(Number(body.cooldownSeconds)))
        : 0;

      if (!ID_PATTERN.test(itemId)) {
        return jsonResponse({ error: "invalid_id" }, 400);
      }
      if (name.length === 0) return jsonResponse({ error: "empty_name" }, 400);
      if (!Number.isFinite(cost) || cost <= 0) return jsonResponse({ error: "invalid_cost" }, 400);
      if (isTitleItem && titleName.length === 0) return jsonResponse({ error: "invalid_title_name" }, 400);

      // 칭호 상품이면 상품 row보다 먼저 전용 칭호를 titles 테이블에 만든다 — id를 상품 id와
      // 그대로 맞춰서(1:1) 나중에 수정할 때 별도 매핑 조회 없이 바로 찾을 수 있게 한다.
      if (isTitleItem) {
        const { data: maxSortRow } = await admin
          .from("titles")
          .select("sort_order")
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle();
        const nextSortOrder = (maxSortRow?.sort_order ?? 0) + 1;

        const { error: titleInsertError } = await admin
          .from("titles")
          .insert({ id: itemId, name: titleName, min_points: PURCHASE_ONLY_MIN_POINTS, sort_order: nextSortOrder });
        if (titleInsertError) {
          // titles.id는 shop_items.id와 별개 PK 공간이지만, 예전에 지워진 칭호 상품과 같은
          // id를 다시 쓰려는 경우(그 titles row는 구매자 보호를 위해 안 지워지므로) 충돌할 수
          // 있다 — 구분되는 에러로 알려준다.
          if (titleInsertError.code === "23505") return jsonResponse({ error: "title_id_conflict" }, 409);
          throw new Error(`titles insert 실패: ${titleInsertError.message}`);
        }
      }

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
          grants_title_id: isTitleItem ? itemId : null,
          show_on_overlay: showOnOverlay,
        })
        .select()
        .single();
      if (error) {
        // 상품 insert가 실패했는데 칭호는 이미 만들어졌으면(바로 위에서) 고아 칭호가 남으니
        // 되돌린다 — 이 titles row는 아직 아무도 구매/참조하지 않은 상태라 안전하게 지울 수 있음.
        if (isTitleItem) {
          await admin.from("titles").delete().eq("id", itemId);
        }
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
      if (body.showOnOverlay !== undefined) {
        update.show_on_overlay = body.showOnOverlay === true;
      }

      // titleName은 이 상품이 칭호 상품일 때만 의미가 있다 — 연결된 titles row의 이름을 갱신한다
      // (새 titles row를 만드는 게 아니라, POST 때 이미 만들어둔 걸 고쳐 쓰는 것).
      if (body.titleName !== undefined) {
        const { data: existing, error: existingError } = await admin
          .from("shop_items")
          .select("grants_title_id")
          .eq("id", id)
          .maybeSingle();
        if (existingError) throw new Error(`shop_items 조회 실패: ${existingError.message}`);
        if (!existing?.grants_title_id) return jsonResponse({ error: "not_title_item" }, 400);

        const titleName = typeof body.titleName === "string" ? body.titleName.trim() : "";
        if (titleName.length === 0) return jsonResponse({ error: "invalid_title_name" }, 400);

        const { error: titleUpdateError } = await admin
          .from("titles")
          .update({ name: titleName })
          .eq("id", existing.grants_title_id);
        if (titleUpdateError) throw new Error(`titles update 실패: ${titleUpdateError.message}`);
      }

      if (Object.keys(update).length === 0) {
        if (body.titleName === undefined) return jsonResponse({ error: "empty_update" }, 400);
        // titleName만 왔으면 shop_items 자체는 고칠 게 없으니 현재 상태 그대로 다시 내려준다.
        const { data, error } = await admin.from("shop_items").select().eq("id", id).single();
        if (error) throw new Error(`shop_items 조회 실패: ${error.message}`);
        return jsonResponse(data, 200);
      }

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
