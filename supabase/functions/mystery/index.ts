// 미스테리 라디오 연속 투표 — 시청자용(투표 탭 카드). 진행(열기·마감·공개·지급)은 mystery-remote(리모컨) 쪽.
// 0096_mystery_votes.sql 참고.
//
// GET (로그인 필요) → 지금 보여줄 이야기 1건(진행 중이거나 방금 끝난 것, 리모컨에서 내린 건 제외) — 없으면 { set: null }
//   { set: { id, title, status: "open"|"revealed"|"paid", isTest, betOpen, rewards, multipliers,
//            questions: [{ id, position, prompt, options, status, counts, total, myChoice, answer(공개 후에만) }],
//              (아직 안 연 투표는 prompt=null, options=[] — 스포일러 방지)
//            myBet: { amount, payout } | null,
//            myResult: { correct, base, betPayout } | null  (정답 공개 후) } }
// POST { action: "vote", questionId, choice }  → 투표(마감 전까진 바꿀 수 있음)
// POST { action: "bet", setId, amount }        → 베팅(첫 투표 마감 전까지, 같은 이야기에 더 걸 수 있음)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireSession } from "../_shared/session.ts";

type Admin = ReturnType<typeof getAdminClient>;

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, key);
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// 지급 끝난 이야기는 30분, 정답만 공개된 이야기는 3시간까지 카드에 남김
const PAID_SHOW_MS = 30 * 60_000;
const REVEALED_SHOW_MS = 3 * 60 * 60_000;

type SetRow = {
  id: number; title: string; status: string; is_test: boolean; bet_closed: boolean;
  base_rewards: number[]; bet_multipliers: number[]; pay_log: Array<Record<string, unknown>> | null;
  revealed_at: string | null; paid_at: string | null;
};

async function activeSet(admin: Admin): Promise<SetRow | null> {
  const { data, error } = await admin
    .from("mystery_sets")
    .select("id, title, status, is_test, bet_closed, base_rewards, bet_multipliers, pay_log, revealed_at, paid_at")
    .in("status", ["open", "revealed", "paid"])
    .not("opened_at", "is", null)
    .eq("site_hidden", false)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`mystery_sets 조회 실패: ${error.message}`);
  if (!data) return null;
  const now = Date.now();
  if (data.status === "paid" && data.paid_at && now - new Date(data.paid_at).getTime() > PAID_SHOW_MS) return null;
  if (data.status === "revealed" && data.revealed_at && now - new Date(data.revealed_at).getTime() > REVEALED_SHOW_MS) return null;
  return data as SetRow;
}

async function buildView(admin: Admin, s: SetRow, me: string) {
  const { data: qs, error } = await admin
    .from("mystery_questions")
    .select("id, position, prompt, options, answer, status")
    .eq("set_id", s.id)
    .order("position");
  if (error) throw new Error(`mystery_questions 조회 실패: ${error.message}`);
  const ids = (qs ?? []).map((q) => q.id);
  const [{ data: votes, error: vErr }, { data: bet, error: bErr }] = await Promise.all([
    ids.length ? admin.from("mystery_votes").select("question_id, channel_id, choice").in("question_id", ids) : Promise.resolve({ data: [], error: null }),
    admin.from("mystery_bets").select("amount, payout").eq("set_id", s.id).eq("channel_id", me).maybeSingle(),
  ]);
  if (vErr) throw new Error(`mystery_votes 조회 실패: ${vErr.message}`);
  if (bErr) throw new Error(`mystery_bets 조회 실패: ${bErr.message}`);

  const revealed = s.status === "revealed" || s.status === "paid";
  let correct = 0;
  let votedAny = false;
  const questions = (qs ?? []).map((q) => {
    const counts = q.options.map(() => 0);
    let myChoice: number | null = null;
    for (const v of votes ?? []) {
      if (v.question_id !== q.id) continue;
      if (v.choice >= 0 && v.choice < counts.length) counts[v.choice]++;
      if (v.channel_id === me) myChoice = v.choice;
    }
    if (myChoice !== null) votedAny = true;
    if (revealed && myChoice === q.answer) correct++;
    const hidden = q.status === "pending"; // 아직 안 연 투표는 문항·보기를 안 내려줌(스포일러 방지)
    return {
      id: q.id,
      position: q.position,
      prompt: hidden ? null : q.prompt,
      options: hidden ? [] : q.options,
      status: q.status,
      counts: hidden ? [] : counts,
      total: counts.reduce((a: number, b: number) => a + b, 0),
      myChoice,
      answer: revealed ? q.answer : null,
    };
  });

  let myResult: { correct: number; base: number; betPayout: number | null } | null = null;
  if (revealed && (votedAny || bet)) {
    const logged = (s.pay_log ?? []).find((r) => r.channelId === me);
    const base = logged ? Number(logged.base) : s.base_rewards[correct] ?? 0;
    const betPayout = bet ? (logged ? Number(logged.betPayout) : Math.floor(bet.amount * Number(s.bet_multipliers[correct] ?? 0))) : null;
    myResult = { correct, base, betPayout };
  }

  return {
    id: s.id,
    title: s.title,
    status: s.status,
    isTest: s.is_test,
    betOpen: s.status === "open" && !s.bet_closed,
    rewards: s.base_rewards,
    multipliers: s.bet_multipliers.map(Number),
    questions,
    myBet: bet ? { amount: bet.amount, payout: bet.payout } : null,
    myResult,
  };
}

const KNOWN = ["question_not_found", "vote_closed", "invalid_choice", "amount_too_small", "set_not_found", "bet_closed", "insufficient_balance"];

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (!["GET", "POST"].includes(req.method)) return json({ error: "method_not_allowed" }, 405);

  const session = await requireSession(req);
  if (!session) return json({ error: "unauthorized" }, 401);

  try {
    const admin = getAdminClient();
    const { data: u } = await admin.from("users").select("banned").eq("channel_id", session.channelId).maybeSingle();
    if (u?.banned) return json({ error: "banned" }, 403);

    if (req.method === "GET") {
      const s = await activeSet(admin);
      return json({ set: s ? await buildView(admin, s, session.channelId) : null }, 200);
    }

    const { data: ok } = await admin.rpc("rate_limit_hit", { p_key: `mystery:${session.channelId}`, p_window_sec: 10, p_max: 30 });
    if (ok === false) return json({ error: "too_many_requests" }, 429);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    let res;
    if (body.action === "vote") {
      const questionId = Number(body.questionId);
      const choice = Number(body.choice);
      if (!Number.isInteger(questionId) || !Number.isInteger(choice)) return json({ error: "invalid_request" }, 400);
      res = await admin.rpc("mystery_cast_vote", { p_question_id: questionId, p_channel_id: session.channelId, p_choice: choice });
    } else if (body.action === "bet") {
      const setId = Number(body.setId);
      const amount = Number(body.amount);
      if (!Number.isInteger(setId) || !Number.isInteger(amount)) return json({ error: "invalid_request" }, 400);
      res = await admin.rpc("mystery_place_bet", { p_set_id: setId, p_channel_id: session.channelId, p_amount: amount });
    } else {
      return json({ error: "invalid_request" }, 400);
    }
    if (res.error) throw new Error(`mystery rpc 실패: ${res.error.message}`);
    const d = res.data as Record<string, unknown>;
    if (d?.error) {
      if (d.error === "user_not_found") return json({ error: "unauthorized" }, 401);
      return json({ error: KNOWN.includes(String(d.error)) ? d.error : "mystery_failed" }, 400);
    }
    return json(d, 200);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: "mystery_failed" }, 500);
  }
});
