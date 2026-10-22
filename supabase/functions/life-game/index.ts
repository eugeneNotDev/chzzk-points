// 유진 키우기 v3 — 평행세계의 유진을 키우는 인생 게임. 로그인 필요.
// 인생 진행은 이 함수 안의 엔진(engine.ts + content.ts)이 하고, DB엔 판(life_lives)·도감(life_found)만 저장.
// 테스트 모드(life_settings.is_open = false)일 땐 주인 계정만, 판은 테스트 판(포인트 차감·하루 제한 없음).
//
// GET  ?view=lobby (기본) / ?view=dex / ?view=run&id=123(끝난 판 리포트)
// POST { action: "start", house }                          → 새 판 { run, balance }
// POST { action: "advance", runId, from, years, focus? }   → 결정이 생기거나 years만큼 진행 { run }
// POST { action: "choose", runId, key, from }              → 결정 고르기 { run, roll }
// POST { action: "focus", runId, focus, from }             → 올해의 초점 바꾸기(다음 해부터) { run }
// POST { action: "fund", runId, fund, from }               → 여유자금 굴리는 곳 바꾸기 { run }
// POST { action: "buy", runId, item, pay, from }           → 상점(pay: cash | points) { run, balance }
// POST { action: "reset" }                                 → 테스트 기록 초기화(테스트 모드에서만)
// from = 화면이 이미 가진 기록 줄 수. 응답의 run.log는 그 뒤로 새로 생긴 줄만.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";
import { advance, buy, choose, netWorth, setFocus, setFund, shopList, stageOf, startRun } from "./engine.ts";
import { DAILY, FOCUSES, FUNDS, HOUSES, ITEMS, JOBS, MODS, SPECIALS } from "./content.ts";
import type { Entry, HouseId, State, Stats } from "./types.ts";

const KNOWN_ERRORS = new Set([
  "not_open", "bad_house", "user_not_found", "in_progress", "daily_limit", "insufficient_balance", "no_pending", "bad_choice",
  "bad_item", "not_playing", "item_limit", "too_fast", "cant_afford", "points_only", "busy", "bad_focus", "bad_fund", "too_young",
  "has_pending",
]);

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const fail = (e: string) => json({ error: KNOWN_ERRORS.has(e) ? e : "life_failed" }, 400);

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, key);
}

type Row = {
  id: number; channel_id: string; world_no: number | null; is_test: boolean; house: string; spent: number; points_used: number;
  status: "playing" | "ended"; state: State; log: Entry[]; ver: number; title: string | null;
};
type Settings = { is_open: boolean; daily_limit: number; item_limit: number };

const houseName = (id: string) => HOUSES.find((h) => h.id === id)?.name ?? id;
const DEX_TOTAL = JOBS.length + MODS.length + DAILY.filter((d) => d.rare).length + SPECIALS.length;

// 화면에 보낼 판 모양
function view(r: Row, from: number, itemLimit: number) {
  const s = r.state;
  const nextStage = stageOf(s.age + 1);
  const focusNow = FOCUSES.find((f) => f.id === s.focus);
  return {
    id: r.id,
    worldNo: r.world_no,
    isTest: r.is_test,
    house: r.house,
    houseName: houseName(r.house),
    status: r.status,
    age: s.age,
    stats: s.stats,
    money: {
      cash: s.cash, invest: s.invest, fund: s.fund, debt: s.debt, assets: s.assets, net: netWorth(s), earned: s.earned, peak: s.peak,
      income: s.income, expense: s.expense, ret: s.ret,
    },
    job: s.job,
    jobName: JOBS.find((j) => j.id === s.job)?.name ?? null,
    salary: s.salary,
    school: s.school,
    edu: s.edu,
    fame: s.fame,
    biz: s.biz,
    army: s.army,
    focus: s.focus,
    focusName: focusNow?.name ?? null,
    focuses: FOCUSES.filter((f) => f.stage === nextStage).map((f) => ({ id: f.id, name: f.name, hint: f.hint })),
    people: s.people.filter((p) => p.alive || p.role === "mom" || p.role === "dad").map((p) => ({
      id: p.id, role: p.role, name: p.name, age: s.age - p.born, bond: p.bond, alive: p.alive,
    })),
    sick: s.sick,
    luck: s.luck,
    pending: r.status === "playing" ? s.pending : null,
    hist: s.hist,
    thoughts: s.thoughts,
    shop: r.status === "playing" ? shopList(s) : [],
    pointsUsed: r.points_used,
    pointsLimit: itemLimit,
    jobs: s.jobs,
    ending: s.ending,
    logFrom: Math.min(from, r.log.length),
    log: r.log.slice(Math.min(from, r.log.length)),
    logCount: r.log.length,
  };
}

