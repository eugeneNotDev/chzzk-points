// 포인트 사용 엔드포인트. 프론트엔드(shop.html)의 "사용" 버튼이 이 함수를 호출함
// (Authorization: Bearer <세션토큰>).
//
// POST { itemId: string }
//   성공: { balance, item: { id, name, cost }, titleGranted?: { id, name } }
//   실패: 401 { error: "unauthorized" } (미로그인)
//         403 { error: "banned" } (밴된 계정)
//         400 { error: "invalid_request" | "item_not_found" | "not_live" | "insufficient_balance"
//               | "cooldown" | "already_owned" | "sold_out" }  (cooldown이면 retryAfterSeconds도
//               같이 내려줌. already_owned는 grants_title_id가 있는 상품인데 이미 그 칭호를
//               구매한 경우. sold_out은 한정 수량(stock_limit)을 다 채운 경우 — 0021_shop_item_stock.sql)
//
// 상품 목록(shop_items)은 코드가 아니라 DB 테이블이라, 상품 추가/가격 변경/방송중 전용 토글/
// 쿨타임은 전부 Supabase 테이블 편집기에서 바로 할 수 있음 (배포 불필요) — 0010_shop_items.sql,
// 0013_shop_cooldown.sql 참고.
//
// 칭호 구매(0020_purchasable_titles.sql): shop_items.grants_title_id가 채워진 상품이면,
// 정상 결제 후 user_purchased_titles에 기록해서 그 칭호를 영구 잠금해제함(마이페이지
// 칭호 그리드가 이 테이블도 같이 봄 — me/index.ts 참고). 같은 칭호를 이미 샀으면 다시
// 못 사게 미리 막음. shop_items.show_on_overlay가 false인 상품은 spend_events에 기록을
// 안 남겨서 오버레이(overlay.html)에 안 뜸 — 칭호 구매처럼 방송 화면에 안 떠도 되는
// 상품에 관리자가 체크를 꺼두는 용도.
//
// 동시성 참고:
//   - 다른 유저끼리는 서로 영향이 없음. 잔액도 쿨타임도 전부 channel_id로 스코프된 조회/기록이라
//     각자 자기 행만 보고 씀 — Postgres가 서로 다른 행에 대한 동시 트랜잭션을 알아서 처리해주므로
//     "다른 사람이 동시에 써서 꼬이는" 문제는 애초에 없음.
//   - 같은 유저가 아주 짧은 간격으로 연타해도 잔액 이상은 절대 못 씀 — 잔액 확인과 차감을
//     DB 함수 debit_points()가 유저 행을 잠근 채 한 번에 처리함(0032_users_balance.sql). 쿨타임
//     체크 자체는 여전히 조회 후 기록이라 아주 짧은 연타에 쿨타임이 한 번 뚫릴 여지는 있지만,
//     그래도 잔액 범위 안에서만 가능함.

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

// banned/is_public을 한 번에 같이 조회함 (둘 다 users 한 행에서 나오는 값이라 쿼리를 안 나눔).
// is_public은 오버레이 표시용 spend_events 스냅샷에 씀 — 비공개 유저면 오버레이에 실명 대신
// "익명"으로 뜨게 하려는 목적 (랭킹은 이미 비공개 처리가 있었는데 오버레이만 빠져있었음).
async function getUserFlags(
  admin: ReturnType<typeof getAdminClient>,
  channelId: string,
): Promise<{ banned: boolean; isPublic: boolean }> {
  const { data, error } = await admin.from("users").select("banned, is_public").eq("channel_id", channelId).maybeSingle();
  if (error) throw new Error(`유저 정보 조회 실패: ${error.message}`);
  return { banned: data?.banned === true, isPublic: data?.is_public === true };
}

