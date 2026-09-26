// 방송 중 출석체크. 로그인 필요 (Authorization: Bearer <세션토큰>).
//
// 규칙: 방송 1번에 출석 1번. 출석 날짜를 "오늘"이 아니라 "지금 방송이 시작된 날짜(KST)"로
// 기록함 — 21시에 켜서 새벽 1시에 끄는 방송이면 자정이 넘어도 계속 전날 방송이라, 12시 넘어서
// 한 번 더 출석하는 게 막힘. 방송이 튕겨서 같은 날 다시 켜도 같은 날짜라 추가 출석 안 됨.
// (attendance의 (channel_id, attended_on) unique 제약이 그대로 관문 역할을 함.)
// 방송 시작 시각을 못 읽으면(치지직 응답에 없으면) 예전처럼 오늘 날짜로 기록함.
//
// 누적 출석 10번째마다 보너스 +50P(그 회차엔 기본 50P + 보너스 50P = 100P).
//
// GET  ?year=2026&month=9 → 그 달의 출석 현황 조회 (year/month 생략 시 이번 달, KST 기준)
//   { attendedDates: ["2026-09-14", ...], checkedToday, isLive, balance, attendanceCount, bonusEvery }
//   checkedToday: 방송 중이면 "이번 방송에 출석했는지", 아니면 "오늘 날짜로 출석 기록이 있는지".
//   attendanceCount: 누적 출석 횟수(밴 초기화 이후만). sessionDate: 지금 출석하면 기록될 날짜.
// POST {} → 출석체크 시도. 방송 중이 아니면 400 not_live, 이번 방송에 이미 했으면 400 already_checked.
//   성공 시 attendance 테이블에 기록 + points_ledger에 +50P (10번째마다 보너스 +50P 한 줄 더).
//   { attendedDates, checkedToday: true, isLive: true, balance, attendanceCount, bonusEvery, pointsEarned, bonus }
//
// 밴된 유저는 다른 함수들과 동일하게 403 { error: "banned" }.
//
// users.reset_at이 세팅돼 있으면(과거에 밴당했다가 풀린 적 있음) 그 시각 이전 출석 기록은
// attendedDates와 누적 횟수에서 빠짐 — me/index.ts의 포인트 로그와 같은 이유(밴 해제 후엔 출석체크
// 달력도 완전히 새로 시작한 것처럼 보이게 함). attendance 행 자체는 지우지 않음.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { broadcastDateKst, getLiveInfo } from "../_shared/live.ts";

const ATTENDANCE_POINTS = 50;
// 누적 출석 이 횟수마다 보너스를 한 번 더 줌.
const BONUS_EVERY = 10;
const BONUS_POINTS = 50;

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

