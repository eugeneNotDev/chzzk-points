// 관리자 전용 기능 (유저 검색/포인트 지급·차감/밴 처리) 한 함수에 몰아넣음.
// Authorization: Bearer <세션토큰> 필수, session.channelId가 OWNER_CHANNEL_ID와
// 일치해야만 허용 (아니면 403). 전부 POST + body.action으로 분기함.
//
// POST { action: "search-users", q?: string, page?: number }
//   → { users: [{ channelId, channelName, isPublic, banned, balance }], page, pageSize, totalCount, totalPages }
//     (channel_name ilike 검색, q 없으면 전체. 페이지당 10명 — list-points-log와 같은 페이지네이션 패턴.)
// POST { action: "adjust-points", channelId: string, amount: number, reason?: string }
//   → { channelId, balance }  (points_ledger에 한 줄 추가. amount는 음수 가능 — 차감. admin_action=true로
//     남아서 undo-adjustment로 나중에 취소할 수 있음.)
// POST { action: "set-ban", channelId: string, banned: boolean }
//   → { channelId, banned }  (밴 걸면 랭킹에서도 빠지고 재로그인도 막힘 — oauth-callback, public.ranking 참고.
//     banned=true로 새로 거는 순간 그 계정의 포인트/칭호 보유분을 전부 초기화함(resetAccountHoldings) —
//     이후 밴을 풀어도 초기화된 상태 그대로 유지되고 되돌아오지 않음. banned=false(밴 해제)는
//     초기화를 하지 않고 플래그만 내림. 이때 users.reset_at도 같이 찍어두는데, 이건 points_ledger
//     행 자체를 지우진 않지만(잔액 계산 근거 보존 — resetAccountHoldings 주석 참고) me/index.ts의
//     마이페이지 개인 로그 조회가 이 시각 이전 기록은 걸러서 안 보여주는 기준값으로 씀 — 유저
//     입장에선 로그까지 완전히 비워진 것처럼 보임. 관리자용 로그(list-points-log/get-user-detail)는
//     감사 목적이라 이 필터를 적용하지 않고 항상 전체 기록을 보여줌.)
// POST { action: "bulk-adjust-points", target: "all" | "selected", channelIds?: string[], amount: number, reason?: string }
//   → { affected: number }  (points_ledger에 대상 전원 몫으로 한 줄씩 insert. amount는 음수 가능 — 일괄 차감.
//     target="all"이면 서버가 banned=false && 관리자 계정 제외한 전체 유저를 대상으로 계산함(클라이언트가
//     보고 있는 검색 목록/페이지와 무관하게 진짜 전체). target="selected"면 channelIds에 담아 보낸 유저들만
//     대상 — 관리자 화면에서 체크박스로 고른 유저 목록. 각 행 admin_action=true로 남아서 개별로
//     undo-adjustment 취소 가능.)
// POST { action: "undo-adjustment", id: number }
//   → { id, undone: true } | { error: "not_found" | "not_undoable" | "already_undone" }
//     (points_ledger의 한 행(adjust-points/bulk-adjust-points로 생긴 admin_action=true 행만 대상)을
//     취소함 — 원래 행을 지우거나 고치지 않고, 반대 부호의 보정 행을 새로 추가하는 방식(reason:
//     "실행취소: <원래 reason>", admin_action=false — 보정 행 자체는 다시 취소 대상이 아님).
//     원래 행엔 undone=true를 세워서 중복 취소를 막음. 출석체크/상점 사용/밴 초기화 등 admin_action이
//     아닌 행은 애초에 대상이 아니라서 "not_undoable"로 거절함 — 프론트에서 버튼 자체를 admin_action
//     행에만 보여주지만(admin.html), 여기서도 한 번 더 확인함.)
// POST { action: "list-points-log", q?: string, page?: number }
//   → { entries: [{ id, channelId, channelName, amount, reason, processed, adminAction, undone, createdAt }], page, pageSize, totalCount, totalPages }
//     (points_ledger 최근 기록(지급/차감/상점 사용/출석체크 등 전부), 페이지당 10개. q 있으면 그
//     이름을 가진 유저 기록만, 없으면 전체 유저 통틀어 최신순 — 오버레이 놓쳤을 때 누가 언제 뭘
//     했는지 훑어보는 용도. 최근 24시간 것만 보여줌 — 그 이상 지난 관리자 모니터링용 로그는
//     화면에 굳이 안 보여줘도 된다고 판단(요청사항). 단, 이건 "화면 표시" 필터일 뿐 points_ledger
//     자체에서 실제로 지우진 않음 — 이 테이블은 잔액 계산의 근거(users.balance가 이 기록으로
//     맞춰짐)라서 오래된 행을 진짜 삭제하면 유저 잔액이 깨짐. 마이페이지 개인 로그(me/index.ts)는
//     이 24시간 제한 없이 전체 기록을 그대로 보여줌.
//     처리완료 체크는 여기 없음 — 상점 사용 처리는 아래 list-spend-log 전용 화면에서만 함
//     (한 화면에 모든 종류 기록 + 체크박스가 섞여 있으니 오히려 헷갈린다는 피드백으로 분리함).
// POST { action: "list-spend-log", q?: string, page?: number }
//   → { entries: [{ id, channelId, channelName, amount, reason, processed, titlePurchase, createdAt }], page, pageSize, totalCount, totalPages }
//     (titlePurchase: 칭호 상점 구매 기록인지 — 칭호는 사는 순간 자동 지급이라 처리완료 체크가 필요 없어서
//     화면이 이 줄엔 체크박스/처리 버튼을 안 띄움. 0045_title_purchase_flag.sql 참고.)
//     (points_ledger에서 상점 사용("포인트 상점 사용: ..." reason) 기록만 걸러서 보여줌 —
//     list-points-log와 달리 24시간 제한 없이 전체 기간. 예전에 처리해둔 것도 나중에 다시 찾아볼
//     수 있어야 해서 기간을 안 자름. admin.html의 "상점 내역" 탭 전용 — 처리완료 체크박스는 여기
//     항목에만 뜸.)
// POST { action: "set-processed", id: number, processed: boolean }
//   → { id, processed }  (points_ledger 한 행의 처리완료 표시를 토글. 오버레이 상점 사용 알림을
//     놓쳤을 때, 상점 내역에서 이미 처리한 건지 체크해두는 용도 — 0019_admin_features.sql 참고.
//     어떤 행에든 걸 수 있는 범용 필드지만, 화면(admin.html)에서는 상점 내역 탭에서만 씀.)
// POST { action: "bulk-set-processed", ids: number[], processed: boolean }
//   → { affected: number }  (points_ledger 여러 행의 처리완료 표시를 한 번에 토글 — 상점 내역
//     탭에서 체크박스로 여러 항목을 고른 뒤 "일괄 처리완료로 표시" 같은 버튼을 누르면 여기로
//     들어옴. set-processed와 같은 컬럼을 건드리지만 여러 id를 한 쿼리로 처리.)
// POST { action: "get-stats" }
//   → { userCount, bannedCount, totalPoints, todaySpendCount, todayAttendanceCount }
//     (관리자 페이지 상단 요약 카드용 — 전체 가입자 수, 밴된 유저 수, 현재 전체 유저 잔액 합계,
//     오늘(KST) 상점 사용 건수, 오늘(KST) 출석체크 인원.)
// POST { action: "get-user-detail", channelId: string, page?: number }
//   → { channelId, channelName, isPublic, banned, createdAt, maxBalanceReached, balance,
//       attendanceCount, log: [{ id, amount, reason, processed, adminAction, undone, createdAt }],
//       ownedTitles: [{ id, name, color, kind, equipped }],
//       page, pageSize, totalCount, totalPages }
//     (유저 한 명의 전체 내역 — list-points-log와 달리 24시간 제한 없이 전체 기간, 페이지당 10개.
//     관리자 유저 목록에서 행을 클릭하면 뜨는 상세 모달용.)
// POST { action: "grant-custom-title", channelId: string, name: string, color: "#rrggbb" | "rainbow" 등 }
//   → { title: { id, name, color, kind: "custom" } } | { error: "invalid_title_name" | "invalid_title_color" | "user_not_found" }
//     (관리자가 특정 유저한테 칭호를 직접 줌 — 이름/색을 정해서 그 유저 전용 칭호를 새로 만들고
//     보유 기록(user_purchased_titles)을 넣음. 유저가 마이페이지 칭호 목록에서 직접 장착함.)
// POST { action: "grant-title", channelId: string, titleId: string }
//   → { granted: true } | { error: "title_not_found" | "not_grantable" | "already_owned" | "user_not_found" }
//     (이미 있는 칭호(상점 칭호나 다른 유저한테 줬던 관리자 칭호)를 그대로 지급 — 테스트용이나, 구매가
//     제대로 안 들어간 경우 수동으로 넣어줄 때. 포인트는 안 빠지고 상품 판매 수량도 안 바뀜. 포인트
//     구간 칭호(브론즈~다이아)는 자동으로 붙는 거라 대상 아님(not_grantable).)
// POST { action: "revoke-title", channelId: string, titleId: string }
//   → { revoked: true } | { error: "not_owned" }
//     (그 유저에게서 칭호 하나를 회수 — 보유 기록을 지우고 장착 중이었으면 해제. 관리자가 준
//     칭호(custom)는 더 이상 가진 사람이 없으면 칭호 자체도 지움. 상점 칭호는 상품이 남아있으니
//     칭호는 그대로 두고 이 유저의 보유 기록만 지움.)
// POST { action: "create-prediction", title: string, options: string[](2개 이상), durationMinutes: 5|10|15 }
//   → { predictionId } | { error: "already_open" | "invalid_title" | "invalid_options" | "invalid_duration" }
//     (진행 중(open)인 투표가 이미 있으면 already_open으로 거절 — "한 번에 하나만" 규칙을 여기서 지킴.)
// POST { action: "cancel-prediction", predictionId: number }
//   → { predictionId, cancelled: true } | { error: "not_found" | "not_open" }
//     (진행 중인 투표를 중도 취소하고 이미 걸린 포인트를 전액 환불함 — points_ledger에 보정 행 추가,
//     원장 행 자체는 안 지움.)
// POST { action: "resolve-prediction", predictionId: number, winningOptionId: number }
//   → { predictionId, resolved: true } | { error: "not_found" | "not_open" | "not_closed_yet" | "invalid_option" }
//     (마감시각(closes_at)이 지난 뒤에만 가능 — 정산: 전체 풀을 승자들 지분대로 나눠서 points_ledger에
//     지급 행 추가. 승리 항목에 아무도 안 걸었으면 승자가 없으니 전액 환불로 처리함.)
// POST { action: "get-prediction-status" }
//   → { prediction: null } | { prediction: { id, title, status, closesAt, resolvedAt, cancelledAt,
//       winningOptionId, options: [{ id, label, totalAmount, percent }], totalPool,
//       bets: [{ channelId, channelName, optionId, amount, payout, createdAt }] } }
//     (가장 최근 투표 1건 — 관리자 화면용이라 predictions 함수(유저용 GET)와 달리 개별 베팅 내역까지
//     그대로 보여줌(요청사항: 관리자에게는 비익명).)

