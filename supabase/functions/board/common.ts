// board 함수 공용 — 제한값, 입력 정리, 이미지·방송 시간 확인, 작성자 정보 불러오기.
import type { Admin } from "../_shared/db.ts";
import { OWNER_CHANNEL_ID } from "../_shared/config.ts";

export const BUCKET = "board-images";
export const PAGE_SIZE = 20;
export const REVIEW_REWARD = 100;
const REVIEW_WINDOW_MS = 12 * 60 * 60 * 1000;
export const MAX_TITLE = 60;
export const MAX_BODY = 5000;
export const MAX_COMMENT = 500;
export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
export const POST_COOLDOWN_MS = 30_000;
export const COMMENT_COOLDOWN_MS = 8_000;
export const REPORT_HIDE_THRESHOLD = 5;
export const REPORT_REASONS = new Set(["abuse", "spam", "obscene", "privacy", "etc"]);
export const MAX_REPORT_MEMO = 200;
export const REPORT_RATE_WINDOW_MS = 10 * 60 * 1000;
export const REPORT_RATE_MAX = 10;

// ---------- 게시판 활동 보상(0066_board_activity_rewards.sql) ----------
// 하루(한국 시간 밤 12시 기준) 게시글 1개·댓글 3개까지 쓸 때마다 포인트. 후기 글도 게시글 한도에 같이 셈(후기 보상 100P는 따로).
// 도배 방지: 공백 뺀 길이 최소(글 본문 20자·댓글 5자), 한두 글자 반복("ㅋㅋㅋㅋ")은 안 침, 같은 글에 단 댓글은 2개까지,
// 내 글에 단 내 댓글은 보상 없음. 그날 지우면 회수(지웠다 다시 써도 한도는 안 돌아옴), 신고 누적으로 숨겨지거나 관리자가 지우면 회수.
export const ACTIVITY = {
  post: { amount: 30, daily: 1, minLen: 20, label: "글" },
  comment: { amount: 10, daily: 3, minLen: 5, label: "댓글", perPost: 2 },
} as const;
export type ActivityKind = keyof typeof ACTIVITY;

export function imageUrl(path: string) {
  return `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${BUCKET}/${path}`;
}

// 치지직 live-detail(비공식) — 방송 중이면 openDate, 꺼졌으면 마지막 방송의 openDate/closeDate("YYYY-MM-DD HH:MM:SS" KST).
interface LiveWindow { isLive: boolean; openDate: string | null; closeDate: string | null }
let liveCache: { at: number; v: LiveWindow } | null = null;
async function getLiveWindow(): Promise<LiveWindow> {
  if (liveCache && Date.now() - liveCache.at < 15_000) return liveCache.v;
  let v: LiveWindow = { isLive: false, openDate: null, closeDate: null };
  try {
    const res = await fetch(`https://api.chzzk.naver.com/service/v2/channels/${OWNER_CHANNEL_ID}/live-detail`);
    if (res.ok) {
      const c = (await res.json())?.content;
      const isLive = c?.status === "OPEN";
      v = {
        isLive,
        openDate: typeof c?.openDate === "string" ? c.openDate : null,
        closeDate: !isLive && typeof c?.closeDate === "string" ? c.closeDate : null,
      };
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
  }
  liveCache = { at: Date.now(), v };
  return v;
}

// 후기 보상 대상 방송 키(= openDate). 방송 중이거나, 끝난 지 12시간 이내면 키를 돌려주고 아니면 null.
function eligibleBroadcastKey(w: LiveWindow): string | null {
  if (!w.openDate) return null;
  if (w.isLive) return w.openDate;
  if (!w.closeDate) return null;
  const closed = Date.parse(w.closeDate.replace(" ", "T") + "+09:00");
  if (Number.isNaN(closed)) return null;
  return Date.now() - closed <= REVIEW_WINDOW_MS ? w.openDate : null;
}

// 후기 보상 대상 방송 키. 1) 치지직이 지금 방송 중이라고 하면 그 방송, 2) 아니면 우리가 1분마다 남기는 방송 기록
// (broadcast_sessions, live-tracker 함수)의 마지막 방송이 아직 켜져 있거나 끝난 지 12시간 이내면 그 방송,
// 3) 기록이 없으면 예전처럼 치지직의 종료 시각으로 판단.
export async function reviewBroadcastKey(admin: Admin): Promise<{ key: string | null; isLive: boolean }> {
  const w = await getLiveWindow();
  if (w.isLive && w.openDate) return { key: w.openDate, isLive: true };
  const { data: s } = await admin
    .from("broadcast_sessions")
    .select("open_date, last_seen_live_at, closed_at")
    .order("last_seen_live_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (s) {
    const lastSeen = Date.parse(s.last_seen_live_at);
    if (!s.closed_at && Date.now() - lastSeen < 3 * 60 * 1000) return { key: s.open_date, isLive: true };
    const ended = Date.parse(s.closed_at ?? s.last_seen_live_at);
    if (Date.now() - ended <= REVIEW_WINDOW_MS) return { key: s.open_date, isLive: false };
    return { key: null, isLive: false };
  }
  return { key: eligibleBroadcastKey(w), isLive: false };
}

export function cleanText(v: unknown, max: number, min = 1): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\r\n/g, "\n").trim();
  return t.length >= min && t.length <= max ? t : null;
}

