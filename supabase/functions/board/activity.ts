// board 함수 — 도배 방지, 글·댓글 활동 보상(지급·회수·현황).
import type { Admin } from "../_shared/db.ts";
import { json } from "../_shared/http.ts";
import { ACTIVITY, ActivityKind, allowed } from "./common.ts";

// 연속 작성 제한 — 마지막 글 시각을 읽고 비교하면 동시에 여러 개 보낼 때 다 통과돼서, DB에서 한 번에 세는 방식으로
export async function tooFast(admin: Admin, kind: string, me: string, ms: number) {
  return !(await allowed(admin, `board_${kind}:${me}`, Math.max(1, Math.round(ms / 1000)), 1));
}

function kstDate(ms = Date.now()) {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
}

// 보상받을 만한 글인지 — 공백 빼고 최소 길이 이상, 서로 다른 글자가 3종류 이상
function meaningful(text: string, minLen: number) {
  const t = text.replace(/\[\[사진:\d*\]\]/g, "").replace(/\s+/g, "");
  return t.length >= minLen && new Set(t).size >= 3;
}

export async function activityStatus(admin: Admin, me: string) {
  const { data } = await admin.from("board_activity_rewards").select("kind").eq("channel_id", me).eq("kst_date", kstDate());
  const used = { post: 0, comment: 0 };
  for (const r of data ?? []) used[r.kind as ActivityKind] += 1;
  return json({
    date: kstDate(),
    post: { used: used.post, max: ACTIVITY.post.daily, amount: ACTIVITY.post.amount, minLen: ACTIVITY.post.minLen },
    comment: { used: used.comment, max: ACTIVITY.comment.daily, amount: ACTIVITY.comment.amount, minLen: ACTIVITY.comment.minLen, perPost: ACTIVITY.comment.perPost },
  });
}

// 보상 지급 — 한도·조건을 보고 되면 기록 + 포인트. 지급한 포인트(안 되면 0)와 이유를 돌려줌.
export async function grantActivity(admin: Admin, me: string, kind: ActivityKind, targetId: number, text: string, postId: number | null, postOwner: string | null) {
  const cfg = ACTIVITY[kind];
  if (!meaningful(text, cfg.minLen)) return { amount: 0, reason: "too_short" };
  if (kind === "comment" && postOwner === me) return { amount: 0, reason: "own_post" };
  // 한도 확인 + 기록 + 포인트를 DB에서 한 사람씩 잠그고 한 번에(0075) — 동시에 여러 개 보내도 하루 한도를 못 넘음.
  // 지웠다 다시 써서 한도를 되살리지 못하게 회수된 것도 셈(DB 함수가 revoked 여부와 상관없이 셈)
  const { data, error } = await admin.rpc("board_grant_activity", {
    p_channel: me,
    p_kind: kind,
    p_target: targetId,
    p_post: postId,
    p_kst_date: kstDate(),
    p_amount: cfg.amount,
    p_daily: cfg.daily,
    p_per_post: kind === "comment" ? ACTIVITY.comment.perPost : null,
    p_reason: `게시판 활동 보상 (${cfg.label})`,
  });
  if (error) {
    console.error(`board_grant_activity 실패: ${error.message}`);
    return { amount: 0, reason: "error" };
  }
  const r = data as { reason: string; used?: number };
  if (r.reason !== "ok") return { amount: 0, reason: r.reason };
  return { amount: cfg.amount, reason: "ok", used: r.used, max: cfg.daily };
}

// 보상 회수 — 보상받은 글·댓글이 지워지거나(언제 지우든) 신고로 가려지면
export async function revokeActivity(admin: Admin, kind: ActivityKind, targetId: number) {
  const { data: row } = await admin.from("board_activity_rewards").select("id, channel_id, amount, kst_date, revoked").eq("kind", kind).eq("target_id", targetId).maybeSingle();
  if (!row || row.revoked) return 0;
  const { data: upd } = await admin.from("board_activity_rewards").update({ revoked: true }).eq("id", row.id).eq("revoked", false).select("id");
  if (!upd?.length) return 0; // 동시에 다른 곳에서 회수함
  const { error } = await admin.from("points_ledger").insert({ channel_id: row.channel_id, amount: -row.amount, reason: `게시판 활동 보상 회수 (${ACTIVITY[kind].label})` });
  if (error) console.error(`게시판 활동 보상 회수 실패: ${error.message}`);
  return row.amount;
}