// 잔액 확인 + 차감 기록을 DB에서 한 번에(0032_users_balance.sql의 debit_points). 잔액이 모자라면
// null, 성공하면 차감 후 잔액.
async function debitPoints(
  admin: ReturnType<typeof getAdminClient>,
  channelId: string,
  amount: number,
  reason: string,
): Promise<number | null> {
  const { data, error } = await admin.rpc("debit_points", { p_channel_id: channelId, p_amount: amount, p_reason: reason });
  if (error) {
    if (error.message.includes("insufficient_balance")) return null;
    throw new Error(`debit_points 실패: ${error.message}`);
  }
  return Number(data);
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
    const { banned, isPublic } = await getUserFlags(admin, session.channelId);
    if (banned) return jsonResponse({ error: "banned" }, 403);

    const body = await req.json().catch(() => ({}));
    const itemId = typeof body.itemId === "string" ? body.itemId : null;
    if (!itemId) return jsonResponse({ error: "invalid_request" }, 400);

    const { data: item, error: itemError } = await admin
      .from("shop_items")
      .select(
        "id, name, cost, requires_live, is_active, cooldown_seconds, grants_title_id, show_on_overlay, stock_limit, sold_count",
      )
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

    // 칭호 부여 상품이면 이미 그 칭호를 산 적 있는지 미리 확인 — 중복 구매(포인트만 날리고
    // 아무 효과 없는 구매)를 막음.
    let titleName: string | null = null;
    if (item.grants_title_id) {
      const { data: title, error: titleError } = await admin
        .from("titles")
        .select("name")
        .eq("id", item.grants_title_id)
        .maybeSingle();
      if (titleError) throw new Error(`titles 조회 실패: ${titleError.message}`);
      titleName = title?.name ?? item.grants_title_id;

      const { data: existing, error: existingError } = await admin
        .from("user_purchased_titles")
        .select("title_id")
        .eq("channel_id", session.channelId)
        .eq("title_id", item.grants_title_id)
        .maybeSingle();
      if (existingError) throw new Error(`user_purchased_titles 조회 실패: ${existingError.message}`);
      if (existing) return jsonResponse({ error: "already_owned" }, 400);
    }

    // 한정 수량(재고) — 다 팔렸으면 상품을 지우지 않고 구매만 막음(0021_shop_item_stock.sql).
    if (item.stock_limit != null && item.sold_count >= item.stock_limit) {
      return jsonResponse({ error: "sold_out" }, 400);
    }

    // reason은 관리자 포인트 로그/마이페이지 로그에 그대로 노출되니 상품 코드가 아니라
    // 사람이 읽을 문구로 남김 (예전엔 "spend:water"처럼 코드로 남겨서 뭘 산건지 알아보기
    // 힘들었음 — 0015_backfill_spend_reason_names.sql 참고). 차감이 제일 먼저라, 잔액이
    // 모자라서 거절되면 아래 칭호 지급/재고/오버레이 기록은 아무것도 안 일어남.
    const newBalance = await debitPoints(admin, session.channelId, item.cost, `포인트 상점 사용: ${item.name}`);
    if (newBalance === null) return jsonResponse({ error: "insufficient_balance" }, 400);

    // 칭호 부여 상품이면 여기서 실제로 잠금해제 기록을 남김. (channel_id, title_id) 기본키라
    // 동시에 두 요청이 들어와도(위에서 미리 막았지만 이론상 레이스는 남아있음) 두 번째는
    // unique violation(23505)으로 막힘 — 그건 "이미 부여됨"과 같은 결과라 에러로 안 보고 무시.
    if (item.grants_title_id) {
      const { error: titleGrantError } = await admin
        .from("user_purchased_titles")
        .insert({ channel_id: session.channelId, title_id: item.grants_title_id });
      if (titleGrantError && titleGrantError.code !== "23505") {
        throw new Error(`user_purchased_titles insert 실패: ${titleGrantError.message}`);
      }
    }

    // 한정 수량 상품이면 판매 개수를 1 늘림. 읽고-다시-쓰는 방식이라 아주 짧은 간격의
    // 동시 요청에는 이론적 레이스가 남아있지만(파일 상단 "동시성 참고"와 같은 이유로 지금
    // 규모에선 감수), 위에서 재고 체크를 이미 통과한 뒤라 최악의 경우도 한두 개 초과 판매
    // 정도라 실사용에 문제 없음.
    if (item.stock_limit != null) {
      const { error: stockUpdateError } = await admin
        .from("shop_items")
        .update({ sold_count: item.sold_count + 1 })
        .eq("id", item.id);
      if (stockUpdateError) throw new Error(`sold_count 갱신 실패: ${stockUpdateError.message}`);
    }

    // 오버레이 표시용 이름 스냅샷 — 유저 이름은 세션 토큰의 channelName, 아이템 이름은 위에서
    // 이미 조회해둔 item.name을 그대로 씀(둘 다 추가 조회 불필요). 아이템 이름도 스냅샷으로
    // 남겨야 나중에 shop_items.name이 바뀌어도 과거 오버레이 로그가 안 틀어짐 — item_id(슬러그)
    // 를 그대로 보여주면 "OOO님이 temp1 사용!"처럼 사람이 못 알아보는 문제가 있었음
    // (0018_bugfixes.sql 참고). show_on_overlay가 false인 상품(칭호 구매 등)은 이 기록 자체를
    // 안 남겨서 오버레이(overlay.html)에 안 뜨게 함.
    if (item.show_on_overlay) {
      const { error: eventError } = await admin.from("spend_events").insert({
        channel_id: session.channelId,
        channel_name: session.channelName,
        item_id: item.id,
        item_name: item.name,
        is_public: isPublic,
      });
      if (eventError) throw new Error(`spend_events insert 실패: ${eventError.message}`);
    }

    return jsonResponse(
      {
        balance: newBalance,
        item: { id: item.id, name: item.name, cost: item.cost, cooldownSeconds: item.cooldown_seconds },
        ...(item.grants_title_id ? { titleGranted: { id: item.grants_title_id, name: titleName } } : {}),
      },
      200,
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return jsonResponse({ error: "spend_failed" }, 500);
  }
});