export function cleanImages(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_IMAGES) return null;
  for (const p of v) {
    if (typeof p !== "string" || !/^posts\/[0-9a-f-]{36}\.(jpg|jpeg|png|gif|webp)$/.test(p)) return null;
  }
  return v as string[];
}

// 호출 횟수 제한(0075_security_hardening.sql) — key별로 windowSec초 동안 max번까지. 넘으면 false
export async function allowed(admin: Admin, key: string, windowSec: number, max: number) {
  const { data, error } = await admin.rpc("rate_limit_hit", { p_key: key, p_window_sec: windowSec, p_max: max });
  if (error) {
    console.error(`rate_limit_hit 실패: ${error.message}`);
    return true; // 제한 기능이 고장 나도 게시판은 쓸 수 있게
  }
  // 가끔 하루 지난 기록 정리
  if (Math.random() < 0.01) await admin.from("rate_limits").delete().lt("window_start", new Date(Date.now() - 86400_000).toISOString());
  return data === true;
}

export function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

// 글에 붙이려는 사진이 전부 "내가 업로드 주소를 받은 사진"이고, 다른 글에 이미 붙어 있지 않은지 확인
// (남의 사진 경로를 내 글에 붙였다가 글을 지워서 남의 사진까지 지우는 걸 막음)
export async function ownsImages(admin: Admin, me: string, paths: string[], postId: number | null) {
  if (!paths.length) return true;
  const { data: mine } = await admin.from("board_uploads").select("path").eq("channel_id", me).in("path", paths);
  if ((mine ?? []).length !== new Set(paths).size) return false;
  const { data: used } = await admin.from("board_images").select("storage_path, post_id").in("storage_path", paths);
  return (used ?? []).every((u: { post_id: number }) => postId !== null && u.post_id === postId);
}

export async function getUser(admin: Admin, channelId: string) {
  const { data } = await admin.from("users").select("channel_id, channel_name, banned").eq("channel_id", channelId).maybeSingle();
  return data as { channel_id: string; channel_name: string | null; banned: boolean } | null;
}

export async function setImages(admin: Admin, postId: number, paths: string[]) {
  const { data: old } = await admin.from("board_images").select("storage_path").eq("post_id", postId);
  const keep = new Set(paths);
  const removed = (old ?? []).map((r: { storage_path: string }) => r.storage_path).filter((p: string) => !keep.has(p));
  await admin.from("board_images").delete().eq("post_id", postId);
  if (paths.length) {
    const { error } = await admin.from("board_images").insert(paths.map((p, i) => ({ post_id: postId, storage_path: p, sort_order: i })));
    if (error) throw new Error(`board_images insert 실패: ${error.message}`);
  }
  if (removed.length) await admin.storage.from(BUCKET).remove(removed);
}

interface Who { name: string | null; img: string | null; badge: { name: string; color: string | null } | null }

// 작성자 정보(닉네임 + 프로필 사진 + 장착 칭호). 후기 게시판, 스트리머(관리자) 계정 표시, 관리자의 자유게시판 작성자 확인용.
export async function loadWho(admin: Admin, cids: string[]): Promise<Map<string, Who>> {
  const m = new Map<string, Who>();
  if (!cids.length) return m;
  const { data: us } = await admin.from("users").select("channel_id, channel_name, profile_image_url, selected_title_id").in("channel_id", cids);
  const tids = [...new Set((us ?? []).map((u: any) => u.selected_title_id).filter(Boolean))];
  const titles = new Map<string, { name: string; color: string | null }>();
  if (tids.length) {
    const { data: ts } = await admin.from("titles").select("id, name, color").in("id", tids);
    for (const t of ts ?? []) titles.set(t.id, { name: t.name, color: t.color ?? null });
  }
  for (const u of us ?? []) {
    m.set(u.channel_id, {
      name: u.channel_name,
      img: u.profile_image_url ?? null,
      badge: u.selected_title_id ? titles.get(u.selected_title_id) ?? null : null,
    });
  }
  return m;
}

// "2026-09-26 21:00:03" → "9/26"
export function broadcastLabel(key: string | null): string | null {
  const m = key ? /^\d{4}-(\d{2})-(\d{2})/.exec(key) : null;
  return m ? `${Number(m[1])}/${Number(m[2])}` : null;
}

// 누구를 실명으로 보여줄지: 후기 게시판은 전원, 자유게시판은 스트리머(관리자) 계정만(관리자가 익명이면 의미가 없어서).
// 그 외 자유게시판 작성자는 익명이고, 관리자에게만 adminName으로 닉네임을 따로 알려줌.
export function whoToLoad(review: boolean, isAdmin: boolean, cids: string[]) {
  if (review || isAdmin) return cids;
  return cids.filter((c) => c === OWNER_CHANNEL_ID);
}

// 대기 중(resolution null)인 신고들을 처리 완료로 표시. { postId }면 그 글 + 그 글의 댓글 신고 전부, { type, id }면 그 대상만.
export async function closeReports(admin: Admin, target: { postId?: number; type?: string; id?: number }, resolution: string) {
  let q = admin.from("board_reports").update({ resolution, resolved_at: new Date().toISOString() }).is("resolution", null);
  if (target.postId) q = q.eq("post_id", target.postId);
  else q = q.eq("target_type", target.type!).eq("target_id", target.id!);
  const { error } = await q;
  if (error) console.error(`board_reports 정리 실패: ${error.message}`);
}
