// 포인트 잔액 계산 — 기록 옆에 "잔액 N P"를 보여줄 때 씀(0071_ledger_balances.sql).
// POST { ids?: number[] }    → { byId: { [id]: 잔액 } }   포인트 기록 줄이 반영된 직후 잔액. 관리자는 아무 줄이나, 그 외엔 본인 줄만.
// POST { times?: string[] }  → { byTime: { [시각]: 잔액 } } 본인의 그 시각 잔액(미니게임 최근 기록용).
// 로그인 필수. 한 번에 최대 100개.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

const MAX = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  const pre = handleCors(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const session = await requireSession(req);
  if (!session) return json({ error: "unauthorized" }, 401);
  const me = session.channelId;
  const body = await req.json().catch(() => ({}));
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
    const admin = createClient(url, key);
    const out: { byId?: Record<string, number>; byTime?: Record<string, number> } = {};

    if (Array.isArray(body.ids) && body.ids.length) {
      const ids = body.ids.map(Number).filter((n: number) => Number.isSafeInteger(n) && n > 0).slice(0, MAX);
      // 본인 줄만 DB에서 계산(남의 기록 id를 잔뜩 넣어 무거운 계산을 시키지 못하게) — 관리자는 전체
      const { data, error } = await admin.rpc("ledger_balance_after", { p_ids: ids, p_channel: me === OWNER_CHANNEL_ID ? null : me });
      if (error) throw new Error(`ledger_balance_after 실패: ${error.message}`);
      out.byId = {};
      for (const r of (data ?? []) as { id: number; channel_id: string; balance_after: number }[]) {
        if (me === OWNER_CHANNEL_ID || r.channel_id === me) out.byId[String(r.id)] = Number(r.balance_after);
      }
    }

    if (Array.isArray(body.times) && body.times.length) {
      const times = body.times.filter((t: unknown) => typeof t === "string" && Number.isFinite(new Date(t).getTime())).slice(0, MAX);
      const { data, error } = await admin.rpc("ledger_balance_at", { p_channel: me, p_times: times });
      if (error) throw new Error(`ledger_balance_at 실패: ${error.message}`);
      out.byTime = {};
      // 받은 문자열 그대로 키로(화면이 자기 createdAt으로 찾게) — DB가 돌려주는 시각 표기는 달라질 수 있어서 순서로 맞춤
      const rows = (data ?? []) as { t: string; balance: number }[];
      times.forEach((t: string, i: number) => {
        if (rows[i]) out.byTime![t] = Number(rows[i].balance);
      });
    }
    return json(out);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "ledger_balance_failed" }, 500);
  }
});
