// 데이터 백업 — 무료 플랜은 Supabase 자동 백업이 없어서 직접 만듦(0059_backups.sql).
// 주요 테이블을 통째로 JSON으로 묶어 gzip 압축 후 비공개 Storage 버킷(backups)에 저장.
//   - 매주 자동: pg_cron이 x-backup-key 헤더(app_secrets.backup_key 값)를 붙여 호출 → kind "auto"
//   - 관리자 수동: 관리자 페이지 "백업" 탭에서 "지금 백업" → kind "manual"
// 보관: 자동 최근 8개, 수동 최근 10개(그보다 오래된 건 지움).
// 비밀값/토큰 테이블(app_secrets, streamer_tokens, hidden_pages)과 금방 지워지는 신호용 테이블은 백업에서 뺌.
//
// POST { action: "run" }                → { ok, path, sizeBytes, tables }
// POST { action: "list" }               → { items: [{ path, kind, createdAt, sizeBytes }] }   (관리자)
// POST { action: "download", path }     → { url }  (60초짜리 다운로드 링크, 관리자)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

const BUCKET = "backups";
const KEEP = { auto: 8, manual: 10 };
const TABLES = [
  "users", "points_ledger", "titles", "user_purchased_titles", "user_special_titles",
  "attendance", "shop_items", "spend_events", "donations",
  "predictions", "prediction_options", "prediction_bets",
  "roulette_outcomes", "roulette_spins", "rps_games", "odd_even_games", "free_box_draws",
  "stream_codes", "stream_code_redemptions", "stream_code_failures",
  "notices", "notice_attachments", "broadcast_schedule", "broadcast_sessions",
  "board_posts", "board_comments", "board_images", "board_review_rewards", "board_reports",
  "egg_progress",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function getAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, key);
}
type Admin = ReturnType<typeof getAdmin>;

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// 파일 이름: 2026-10-05_0513_auto.json.gz (한국 시간)
function fileName(kind: string) {
  const k = new Date(Date.now() + 9 * 3600_000).toISOString();
  return `${k.slice(0, 10)}_${k.slice(11, 13)}${k.slice(14, 16)}_${kind}.json.gz`;
}
function parseName(name: string) {
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})_(auto|manual)\.json\.gz$/.exec(name);
  if (!m) return null;
  return { kind: m[4], createdAt: new Date(`${m[1]}T${m[2]}:${m[3]}:00+09:00`).toISOString() };
}

async function runBackup(admin: Admin, kind: "auto" | "manual") {
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error } = await admin.from(t).select("*").range(from, from + 999);
      if (error) throw new Error(`${t} 읽기 실패: ${error.message}`);
      rows.push(...(page ?? []));
      if (!page || page.length < 1000) break;
    }
    data[t] = rows;
    counts[t] = rows.length;
  }
  const body = JSON.stringify({ meta: { createdAt: new Date().toISOString(), kind, tables: counts }, data });
  const gz = await gzip(body);
  const path = fileName(kind);
  const { error } = await admin.storage.from(BUCKET).upload(path, gz, { contentType: "application/gzip", upsert: true });
  if (error) throw new Error(`백업 업로드 실패: ${error.message}`);

  // 오래된 백업 정리
  const items = await listBackups(admin);
  for (const k of ["auto", "manual"] as const) {
    const old = items.filter((i) => i.kind === k).slice(KEEP[k]).map((i) => i.path);
    if (old.length) await admin.storage.from(BUCKET).remove(old);
  }
  return { path, sizeBytes: gz.byteLength, tables: counts };
}

async function listBackups(admin: Admin) {
  const { data, error } = await admin.storage.from(BUCKET).list("", { limit: 100, sortBy: { column: "name", order: "desc" } });
  if (error) throw new Error(`백업 목록 실패: ${error.message}`);
  return (data ?? [])
    .map((f: any) => ({ f, p: parseName(f.name) }))
    .filter((x) => x.p)
    .map((x) => ({ path: x.f.name, kind: x.p!.kind, createdAt: x.p!.createdAt, sizeBytes: x.f.metadata?.size ?? null }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => ({}));

  try {
    const admin = getAdmin();

    // 예약 작업(pg_cron) 호출: 비밀 키로 확인
    const cronKey = req.headers.get("x-backup-key");
    if (cronKey) {
      const { data: s } = await admin.from("app_secrets").select("value").eq("name", "backup_key").maybeSingle();
      if (!s?.value || s.value !== cronKey) return json({ error: "forbidden" }, 403);
      return json({ ok: true, ...(await runBackup(admin, "auto")) });
    }

    const session = await requireSession(req);
    if (!session) return json({ error: "unauthorized" }, 401);
    if (session.channelId !== OWNER_CHANNEL_ID) return json({ error: "forbidden" }, 403);

    if (body.action === "run") return json({ ok: true, ...(await runBackup(admin, "manual")) });
    if (body.action === "list") return json({ items: await listBackups(admin) });
    if (body.action === "download") {
      if (typeof body.path !== "string" || !parseName(body.path)) return json({ error: "invalid_path" }, 400);
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(body.path, 60, { download: body.path });
      if (error) throw new Error(`다운로드 링크 실패: ${error.message}`);
      return json({ url: data.signedUrl });
    }
    return json({ error: "invalid_action" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "backup_failed" }, 500);
  }
});
