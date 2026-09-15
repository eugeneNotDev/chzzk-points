// 방송 중 출석체크. 로그인 필요 (Authorization: Bearer <세션토큰>).
//
// GET  ?year=2026&month=9 → 그 달의 출석 현황 조회 (year/month 생략 시 이번 달, KST 기준)
//   { attendedDates: ["2026-09-14", ...], checkedToday: boolean, isLive: boolean, balance }
// POST {} → 오늘(KST) 출석체크 시도. 방송 중이 아니거나 오늘 이미 체크했으면 400.
//   성공 시 attendance 테이블에 기록 + points_ledger에 +10P 기록.
//   { attendedDates, checkedToday: true, isLive: true, balance }
//
// 밴된 유저는 다른 함수들과 동일하게 403 { error: "banned" }.
//
// users.reset_at이 세팅돼 있으면(과거에 밴당했다가 풀린 적 있음) 그 시각 이전 출석 기록은
// attendedDates에서 걸러짐 — me/index.ts의 포인트 로그와 같은 이유(밴 해제 후엔 출석체크
// 달력도 완전히 새로 시작한 것처럼 보이게 함). attendance 행 자체는 지우지 않음.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { isChannelLive } from "../_shared/live.ts";

const ATTENDANCE_POINTS = 10;

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

// 주어진 시각을 "한국 시간(KST) 기준 YYYY-MM-DD" 문자열로. 해외 접속자가 있어도 서버 기준으로
// 하루 경계가 항상 한국 자정이 되게 하려고 Intl로 타임존을 명시함 (수동 시(時) 계산보다 안전함).
function kstDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function isBanned(admin: ReturnType<typeof getAdminClient>, channelId: string): Promise<boolean> {
  const { data, error } = await admin.from("users").select("banned").eq("channel_id", channelId).maybeSingle();
  if (error) throw new Error(`banned 조회 실패: ${error.message}`);
  return data?.banned === true;
}

// me/index.ts의 listMyPointsLog와 같은 이유 — users.reset_at이 세팅돼 있으면(과거에 밴당한
// 적 있음, admin/index.ts의 setBan 참고) 그 시각 이전 출석 기록은 달력에서 안 보여줌. 밴
// 해제 후엔 출석체크도 포인트 로그처럼 완전히 새로 시작한 것처럼 보이게 하려는 의도.
// attendance 행 자체는 안 지움(관리자 쪽에서 필요하면 그대로 조회 가능).
async function getResetAt(admin: ReturnType<typeof getAdminClient>, channelId: string): Promise<string | null> {
  const { data, error } = await admin.from("users").select("reset_at").eq("channel_id", channelId).maybeSingle();
  if (error) throw new Error(`reset_at 조회 실패: ${error.message}`);
  return data?.reset_at ?? null;
}

async function getBalance(admin: ReturnType<typeof getAdminClient>, channelId: string): Promise<number> {
  const { data, error } = await admin.from("points_ledger").select("amount").eq("channel_id", channelId);
  if (error) throw new Error(`points_ledger 조회 실패: ${error.message}`);
  return (data ?? []).reduce((sum: number, row: { amount: number }) => sum + row.amount, 0);
}

// year(4자리)/month(1~12)의 출석한 날짜 목록을 "YYYY-MM-DD" 문자열 배열로 반환함.
async function getAttendedDates(
  admin: ReturnType<typeof getAdminClient>,
  channelId: string,
  year: number,
  month: number,
  resetAt: string | null,
): Promise<string[]> {
  const startStr = `${year}-${String(month).padStart(2, "0")}-01`;
  // 다음 달 1일 — Date.UTC는 달력 계산용으로만 쓰고(실제 타임존과 무관), month는 0-based라 그대로 넘기면 다음 달이 됨.
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const endStr = nextMonth.toISOString().slice(0, 10);

  let query = admin
    .from("attendance")
    .select("attended_on")
    .eq("channel_id", channelId)
    .gte("attended_on", startStr)
    .lt("attended_on", endStr);
  if (resetAt) {
    query = query.gt("created_at", resetAt);
  }

  const { data, error } = await query;
  if (error) throw new Error(`attendance 조회 실패: ${error.message}`);
  return (data ?? []).map((row: { attended_on: string }) => row.attended_on);
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (!["GET", "POST"].includes(req.method)) {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const session = await requireSession(req);
  if (!session) return jsonResponse({ error: "unauthorized" }, 401);

  try {
    const admin = getAdminClient();
    if (await isBanned(admin, session.channelId)) return jsonResponse({ error: "banned" }, 403);

    const resetAt = await getResetAt(admin, session.channelId);
    const todayStr = kstDateString(new Date());
    const [todayYear, todayMonth] = todayStr.split("-").map(Number);

    if (req.method === "GET") {
      const url = new URL(req.url);
      const year = Number(url.searchParams.get("year")) || todayYear;
      const month = Number(url.searchParams.get("month")) || todayMonth;

      const [attendedDates, balance, isLive] = await Promise.all([
        getAttendedDates(admin, session.channelId, year, month, resetAt),
        getBalance(admin, session.channelId),
        isChannelLive(),
      ]);

      return jsonResponse(
        {
          attendedDates,
          checkedToday: attendedDates.includes(todayStr),
          isLive,
          balance,
        },
        200,
      );
    }

    // POST — 오늘 출석체크 시도
    const live = await isChannelLive();
    if (!live) return jsonResponse({ error: "not_live" }, 400);

    // attendance를 먼저 넣음(포인트보다 먼저) — (channel_id, attended_on) unique 제약이
    // "오늘 이미 체크했는지"를 동시성까지 안전하게 걸러주는 관문 역할이라서, 여길 먼저
    // 통과시켜야 중복 클릭/동시 요청에도 포인트가 두 번 지급되는 일이 없음.
    const { error: insertError } = await admin
      .from("attendance")
      .insert({ channel_id: session.channelId, attended_on: todayStr });
    if (insertError) {
      if (insertError.code === "23505") {
        return jsonResponse({ error: "already_checked" }, 400);
      }
      throw new Error(`attendance insert 실패: ${insertError.message}`);
    }

    const { error: pointsError } = await admin
      .from("points_ledger")
      .insert({ channel_id: session.channelId, amount: ATTENDANCE_POINTS, reason: "출석체크" });
    if (pointsError) throw new Error(`points_ledger insert 실패: ${pointsError.message}`);

    const [attendedDates, balance] = await Promise.all([
      getAttendedDates(admin, session.channelId, todayYear, todayMonth, resetAt),
      getBalance(admin, session.channelId),
    ]);

    return jsonResponse({ attendedDates, checkedToday: true, isLive: true, balance }, 200);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return jsonResponse({ error: "attendance_failed" }, 500);
  }
});
