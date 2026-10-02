// 방송 코드(0047_stream_codes.sql, 0051_stream_code_options.sql) 공용 코드 — stream-code(시청자 입력/오버레이)와 admin-stream-codes(관리자)가 같이 씀.
//
// 오버레이(overlay.html?key=...)는 코드가 생기거나 바뀔 때 Realtime broadcast로 알림을 받음.
// 채널 이름에 오버레이 키(app_secrets.overlay_key)가 들어가서, 키를 모르면 구독할 채널 이름 자체를 모름
// (overlay.html은 공개 파일이라 누구나 열 수 있어서 — 방송을 안 보고 코드만 빼가는 걸 막으려는 것).

// deno-lint-ignore no-explicit-any
type Admin = any;

export interface StreamCodeRow {
  id: number;
  code: string;
  points: number;
  points_max: number | null;   // 랜덤 코드면 최대 포인트(받는 사람마다 points~points_max 사이에서 뽑음)
  max_uses: number | null;
  used_count: number;
  created_at: string;
  expires_at: string;          // 무제한 코드는 "infinity"(0051_stream_code_options.sql)
  ended_at: string | null;
}

// 무제한 코드(expires_at = infinity)는 화면/오버레이에 expiresAt: null로 보냄.
function finiteTime(v: string | null): string | null {
  return v && Number.isFinite(new Date(v).getTime()) ? v : null;
}

export function toStreamCode(r: StreamCodeRow) {
  return {
    id: r.id,
    code: r.code,
    points: r.points,
    pointsMax: r.points_max ?? null,
    maxUses: r.max_uses,
    usedCount: r.used_count,
    createdAt: r.created_at,
    expiresAt: finiteTime(r.expires_at),
    endedAt: r.ended_at,
  };
}

// 진행 중 = 안 끝났고, 시간이 안 지났고(무제한이면 통과), 선착순이 안 찼음.
export function isActive(r: StreamCodeRow): boolean {
  const expires = finiteTime(r.expires_at);
  const timeOk = expires === null || new Date(expires).getTime() > Date.now();
  return !r.ended_at && timeOk && (r.max_uses == null || r.used_count < r.max_uses);
}

// 지금 진행 중인 코드(없으면 null). 진행 중인 건 한 번에 하나라 제일 최근 것만 보면 됨.
export async function getActiveCode(admin: Admin): Promise<StreamCodeRow | null> {
  const { data, error } = await admin
    .from("stream_codes")
    .select("id, code, points, points_max, max_uses, used_count, created_at, expires_at, ended_at")
    .is("ended_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`stream_codes 조회 실패: ${error.message}`);
  return data && isActive(data) ? data : null;
}

export async function getOverlayKey(admin: Admin): Promise<string | null> {
  const { data } = await admin.from("app_secrets").select("value").eq("name", "overlay_key").maybeSingle();
  return data?.value ?? null;
}

export function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 오버레이로 알림 보내기(실패해도 요청 자체는 성공으로 둠 — 오버레이는 부가 기능).
//   event: "code"(새 코드) / "update"(받은 인원 변화) / "end"(종료)
export async function broadcastToOverlay(admin: Admin, event: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const key = await getOverlayKey(admin);
    const url = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!key || !url || !serviceRoleKey) return;
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ topic: `stream-code-${key}`, event, payload: { ...payload, serverNow: new Date().toISOString() } }],
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) console.error(`오버레이 알림 실패 (status ${res.status})`);
  } catch (err) {
    console.error(`오버레이 알림 오류: ${err instanceof Error ? err.message : err}`);
  }
}