// 잔액은 users.balance(points_ledger 트리거가 자동 갱신 — 0032_users_balance.sql).
async function getBalance(admin: ReturnType<typeof getAdminClient>, channelId: string): Promise<number> {
  const { data, error } = await admin.from("users").select("balance").eq("channel_id", channelId).maybeSingle();
  if (error) throw new Error(`잔액 조회 실패: ${error.message}`);
  return Number(data?.balance ?? 0);
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

// 누적 출석 횟수(밴 초기화 이후만 셈).
async function getAttendanceCount(
  admin: ReturnType<typeof getAdminClient>,
  channelId: string,
  resetAt: string | null,
): Promise<number> {
  let query = admin.from("attendance").select("*", { count: "exact", head: true }).eq("channel_id", channelId);
  if (resetAt) query = query.gt("created_at", resetAt);
  const { count, error } = await query;
  if (error) throw new Error(`attendance 개수 조회 실패: ${error.message}`);
  return count ?? 0;
}

// 특정 날짜에 출석 기록이 있는지. 달력 조회와 따로 두는 이유: 방송 시작일이 지난달일 수도 있어서
// (예: 31일 밤에 켠 방송을 1일 새벽에 보는 경우) 이번 달 목록만 보고 판단하면 틀림.
async function hasAttendedOn(
  admin: ReturnType<typeof getAdminClient>,
  channelId: string,
  dateStr: string,
  resetAt: string | null,
): Promise<boolean> {
  let query = admin.from("attendance").select("id").eq("channel_id", channelId).eq("attended_on", dateStr);
  if (resetAt) query = query.gt("created_at", resetAt);
  const { data, error } = await query.limit(1);
  if (error) throw new Error(`attendance 조회 실패: ${error.message}`);
  return (data ?? []).length > 0;
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

    const liveInfo = await getLiveInfo();
    // 이번 출석이 기록될 날짜 — 방송 중이면 방송 시작일, 아니면(또는 시작 시각을 못 읽으면) 오늘.
    // 시작일이 어제~오늘 범위를 벗어나면(이상한 값) 믿지 않고 오늘로 처리함.
    const broadcastDate = liveInfo.isLive ? broadcastDateKst(liveInfo) : null;
    const yesterdayStr = kstDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const sessionDate = broadcastDate && broadcastDate >= yesterdayStr && broadcastDate <= todayStr ? broadcastDate : todayStr;

    if (req.method === "GET") {
      const url = new URL(req.url);
      const year = Number(url.searchParams.get("year")) || todayYear;
      const month = Number(url.searchParams.get("month")) || todayMonth;

      const [attendedDates, balance, checkedToday, attendanceCount] = await Promise.all([
        getAttendedDates(admin, session.channelId, year, month, resetAt),
        getBalance(admin, session.channelId),
        hasAttendedOn(admin, session.channelId, sessionDate, resetAt),
        getAttendanceCount(admin, session.channelId, resetAt),
      ]);

      return jsonResponse(
        {
          attendedDates,
          checkedToday,
          isLive: liveInfo.isLive,
          balance,
          attendanceCount,
          bonusEvery: BONUS_EVERY,
          sessionDate,
        },
        200,
      );
    }

    // POST — 출석체크 시도
    if (!liveInfo.isLive) return jsonResponse({ error: "not_live" }, 400);

    // attendance를 먼저 넣음(포인트보다 먼저) — (channel_id, attended_on) unique 제약이
    // "이번 방송에 이미 체크했는지"를 동시성까지 안전하게 걸러주는 관문 역할이라서, 여길 먼저
    // 통과시켜야 중복 클릭/동시 요청에도 포인트가 두 번 지급되는 일이 없음.
    const { error: insertError } = await admin
      .from("attendance")
      .insert({ channel_id: session.channelId, attended_on: sessionDate });
    if (insertError) {
      if (insertError.code === "23505") {
        return jsonResponse({ error: "already_checked" }, 400);
      }
      throw new Error(`attendance insert 실패: ${insertError.message}`);
    }

    const attendanceCount = await getAttendanceCount(admin, session.channelId, resetAt);
    const bonus = attendanceCount > 0 && attendanceCount % BONUS_EVERY === 0 ? BONUS_POINTS : 0;

    const ledgerRows: { channel_id: string; amount: number; reason: string }[] = [
      { channel_id: session.channelId, amount: ATTENDANCE_POINTS, reason: "출석체크" },
    ];
    if (bonus > 0) {
      ledgerRows.push({ channel_id: session.channelId, amount: bonus, reason: `출석체크 ${attendanceCount}회 보너스` });
    }
    const { error: pointsError } = await admin.from("points_ledger").insert(ledgerRows);
    if (pointsError) throw new Error(`points_ledger insert 실패: ${pointsError.message}`);

    const [attendedDates, balance] = await Promise.all([
      getAttendedDates(admin, session.channelId, todayYear, todayMonth, resetAt),
      getBalance(admin, session.channelId),
    ]);

    return jsonResponse(
      {
        attendedDates,
        checkedToday: true,
        isLive: true,
        balance,
        attendanceCount,
        bonusEvery: BONUS_EVERY,
        pointsEarned: ATTENDANCE_POINTS + bonus,
        bonus,
      },
      200,
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return jsonResponse({ error: "attendance_failed" }, 500);
  }
});
