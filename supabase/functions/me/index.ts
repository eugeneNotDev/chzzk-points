// 로그인한 유저 본인의 프로필 + 포인트 잔액 + 본인 포인트 로그 + 칭호.
// mypage.html, shop.html이 이 함수를 쓴다 (Authorization: Bearer <세션토큰> 필수).
//
// GET  → { channelId, channelName, isPublic, balance, maxBalanceReached, selectedTitleId,
//          purchasedTitleIds, refreshedToken? }
//   (maxBalanceReached: 지금까지 한 번이라도 도달한 최고 보유 포인트 — 칭호 잠금해제 판정 기준.
//   points_ledger에 행이 추가될 때마다 DB 트리거가 자동으로 갱신함, 0016_titles.sql 참고.
//   칭호 목록 자체(이름/필요 포인트)는 이 함수가 아니라 마이페이지가 titles 테이블에서
//   직접 anon으로 조회한다 — shop_items와 같은 패턴.
//   purchasedTitleIds: 포인트 상점에서 "구매"로 잠금해제한 칭호 id 목록(0020_purchasable_titles.sql).
//   maxBalanceReached 달성 여부와는 별개 경로 — 마이페이지가 칭호 잠금해제 판정할 때 이 두
//   조건을 OR로 합친다. user_purchased_titles는 개인별 구매 내역이라 anon 공개 정책이 없어서
//   여기서 서비스 롤로 조회해 내려준다.)
// GET ?action=points-log&page=N → { entries: [{ id, amount, reason, createdAt }], page, pageSize, totalCount, totalPages }
//   (본인 포인트 로그, 페이지당 10개, 최신순. 관리자 로그와 달리 기간 제한 없이 전체 보여줌 —
//   출석체크/관리자 지급·차감/포인트 상점 사용은 다 들어가지만, 나중에 채팅/후원으로 포인트를
//   주는 기능이 생기면 그건 reason을 "채팅:"/"후원:" 접두사로 남기고 여기선 제외할 것 — 그런
//   포인트는 양이 너무 많아서 개인 로그에 넣기엔 부적합하다고 판단함. 지금은 그 기능이 아직
//   없어서 이 필터는 사실상 아무것도 걸러내지 않음.)
// POST { isPublic?: boolean, selectedTitleId?: string | null } → 갱신 후 프로필 형태로 최신 상태 리턴
//   (selectedTitleId: null이면 장착 해제. 문자열이면 그 칭호가 실존하고 본인이 잠금해제한
//   상태인지 서버에서 다시 검증한다 — 잠긴 칭호를 억지로 장착하려는 요청은 title_locked로 거부.)
//
// 모든 응답(GET/POST 공통)에 refreshedToken이 실려올 수 있다 — 세션 토큰의 남은 유효기간이
// 얼마 안 남았을 때만(_shared/session.ts의 shouldRefresh) 새 토큰을 같이 내려준다("슬라이딩
// 세션". 별도 리프레시 엔드포인트 없이, 이 페이지들이 어차피 주기적으로 /me를 부르는 걸
// 이용함 — chzzk-auth.js의 authFetch가 이 필드를 보고 자동으로 localStorage를 갈아끼운다).
//
// verify_jwt는 config.toml에서 꺼져있다 (우리 세션 토큰을 Authorization에 쓰기 때문).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession, issueSessionToken, shouldRefresh } from "../_shared/session.ts";

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

const MY_POINTS_LOG_PAGE_SIZE = 10;

async function listMyPointsLog(channelId: string, page: number) {
  const admin = getAdminClient();
  const offset = (page - 1) * MY_POINTS_LOG_PAGE_SIZE;

  const { data: rows, error, count } = await admin
    .from("points_ledger")
    .select("id, amount, reason, created_at", { count: "exact" })
    .eq("channel_id", channelId)
    .not("reason", "like", "채팅:%")
    .not("reason", "like", "후원:%")
    .order("created_at", { ascending: false })
    .range(offset, offset + MY_POINTS_LOG_PAGE_SIZE - 1);
  if (error) throw new Error(`points_ledger 조회 실패: ${error.message}`);

  const entries = (rows ?? []).map((r) => ({
    id: r.id,
    amount: r.amount,
    reason: r.reason,
    createdAt: r.created_at,
  }));

  return { entries, totalCount: count ?? 0 };
}