async function loadPlaying(admin: SupabaseClient, channelId: string, runId: number): Promise<Row | null> {
  const { data, error } = await admin.from("life_lives").select("*").eq("id", runId).eq("channel_id", channelId).maybeSingle();
  if (error) throw new Error(`life_lives 조회 실패: ${error.message}`);
  return (data as Row | null) ?? null;
}

// 저장(ver가 같을 때만). 끝난 판이면 제목·도감도
async function save(admin: SupabaseClient, r: Row): Promise<boolean> {
  const s = r.state;
  const ended = !!s.dead;
  const patch: Record<string, unknown> = { state: s, log: r.log, ver: r.ver + 1, age: s.age };
  if (ended && r.status === "playing") {
    patch.status = "ended";
    patch.title = s.ending?.title ?? null;
    patch.special = !!s.ending?.specialId;
    patch.ended_at = new Date().toISOString();
  }
  const { data, error } = await admin.from("life_lives").update(patch).eq("id", r.id).eq("ver", r.ver).select("id");
  if (error) throw new Error(`life_lives 저장 실패: ${error.message}`);
  if (!data || data.length === 0) return false;
  r.ver += 1;
  if (ended && r.status === "playing") {
    r.status = "ended";
    r.title = s.ending?.title ?? null;
    const found: { kind: string; ref_id: string }[] = [];
    for (const j of s.jobs) found.push({ kind: "job", ref_id: j.id });
    if (s.ending?.modId) found.push({ kind: "mod", ref_id: s.ending.modId });
    if (s.ending?.specialId) found.push({ kind: "special", ref_id: s.ending.specialId });
    for (const f of s.flags) if (f.startsWith("dex_event_")) found.push({ kind: "event", ref_id: f.slice(10) });
    if (found.length) {
      const rows = found.map((x) => ({ ...x, channel_id: r.channel_id, is_test: r.is_test, first_life_id: r.id }));
      const { error: fErr } = await admin.from("life_found").upsert(rows, { onConflict: "channel_id,is_test,kind,ref_id", ignoreDuplicates: true });
      if (fErr) console.error("life_found 저장 실패", fErr.message);
    }
  }
  return true;
}

