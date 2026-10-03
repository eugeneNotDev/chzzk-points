// 방송 기록기 — Supabase 예약 작업(pg_cron, 0058_broadcast_sessions.sql)이 1분마다 호출함.
// 치지직 live-detail(비공식)을 보고 broadcast_sessions에 방송 시작/마지막으로 켜져 있던 시각/종료 시각을 남김.
// 후기 보상의 "방송 종료 후 6시간" 판정(board 함수)이 치지직 응답 하나에만 기대지 않게 하려는 용도.
//
// 누가 호출해도 같은 결과만 나오는(멱등) 기록 작업이라 인증은 없음. 대신 20초 안의 재호출은 치지직에 다시 묻지 않음.
// 응답: { ok, live, openDate, closeDate }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

let lastRunAt = 0;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// "2026-09-26 21:00:03"(KST) → ISO. 형식이 이상하면 null.
function kstToIso(s: unknown): string | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return null;
  const t = Date.parse(s.replace(" ", "T") + "+09:00");
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (Date.now() - lastRunAt < 20_000) return json({ ok: true, skipped: true });
  lastRunAt = Date.now();

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
    const admin = createClient(url, key);

    const res = await fetch(`https://api.chzzk.naver.com/service/v2/channels/${OWNER_CHANNEL_ID}/live-detail`);
    if (!res.ok) throw new Error(`live-detail ${res.status}`);
    const c = (await res.json())?.content;
    const live = c?.status === "OPEN";
    const openDate = typeof c?.openDate === "string" ? c.openDate : null;
    const nowIso = new Date().toISOString();

    if (live && openDate) {
      // 지금 방송 기록(없으면 새로 만들고, 있으면 마지막으로 켜져 있던 시각만 갱신)
      const { data: existing } = await admin.from("broadcast_sessions").select("open_date").eq("open_date", openDate).maybeSingle();
      if (existing) {
        await admin.from("broadcast_sessions")
          .update({ last_seen_live_at: nowIso, closed_at: null, title: c?.liveTitle ?? null })
          .eq("open_date", openDate);
      } else {
        await admin.from("broadcast_sessions").insert({
          open_date: openDate, title: c?.liveTitle ?? null,
          opened_at: kstToIso(openDate) ?? nowIso, first_seen_at: nowIso, last_seen_live_at: nowIso,
        });
      }
    }

    // 처음 켜기 전에 끝난 방송(기록이 없는 마지막 방송)은 치지직의 종료 시각으로 한 번 채워둠
    if (!live && openDate) {
      const closedIso = kstToIso(c?.closeDate);
      const { data: existing } = await admin.from("broadcast_sessions").select("open_date").eq("open_date", openDate).maybeSingle();
      if (!existing && closedIso) {
        const openedIso = kstToIso(openDate) ?? closedIso;
        await admin.from("broadcast_sessions").insert({
          open_date: openDate, title: c?.liveTitle ?? null, opened_at: openedIso,
          first_seen_at: nowIso, last_seen_live_at: closedIso, closed_at: closedIso,
        });
      }
    }

    // 끝난 방송 닫기: 지금 방송이 아닌데 아직 안 닫힌 기록 → 치지직의 종료 시각(같은 방송일 때) 또는 마지막으로 켜져 있던 시각
    const { data: open } = await admin.from("broadcast_sessions").select("open_date, last_seen_live_at").is("closed_at", null);
    for (const s of open ?? []) {
      if (live && s.open_date === openDate) continue;
      const fromChzzk = !live && s.open_date === openDate ? kstToIso(c?.closeDate) : null;
      await admin.from("broadcast_sessions").update({ closed_at: fromChzzk ?? s.last_seen_live_at }).eq("open_date", s.open_date);
    }
    return json({ ok: true, live, openDate, closeDate: typeof c?.closeDate === "string" ? c.closeDate : null });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ ok: false }, 500);
  }
});