import { getAdminClient } from "../_shared/db.ts";
import { json } from "../_shared/http.ts";
import { handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";
import { POINTS_LOG_PAGE_SIZE, SPEND_LOG_PAGE_SIZE, bulkSetProcessed, getStats, listPointsLog, listSpendLog, setProcessed } from "./logs.ts";
import { cancelPrediction, createPrediction, getPredictionStatus, resolvePrediction } from "./predictions.ts";
import { TITLE_COLOR_PATTERN, TITLE_NAME_MAX, grantCustomTitle, grantExistingTitle, revokeTitle } from "./titles.ts";
import { ADMIN_USER_PAGE_SIZE, USER_DETAIL_LOG_PAGE_SIZE, adjustPoints, bulkAdjustPoints, getAllActiveChannelIds, getUserDetail, searchUsers, setBan, undoAdjustment } from "./users.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const session = await requireSession(req);
  if (!session) return json({ error: "unauthorized" }, 401);
  if (session.channelId !== OWNER_CHANNEL_ID) return json({ error: "forbidden" }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const admin = getAdminClient();

    if (body.action === "search-users") {
      const q = typeof body.q === "string" ? body.q : undefined;
      const rawPage = typeof body.page === "number" ? Math.trunc(body.page) : 1;
      const page = Math.max(rawPage, 1);
      const { users, totalCount } = await searchUsers(admin, q, page);
      const totalPages = Math.max(Math.ceil(totalCount / ADMIN_USER_PAGE_SIZE), 1);
      return json({ users, page, pageSize: ADMIN_USER_PAGE_SIZE, totalCount, totalPages }, 200);
    }

    if (body.action === "adjust-points") {
      const { channelId, amount, reason } = body;
      if (typeof channelId !== "string" || !channelId) return json({ error: "missing_channel_id" }, 400);
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
        return json({ error: "invalid_amount" }, 400);
      }
      const balance = await adjustPoints(admin, channelId, Math.trunc(amount), typeof reason === "string" ? reason : "");
      return json({ channelId, balance }, 200);
    }

    if (body.action === "set-ban") {
      const { channelId, banned } = body;
      if (typeof channelId !== "string" || !channelId) return json({ error: "missing_channel_id" }, 400);
      if (typeof banned !== "boolean") return json({ error: "invalid_banned" }, 400);
      await setBan(admin, channelId, banned);
      return json({ channelId, banned }, 200);
    }

    if (body.action === "bulk-adjust-points") {
      const { target, amount, reason } = body;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
        return json({ error: "invalid_amount" }, 400);
      }
      const truncAmount = Math.trunc(amount);

      let channelIds: string[];
      if (target === "all") {
        channelIds = await getAllActiveChannelIds(admin);
      } else if (target === "selected") {
        if (!Array.isArray(body.channelIds) || body.channelIds.some((c: unknown) => typeof c !== "string" || !c)) {
          return json({ error: "invalid_channel_ids" }, 400);
        }
        channelIds = [...new Set(body.channelIds as string[])];
      } else {
        return json({ error: "invalid_target" }, 400);
      }

      const affected = await bulkAdjustPoints(admin, channelIds, truncAmount, typeof reason === "string" ? reason : "");
      return json({ affected }, 200);
    }

    if (body.action === "undo-adjustment") {
      const { id } = body;
      if (typeof id !== "number" || !Number.isFinite(id)) return json({ error: "missing_id" }, 400);
      const result = await undoAdjustment(admin, Math.trunc(id));
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ id, undone: true }, 200);
    }

    if (body.action === "list-points-log") {
      const q = typeof body.q === "string" ? body.q : undefined;
      const rawPage = typeof body.page === "number" ? Math.trunc(body.page) : 1;
      const page = Math.max(rawPage, 1);
      const { entries, totalCount } = await listPointsLog(admin, q, page);
      const totalPages = Math.max(Math.ceil(totalCount / POINTS_LOG_PAGE_SIZE), 1);
      return json({ entries, page, pageSize: POINTS_LOG_PAGE_SIZE, totalCount, totalPages }, 200);
    }

    if (body.action === "list-spend-log") {
      const q = typeof body.q === "string" ? body.q : undefined;
      const rawPage = typeof body.page === "number" ? Math.trunc(body.page) : 1;
      const page = Math.max(rawPage, 1);
      const { entries, totalCount } = await listSpendLog(admin, q, page);
      const totalPages = Math.max(Math.ceil(totalCount / SPEND_LOG_PAGE_SIZE), 1);
      return json({ entries, page, pageSize: SPEND_LOG_PAGE_SIZE, totalCount, totalPages }, 200);
    }

    if (body.action === "set-processed") {
      const { id, processed } = body;
      if (typeof id !== "number" || !Number.isFinite(id)) return json({ error: "missing_id" }, 400);
      if (typeof processed !== "boolean") return json({ error: "invalid_processed" }, 400);
      await setProcessed(admin, id, processed);
      return json({ id, processed }, 200);
    }

    if (body.action === "bulk-set-processed") {
      const { ids, processed } = body;
      if (!Array.isArray(ids) || ids.length === 0 || ids.some((i: unknown) => typeof i !== "number" || !Number.isFinite(i))) {
        return json({ error: "invalid_ids" }, 400);
      }
      if (typeof processed !== "boolean") return json({ error: "invalid_processed" }, 400);
      const affected = await bulkSetProcessed(admin, ids as number[], processed);
      return json({ affected }, 200);
    }

    if (body.action === "get-stats") {
      const stats = await getStats(admin);
      return json(stats, 200);
    }

    if (body.action === "get-user-detail") {
      const { channelId } = body;
      if (typeof channelId !== "string" || !channelId) return json({ error: "missing_channel_id" }, 400);
      const rawPage = typeof body.page === "number" ? Math.trunc(body.page) : 1;
      const page = Math.max(rawPage, 1);
      const detail = await getUserDetail(admin, channelId, page);
      if (!detail) return json({ error: "user_not_found" }, 404);
      const totalPages = Math.max(Math.ceil(detail.logTotalCount / USER_DETAIL_LOG_PAGE_SIZE), 1);
      return json({ ...detail, page, pageSize: USER_DETAIL_LOG_PAGE_SIZE, totalPages }, 200);
    }

    if (body.action === "grant-custom-title") {
      const { channelId } = body;
      if (typeof channelId !== "string" || !channelId) return json({ error: "missing_channel_id" }, 400);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length === 0 || name.length > TITLE_NAME_MAX) return json({ error: "invalid_title_name" }, 400);
      if (typeof body.color !== "string" || !TITLE_COLOR_PATTERN.test(body.color)) {
        return json({ error: "invalid_title_color" }, 400);
      }
      const result = await grantCustomTitle(admin, channelId, name, body.color);
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ title: result.title }, 200);
    }

    if (body.action === "grant-title") {
      const { channelId, titleId } = body;
      if (typeof channelId !== "string" || !channelId) return json({ error: "missing_channel_id" }, 400);
      if (typeof titleId !== "string" || !titleId) return json({ error: "missing_title_id" }, 400);
      const result = await grantExistingTitle(admin, channelId, titleId);
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ granted: true }, 200);
    }

    if (body.action === "revoke-title") {
      const { channelId, titleId } = body;
      if (typeof channelId !== "string" || !channelId) return json({ error: "missing_channel_id" }, 400);
      if (typeof titleId !== "string" || !titleId) return json({ error: "missing_title_id" }, 400);
      const result = await revokeTitle(admin, channelId, titleId);
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ revoked: true }, 200);
    }

    if (body.action === "create-prediction") {
      const { title, options, durationMinutes } = body;
      if (typeof title !== "string" || !title.trim()) return json({ error: "invalid_title" }, 400);
      if (
        !Array.isArray(options) ||
        options.length < 2 ||
        options.some((o: unknown) => typeof o !== "string" || !o.trim())
      ) {
        return json({ error: "invalid_options" }, 400);
      }
      if (![5, 10, 15].includes(durationMinutes)) return json({ error: "invalid_duration" }, 400);
      const trimmedOptions = (options as string[]).map((o) => o.trim());
      const result = await createPrediction(admin, title.trim(), trimmedOptions, durationMinutes);
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ predictionId: result.predictionId }, 200);
    }

    if (body.action === "cancel-prediction") {
      const { predictionId } = body;
      if (typeof predictionId !== "number" || !Number.isFinite(predictionId)) {
        return json({ error: "missing_prediction_id" }, 400);
      }
      const result = await cancelPrediction(admin, Math.trunc(predictionId));
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ predictionId, cancelled: true }, 200);
    }

    if (body.action === "resolve-prediction") {
      const { predictionId, winningOptionId } = body;
      if (typeof predictionId !== "number" || !Number.isFinite(predictionId)) {
        return json({ error: "missing_prediction_id" }, 400);
      }
      if (typeof winningOptionId !== "number" || !Number.isFinite(winningOptionId)) {
        return json({ error: "missing_winning_option_id" }, 400);
      }
      const result = await resolvePrediction(admin, Math.trunc(predictionId), Math.trunc(winningOptionId));
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ predictionId, resolved: true }, 200);
    }

    if (body.action === "get-prediction-status") {
      const status = await getPredictionStatus(admin);
      return json({ prediction: status }, 200);
    }

    return json({ error: "unknown_action" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "admin_failed" }, 500);
  }
});
