// 미스테리 라디오 연속 투표 — 리모컨·방송화면용(바탕화면 obs/obs mystery radio의 remote.html, display.html).
// 이 두 파일은 내 PC의 로컬 파일이라(주소가 eugene4lpha.com이 아님) 다른 함수처럼 CORS를 사이트 주소로 묶을 수 없음
// → 대신 리모컨 키(x-remote-key 헤더)로만 인증. 키 원문은 DB에 없고 sha256 해시만 있음(mystery_remote_keys).
//
// GET  ?setId=                      → 이야기 1건 상태(정답·집계 포함). setId 없으면 가장 최근 이야기
// POST { action: "ensure", clientKey, title, isTest, questions: [{ position, prompt, options, answer }] }
//        → 대본을 불러올 때 회차를 만들어 둠(같은 clientKey면 기존 회차를 돌려줌. 아직 안 열었으면 문항도 갱신)
// POST { action: "open",   setId, position }  → 투표 열기(이미 열린 다른 투표는 마감)
// POST { action: "close",  setId, position }  → 투표 마감(첫 번째 투표를 마감하면 베팅도 마감)
// POST { action: "reveal", setId }            → 정답 공개(열린 투표가 있으면 마감)
// POST { action: "pay",    setId }            → 지급(테스트 회차는 기록만)
// POST { action: "cancel", setId }            → 취소(베팅 환불)
// POST { action: "delete", setId }            → 테스트 회차 삭제
// POST { action: "site", setId, hidden }      → 팬보드 투표 탭 카드 내리기(true)/다시 올리기(false)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

type Admin = ReturnType<typeof getAdminClient>;

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-remote-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, key);
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

class Bad extends Error {}
const bad = (code: string): never => {
  throw new Bad(code);
};

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authorized(admin: Admin, req: Request) {
  const key = req.headers.get("x-remote-key") ?? "";
  if (key.length < 20) return false;
  const { data } = await admin.from("mystery_remote_keys").select("key_hash").eq("key_hash", await sha256(key)).maybeSingle();
  return !!data;
}

async function loadSet(admin: Admin, setId: number | null) {
  let q = admin.from("mystery_sets").select("*");
  q = setId ? q.eq("id", setId) : q.order("created_at", { ascending: false }).limit(1);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`mystery_sets 조회 실패: ${error.message}`);
  return data;
}

// 리모컨·방송화면에 보여줄 전체 상태 — 정답, 항목별 표 수, 참여 인원, (공개 후) 맞힌 개수 분포
async function stateOf(admin: Admin, setId: number | null) {
  const s = await loadSet(admin, setId);
  if (!s) return { set: null };
  const { data: qs } = await admin.from("mystery_questions").select("id, position, prompt, options, answer, status").eq("set_id", s.id).order("position");
  const ids = (qs ?? []).map((q) => q.id);
  const [{ data: votes }, { data: bets }] = await Promise.all([
    ids.length ? admin.from("mystery_votes").select("question_id, channel_id, choice").in("question_id", ids) : Promise.resolve({ data: [] as { question_id: number; channel_id: string; choice: number }[] }),
    admin.from("mystery_bets").select("channel_id, amount").eq("set_id", s.id),
  ]);
  const answerOf = new Map((qs ?? []).map((q) => [q.id, q.answer]));
  const people = new Set<string>();
  const correctBy = new Map<string, number>();
  for (const v of votes ?? []) {
    people.add(v.channel_id);
    if (answerOf.get(v.question_id) === v.choice) correctBy.set(v.channel_id, (correctBy.get(v.channel_id) ?? 0) + 1);
  }
  for (const b of bets ?? []) people.add(b.channel_id);
  const questions = (qs ?? []).map((q) => {
    const counts = q.options.map(() => 0);
    for (const v of votes ?? []) if (v.question_id === q.id && v.choice >= 0 && v.choice < counts.length) counts[v.choice]++;
    const total = counts.reduce((a: number, b: number) => a + b, 0);
    return { id: q.id, position: q.position, prompt: q.prompt, options: q.options, answer: q.answer, status: q.status, counts, total, correctCount: counts[q.answer] ?? 0 };
  });
  const dist = new Array(questions.length + 1).fill(0);
  for (const p of people) dist[correctBy.get(p) ?? 0]++;
  return {
    set: {
      id: s.id, clientKey: s.client_key, title: s.title, status: s.status, isTest: s.is_test, betClosed: s.bet_closed, siteHidden: s.site_hidden,
      rewards: s.base_rewards, multipliers: s.bet_multipliers.map(Number),
      participants: people.size, bettors: (bets ?? []).length, betTotal: (bets ?? []).reduce((a, b) => a + b.amount, 0),
      correctDist: dist,
      questions,
      payLog: s.pay_log ? { count: s.pay_log.length, total: s.pay_log.reduce((a: number, r: Record<string, number>) => a + (r.base ?? 0) + (r.betPayout ?? 0), 0) } : null,
    },
  };
}

function parseQuestions(raw: unknown) {
  if (!Array.isArray(raw) || raw.length !== 3) bad("need_3_questions");
  const out = (raw as Record<string, unknown>[]).map((q) => {
    const position = Number(q.position);
    const prompt = String(q.prompt ?? "").trim();
    const options = Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : [];
    const answer = Number(q.answer);
    if (!Number.isInteger(position) || position < 1 || position > 9) bad("invalid_position");
    if (!prompt || prompt.length > 200) bad("invalid_prompt");
    if (options.length < 2 || options.length > 6 || options.some((o) => o.length > 80)) bad("invalid_options");
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) bad("invalid_answer");
    return { position, prompt, options, answer };
  });
  if (new Set(out.map((q) => q.position)).size !== out.length) bad("duplicate_position");
  return out.sort((a, b) => a.position - b.position);
}