// 칭호 장착/해제. titleId가 null이면 그냥 해제. 문자열이면 titles 테이블에 실존하는지 +
// 본인이 그 칭호를 잠금해제했는지(= max_balance_reached가 min_points 이상이거나,
// user_purchased_titles에 구매 기록이 있거나 — 0020_purchasable_titles.sql로 추가된
// 두 번째 경로) 서버에서 다시 검증한 뒤에만 반영한다 — 프론트 검증만 믿고 넘어가면
// 개발자도구로 잠긴 칭호를 강제로 장착하는 게 가능해지므로.
async function setSelectedTitle(channelId: string, titleId: string | null) {
  const admin = getAdminClient();

  if (titleId === null) {
    const { error } = await admin.from("users").update({ selected_title_id: null }).eq("channel_id", channelId);
    if (error) throw new Error(`selected_title_id 갱신 실패: ${error.message}`);
    return { ok: true as const };
  }

  const { data: title, error: titleError } = await admin
    .from("titles")
    .select("id, min_points")
    .eq("id", titleId)
    .maybeSingle();
  if (titleError) throw new Error(`titles 조회 실패: ${titleError.message}`);
  if (!title) return { ok: false as const, error: "title_not_found" as const };

  const { data: user, error: userError } = await admin
    .from("users")
    .select("max_balance_reached")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (userError) throw new Error(`users 조회 실패: ${userError.message}`);

  const achievedByBalance = Boolean(user) && user!.max_balance_reached >= title.min_points;
  let achievedByPurchase = false;
  if (!achievedByBalance) {
    const { data: purchased, error: purchasedError } = await admin
      .from("user_purchased_titles")
      .select("title_id")
      .eq("channel_id", channelId)
      .eq("title_id", titleId)
      .maybeSingle();
    if (purchasedError) throw new Error(`user_purchased_titles 조회 실패: ${purchasedError.message}`);
    achievedByPurchase = Boolean(purchased);
  }
  if (!achievedByBalance && !achievedByPurchase) {
    return { ok: false as const, error: "title_locked" as const };
  }

  const { error } = await admin.from("users").update({ selected_title_id: titleId }).eq("channel_id", channelId);
  if (error) throw new Error(`selected_title_id 갱신 실패: ${error.message}`);
  return { ok: true as const };
}

async function getProfile(channelId: string) {
  const admin = getAdminClient();

  const { data: user, error: userError } = await admin
    .from("users")
    .select("channel_id, channel_name, is_public, banned, max_balance_reached, selected_title_id")
    .eq("channel_id", channelId)
    .single();
  if (userError) throw new Error(`users 조회 실패: ${userError.message}`);

  const { data: ledgerRows, error: ledgerError } = await admin
    .from("points_ledger")
    .select("amount")
    .eq("channel_id", channelId);
  if (ledgerError) throw new Error(`points_ledger 조회 실패: ${ledgerError.message}`);

  const balance = (ledgerRows ?? []).reduce((sum, row) => sum + row.amount, 0);

  const { data: purchasedRows, error: purchasedError } = await admin
    .from("user_purchased_titles")
    .select("title_id")
    .eq("channel_id", channelId);
  if (purchasedError) throw new Error(`user_purchased_titles 조회 실패: ${purchasedError.message}`);

  return {
    channelId: user.channel_id,
    channelName: user.channel_name,
    isPublic: user.is_public,
    banned: user.banned,
    balance,
    maxBalanceReached: user.max_balance_reached,
    selectedTitleId: user.selected_title_id,
    purchasedTitleIds: (purchasedRows ?? []).map((r) => r.title_id),
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

    // 슬라이딩 세션 — 남은 유효기간이 얼마 없을 때만 새 토큰을 같이 내려준다 (session.ts 참고).
    const refreshedToken = shouldRefresh(session)
      ? await issueSessionToken({ channelId: session.channelId, channelName: session.channelName })
      : undefined;

    if (req.method === "GET" && new URL(req.url).searchParams.get("action") === "points-log") {
      const rawPage = Number(new URL(req.url).searchParams.get("page") ?? "1");
      const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.trunc(rawPage) : 1;
      const { entries, totalCount } = await listMyPointsLog(session.channelId, page);
      const totalPages = Math.max(Math.ceil(totalCount / MY_POINTS_LOG_PAGE_SIZE), 1);
      return jsonResponse(
        { entries, page, pageSize: MY_POINTS_LOG_PAGE_SIZE, totalCount, totalPages, ...(refreshedToken ? { refreshedToken } : {}) },
        200,
      );
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body.isPublic === "boolean") {
        const { error } = await admin
          .from("users")
          .update({ is_public: body.isPublic })
          .eq("channel_id", session.channelId);
        if (error) throw new Error(`is_public 갱신 실패: ${error.message}`);
      }
      if ("selectedTitleId" in body) {
        const titleId = body.selectedTitleId;
        if (titleId !== null && typeof titleId !== "string") {
          return jsonResponse({ error: "invalid_title" }, 400);
        }
        const result = await setSelectedTitle(session.channelId, titleId);
        if (!result.ok) {
          return jsonResponse({ error: result.error }, 400);
        }
      }
    }

    const profile = await getProfile(session.channelId);
    return new Response(JSON.stringify({ ...profile, ...(refreshedToken ? { refreshedToken } : {}) }), {
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