async function lobby(admin: SupabaseClient, channelId: string, test: boolean, st: Settings) {
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const [houses, user, playing, last, mine, usedToday, todayList, todayCount, found, maxNo] = await Promise.all([
    admin.from("life_houses").select("id, name, price, bonus").order("sort"),
    admin.from("users").select("balance").eq("channel_id", channelId).maybeSingle(),
    admin.from("life_lives").select("*").eq("channel_id", channelId).eq("status", "playing").maybeSingle(),
    admin.from("life_lives").select("id, title, world_no").eq("channel_id", channelId).eq("is_test", test).eq("status", "ended").order("ended_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("life_lives").select("id", { count: "exact", head: true }).eq("channel_id", channelId).eq("is_test", test).eq("status", "ended"),
    admin.from("life_lives").select("id", { count: "exact", head: true }).eq("channel_id", channelId).eq("is_test", false).eq("kst_date", today),
    admin.from("life_lives").select("id, world_no, title, age, special, channel_id").eq("is_test", test).eq("status", "ended").eq("kst_date", today).order("ended_at", { ascending: false }).limit(8),
    admin.from("life_lives").select("id", { count: "exact", head: true }).eq("is_test", test).eq("kst_date", today),
    admin.from("life_found").select("ref_id", { count: "exact", head: true }).eq("channel_id", channelId).eq("is_test", test),
    admin.from("life_lives").select("world_no").not("world_no", "is", null).order("world_no", { ascending: false }).limit(1).maybeSingle(),
  ]);
  for (const q of [houses, user, playing, last, todayList]) if (q.error) throw new Error(`lobby 조회 실패: ${q.error.message}`);
  const ids = [...new Set((todayList.data ?? []).map((t) => t.channel_id as string))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await admin.from("users").select("channel_id, channel_name, is_public").in("channel_id", ids);
    for (const u of data ?? []) if (u.is_public) names.set(u.channel_id, u.channel_name);
  }
  return {
    isOpen: st.is_open,
    isTest: test,
    dailyLimit: st.daily_limit,
    usedToday: usedToday.count ?? 0,
    itemLimit: st.item_limit,
    nextWorldNo: Number(maxNo.data?.world_no ?? 0) + 1,
    myRuns: mine.count ?? 0,
    balance: Number(user.data?.balance ?? 0),
    houses: (houses.data ?? []).map((h) => {
      const info = HOUSES.find((x) => x.id === h.id);
      const bonus = { ...(h.bonus as Record<string, number>) };
      delete bonus.wealth;
      return { id: h.id, name: h.name, price: h.price, bonus, allowance: info?.allowance ?? 0, inherit: info?.inherit ?? 0, tuition: info?.tuition ?? 0 };
    }),
    funds: FUNDS.map((f) => ({ id: f.id, name: f.name, hint: f.hint })),
    playing: playing.data ? view(playing.data as Row, 0, st.item_limit) : null,
    last: last.data ? { id: last.data.id, title: last.data.title, worldNo: last.data.world_no } : null,
    dex: { got: found.count ?? 0, total: DEX_TOTAL },
    today: (todayList.data ?? []).map((t) => ({ id: t.id, worldNo: t.world_no, title: t.title, age: t.age, special: t.special, channelName: names.get(t.channel_id) ?? null })),
    todayCount: todayCount.count ?? 0,
  };
}

async function dex(admin: SupabaseClient, channelId: string, test: boolean) {
  const { data, error } = await admin.from("life_found").select("kind, ref_id, first_at").eq("channel_id", channelId).eq("is_test", test);
  if (error) throw new Error(`life_found 조회 실패: ${error.message}`);
  const got = new Map((data ?? []).map((x) => [`${x.kind}:${x.ref_id}`, x.first_at as string]));
  const g = (k: string, id: string) => got.get(`${k}:${id}`) ?? null;
  return {
    jobs: JOBS.map((j) => ({ id: j.id, name: j.name, hint: j.hint, category: j.cat, gotAt: g("job", j.id) })),
    modifiers: MODS.map((m) => ({ id: m.id, name: m.text, hint: m.hint, gotAt: g("mod", m.id) })),
    events: DAILY.filter((d) => d.rare).map((d) => ({ id: d.id, name: typeof d.t === "string" ? d.t : d.id, hint: d.hint ?? null, gotAt: g("event", d.id) })),
    specials: SPECIALS.map((s) => ({ id: s.id, name: s.title, hint: s.hint, gotAt: g("special", s.id) })),
  };
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  const session = await requireSession(req);
  if (!session) return json({ error: "unauthorized" }, 401);

  try {
    const admin = getAdminClient();
    const { data: settings, error: sErr } = await admin.from("life_settings").select("is_open, daily_limit, item_limit").maybeSingle();
    if (sErr) throw new Error(`life_settings 조회 실패: ${sErr.message}`);
    const st = (settings ?? { is_open: false, daily_limit: 3, item_limit: 3 }) as Settings;
    const isOwner = session.channelId === OWNER_CHANNEL_ID;
    if (!st.is_open && !isOwner) return json({ error: "not_open" }, 403);
    const test = !st.is_open;
    const me = session.channelId;

    if (req.method === "GET") {
      const url = new URL(req.url);
      const v = url.searchParams.get("view") ?? "lobby";
      if (v === "dex") return json(await dex(admin, me, test), 200);
      if (v === "run") {
        const id = Number(url.searchParams.get("id"));
        if (!Number.isFinite(id) || id <= 0) return json({ error: "bad_request" }, 400);
        const r = await loadPlaying(admin, me, id);
        if (!r) return json({ error: "not_found" }, 404);
        return json(view(r, 0, st.item_limit), 200);
      }
      return json(await lobby(admin, me, test, st), 200);
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const { data: allowed } = await admin.rpc("rate_limit_hit", { p_key: `life:${me}`, p_window_sec: 10, p_max: 40 });
    if (allowed === false) return fail("too_fast");

    const from = Math.max(0, Math.floor(Number(body.from) || 0));
    const runId = Math.floor(Number(body.runId) || 0);

    if (body.action === "start") {
      const house = String(body.house ?? "") as HouseId;
      if (!HOUSES.some((h) => h.id === house)) return fail("bad_house");
      const { data: hrow } = await admin.from("life_houses").select("bonus").eq("id", house).maybeSingle();
      const bonus = { ...((hrow?.bonus ?? {}) as Partial<Stats> & { wealth?: number }) };
      delete bonus.wealth;
      const { s, log } = startRun(house, bonus);
      const { data, error } = await admin.rpc("life_begin", { p_channel_id: me, p_house: house, p_test: test, p_state: s, p_log: log });
      if (error) throw new Error(`life_begin 실패: ${error.message}`);
      if (data?.error) return fail(data.error);
      const r = await loadPlaying(admin, me, data.id);
      return json({ run: view(r!, 0, st.item_limit), balance: data.balance }, 200);
    }

    if (body.action === "reset") {
      if (!test) return json({ error: "bad_request" }, 400);
      const { count } = await admin.from("life_lives").delete({ count: "exact" }).eq("channel_id", me).eq("is_test", true);
      await admin.from("life_found").delete().eq("channel_id", me).eq("is_test", true);
      return json({ deletedRuns: count ?? 0 }, 200);
    }

    const r = await loadPlaying(admin, me, runId);
    if (!r || r.status !== "playing") return fail("not_playing");
    const s = r.state;

    if (body.action === "advance") {
      if (typeof body.focus === "string" && body.focus !== s.focus) setFocus(s, body.focus);
      if (!s.pending) advance(s, r.log, Math.max(1, Math.min(3, Math.floor(Number(body.years) || 1))));
      if (!(await save(admin, r))) return fail("busy");
      return json({ run: view(r, from, st.item_limit) }, 200);
    }
    if (body.action === "choose") {
      const res = choose(s, r.log, String(body.key ?? ""));
      if (res.error) return fail(res.error);
      if (!(await save(admin, r))) return fail("busy");
      return json({ run: view(r, from, st.item_limit), roll: res.roll ?? null }, 200);
    }
    if (body.action === "focus") {
      const res = setFocus(s, String(body.focus ?? ""));
      if (res.error) return fail(res.error);
      if (!(await save(admin, r))) return fail("busy");
      return json({ run: view(r, from, st.item_limit) }, 200);
    }
    if (body.action === "fund") {
      const res = setFund(s, String(body.fund ?? ""));
      if (res.error) return fail(res.error);
      if (!(await save(admin, r))) return fail("busy");
      return json({ run: view(r, from, st.item_limit) }, 200);
    }
    if (body.action === "buy") {
      const pay = body.pay === "points" ? "points" : "cash";
      const itemId = String(body.item ?? "");
      if (pay === "points" && r.points_used >= st.item_limit) return fail("item_limit");
      const ver = r.ver;
      const res = buy(s, r.log, itemId, pay);
      if (res.error) return fail(res.error);
      if (pay === "points") {
        const it = ITEMS.find((x) => x.id === itemId)!;
        s.pointsUsed = r.points_used + 1;
        const { data, error } = await admin.rpc("life_pay", {
          p_channel_id: me, p_life_id: r.id, p_ver: ver, p_amount: res.points ?? 0, p_reason: it.name, p_state: s, p_log: r.log,
        });
        if (error) throw new Error(`life_pay 실패: ${error.message}`);
        if (data?.error) return fail(data.error);
        r.ver += 1;
        r.points_used += 1;
        return json({ run: view(r, from, st.item_limit), balance: data.balance }, 200);
      }
      if (!(await save(admin, r))) return fail("busy");
      return json({ run: view(r, from, st.item_limit) }, 200);
    }
    return json({ error: "bad_request" }, 400);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "life_failed" }, 500);
  }
});