async function act(admin: Admin, body: Record<string, unknown>) {
  const action = String(body.action ?? "");
  if (action === "ensure") {
    const clientKey = String(body.clientKey ?? "").trim().slice(0, 200);
    const title = String(body.title ?? "").trim().slice(0, 100);
    if (!clientKey || !title) bad("invalid_request");
    const isTest = body.isTest === true;
    const questions = parseQuestions(body.questions);
    const fullKey = `${clientKey}${isTest ? "#test" : ""}`;
    const { data: existing } = await admin.from("mystery_sets").select("id, status").eq("client_key", fullKey).maybeSingle();
    let setId: number;
    if (existing) {
      setId = existing.id;
      if (existing.status === "ready") {
        await admin.from("mystery_sets").update({ title }).eq("id", setId);
        await admin.from("mystery_questions").delete().eq("set_id", setId);
        const { error } = await admin.from("mystery_questions").insert(questions.map((q) => ({ ...q, set_id: setId })));
        if (error) throw new Error(`문항 저장 실패: ${error.message}`);
      }
    } else {
      const { data, error } = await admin.from("mystery_sets").insert({ client_key: fullKey, title, is_test: isTest }).select("id").single();
      if (error) throw new Error(`회차 생성 실패: ${error.message}`);
      setId = data.id;
      const { error: qErr } = await admin.from("mystery_questions").insert(questions.map((q) => ({ ...q, set_id: setId })));
      if (qErr) throw new Error(`문항 저장 실패: ${qErr.message}`);
    }
    return stateOf(admin, setId);
  }

  const setId = Number(body.setId);
  if (!Number.isInteger(setId)) bad("invalid_request");
  const s = await loadSet(admin, setId);
  if (!s) bad("set_not_found");

  if (action === "open" || action === "close") {
    const position = Number(body.position);
    const { data: q } = await admin.from("mystery_questions").select("id, status").eq("set_id", setId).eq("position", position).maybeSingle();
    if (!q) bad("question_not_found");
    if (action === "open") {
      if (!["ready", "open"].includes(s.status)) bad("set_not_open");
      if (q!.status === "pending") {
        const now = new Date().toISOString();
        // 다른 투표가 열려 있으면 먼저 마감(첫 번째 투표였다면 베팅도 마감)
        const { data: others } = await admin.from("mystery_questions").select("id, position").eq("set_id", setId).eq("status", "open");
        if (others?.length) await closeQuestions(admin, setId, others.map((o) => o.position));
        if (s.status === "ready") await admin.from("mystery_sets").update({ status: "open", opened_at: now }).eq("id", setId);
        await admin.from("mystery_questions").update({ status: "open", opened_at: now }).eq("id", q!.id);
      }
    } else if (q!.status === "open") {
      await closeQuestions(admin, setId, [position]);
    }
    return stateOf(admin, setId);
  }

  if (action === "reveal") {
    if (s.status !== "open") bad("set_not_open");
    const { data: opens } = await admin.from("mystery_questions").select("position").eq("set_id", setId).eq("status", "open");
    if (opens?.length) await closeQuestions(admin, setId, opens.map((o) => o.position));
    await admin.from("mystery_sets").update({ status: "revealed", revealed_at: new Date().toISOString(), bet_closed: true }).eq("id", setId);
    return stateOf(admin, setId);
  }

  if (action === "pay" || action === "cancel") {
    const { data, error } = await admin.rpc(action === "pay" ? "mystery_pay" : "mystery_cancel", { p_set_id: setId });
    if (error) throw new Error(`${action} 실패: ${error.message}`);
    if (data?.error) bad(String(data.error));
    return { ...(await stateOf(admin, setId)), result: data };
  }

  if (action === "site") {
    await admin.from("mystery_sets").update({ site_hidden: body.hidden === true }).eq("id", setId);
    return stateOf(admin, setId);
  }

  if (action === "delete") {
    if (!s.is_test) bad("not_test");
    await admin.from("mystery_sets").delete().eq("id", setId);
    return { set: null };
  }

  bad("invalid_request");
}

async function closeQuestions(admin: Admin, setId: number, positions: number[]) {
  const { data: first } = await admin.from("mystery_questions").select("position").eq("set_id", setId).order("position").limit(1).maybeSingle();
  await admin.from("mystery_questions").update({ status: "closed", closed_at: new Date().toISOString() }).eq("set_id", setId).in("position", positions).eq("status", "open");
  if (first && positions.includes(first.position)) await admin.from("mystery_sets").update({ bet_closed: true }).eq("id", setId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...cors, "Access-Control-Max-Age": "86400" } });
  if (!["GET", "POST"].includes(req.method)) return json({ error: "method_not_allowed" }, 405);
  try {
    const admin = getAdminClient();
    if (!(await authorized(admin, req))) return json({ error: "unauthorized" }, 401);
    if (req.method === "GET") {
      const id = new URL(req.url).searchParams.get("setId");
      return json(await stateOf(admin, id ? Number(id) : null), 200);
    }
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    return json(await act(admin, body), 200);
  } catch (err) {
    if (err instanceof Bad) return json({ error: err.message }, 400);
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "mystery_remote_failed" }, 500);
  }
});
