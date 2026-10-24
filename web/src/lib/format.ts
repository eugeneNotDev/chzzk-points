export const fmt = (n: number) => Number(n).toLocaleString("ko-KR");

// 한국 시간 기준 오늘 날짜 "YYYY-MM-DD"
export function kstToday(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(now);
}

export function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "방금 전";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  if (diff < 172_800_000) return "어제";
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}일 전`;
  return shortDate(iso);
}

// "10.14" 형태(한국 시간)
export function shortDate(iso: string) {
  const k = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  return `${String(k.getUTCMonth() + 1).padStart(2, "0")}.${String(k.getUTCDate()).padStart(2, "0")}`;
}

export function formatLeft(ms: number) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export const WEEK_KO = ["일", "월", "화", "수", "목", "금", "토"];

// 마지막 글자의 받침 번호(0 = 받침 없음, 8 = ㄹ). 한글 음절이 아니면 null.
export function lastJong(word: string): number | null {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c <= 11171 ? c % 28 : null;
}

// 받침에 따라 조사 고르기 — josa("공지사항", "을", "를") → "을". 한글이 아니면 "을(를)".
export function josa(word: string, withBatchim: string, without: string) {
  const jong = lastJong(word);
  if (jong === null) return `${withBatchim}(${without})`;
  return jong === 0 ? without : withBatchim;
}
