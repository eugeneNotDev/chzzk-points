// 게시판(자유게시판/방송 후기) 화면 로직. board-free.html / board-review.html 이 initBoard(board)로 부름.
// 서버는 board Edge Function 하나(supabase/functions/board). 화면 전환(목록/글보기/글쓰기)은 주소를 안 바꾸고
// 이 안에서만 처리함 — spa-router가 popstate에 페이지를 다시 불러오기 때문.
import { supabase } from "./supabase-client.js";

const BOARD_URL = `${FUNCTIONS_BASE_URL}/board`;
const BUCKET = "board-images";
const MAX_IMAGES = 5;
const MAX_EDGE = 1600;

const CFG = {
  free: { name: "자유게시판", sub: "닉네임 없이 익명으로 남기는 공간이에요. 서로 배려해 주세요.", write: "글쓰기" },
  review: { name: "방송 후기", sub: "방송을 보고 느낀 점을 남겨주세요. 닉네임이 그대로 보여요.", write: "후기 쓰기" },
};

const ERR = {
  invalid_title: "제목은 1~60자로 입력해주세요.",
  invalid_body: "내용을 입력해주세요. (최대 5000자)",
  invalid_images: "이미지가 올바르지 않아요.",
  too_fast: "너무 빨라요. 잠시 후에 다시 시도해주세요.",
  already_reported: "이미 신고한 글이에요.",
  own_target: "내가 쓴 글은 신고할 수 없어요.",
  invalid_reason: "신고 사유를 골라주세요.",
  forbidden: "권한이 없어요.",
  not_found: "이미 삭제된 글이에요.",
  banned: "이용이 제한된 계정이에요.",
  unauthorized: "로그인이 필요해요.",
  unsupported_file_type: "지원하지 않는 이미지 형식이에요.",
  file_too_large: "이미지 용량이 너무 커요.",
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
async function call(payload) {
  const res = await authFetch(BOARD_URL, { method: "POST", body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || "board_failed");
    e.code = data.error;
    throw e;
  }
  return data;
}
function errText(e) { return ERR[e.code] || "처리하지 못했어요. 잠시 후 다시 시도해주세요."; }

function fmtTime(iso) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "방금 전";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  if (diff < 172_800_000) return "어제";
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}일 전`;
  const k = new Date(d.getTime() + 9 * 3_600_000);
  return `${k.getUTCFullYear()}.${k.getUTCMonth() + 1}.${k.getUTCDate()}`;
}
// N 표시: 올라온 지 1시간 이내 + 내가 아직 안 열어본 글만. 열어본 글 id는 이 브라우저에만 기억(최근 300개).
const SEEN_KEY = "chzzk_board_seen";
function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch { return new Set(); }
}
function markSeen(id) {
  try {
    const arr = [...loadSeen().add(id)].slice(-300);
    localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
  } catch { /* 저장 못 해도 N 표시만 계속 남을 뿐 */ }
}
// N 표시: 올라온 지 24시간 이내 + 이 브라우저에서 아직 안 열어본 글(내 글 제외).
const NEW_WINDOW_MS = 24 * 3_600_000;
const isNew = (iso, id, seen, mine) => !mine && Date.now() - new Date(iso).getTime() < NEW_WINDOW_MS && !seen.has(id);

// 본문 속 사진 자리 표시(글쓰기 편집칸이 저장할 때 넣음). n = 이 글 사진의 순서(1부터).
const IMG_MARK_RE = /\[\[사진:(\d+)\]\]/;
const IMG_MARK_RE_G = /\[\[사진:\d+\]\]/g;
function imgLinkHtml(i) {
  return `<a class="bd-inline-img" href="${esc(i.url)}" target="_blank" rel="noopener"><img src="${esc(i.url)}" alt="" loading="lazy"></a>`;
}
// 글 본문 + 사진: [[사진:n]] 자리에 그 사진, 표시가 없는 사진(예전 글 포함)은 맨 아래 묶음.
function bodyWithImagesHtml(body, images) {
  const parts = String(body).split(new RegExp(IMG_MARK_RE.source));
  const used = new Set();
  let html = "";
  parts.forEach((seg, i) => {
    if (i % 2 === 1) {
      const im = images[Number(seg) - 1];
      if (im && !used.has(Number(seg))) { used.add(Number(seg)); html += imgLinkHtml(im); }
      return;
    }
    const t = seg.replace(/^\n+/, "").replace(/\n+$/, "");
    if (t) html += `<div class="bd-body">${esc(t)}</div>`;
  });
  const rest = images.filter((_, i) => !used.has(i + 1));
  if (rest.length) html += `<div class="bd-images">${rest.map((i) => `<a href="${esc(i.url)}" target="_blank" rel="noopener"><img src="${esc(i.url)}" alt="" loading="lazy"></a>`).join("")}</div>`;
  return html;
}
const HEART_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.1 5 6.6 5c2.1 0 3.6 1.2 5.4 3.2C13.8 6.2 15.3 5 17.4 5c3.5 0 5.4 3.6 4.1 6.8C19.5 16.4 12 21 12 21z"/></svg>`;
const CM_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>`;
const IMG_ICON = `<svg class="bd-imgico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="사진 있음"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/></svg>`;

function whoHtml(name, badge, mine, staff) {
  const b = badge && typeof titleBadgeHtml === "function" ? `${titleBadgeHtml(badge.name, badge.color)} ` : "";
  // 스트리머 계정은 실명으로 보이는 유일한 계정이고 "스트리머" 칭호를 이미 달고 있어서 이름 뒤 뱃지는 따로 안 붙임
  void staff;
  return `<span class="who${mine ? " me" : ""}">${b}${esc(name)}</span>`;
}
// 댓글 아바타: 실명(후기 게시판/스트리머)은 프로필 사진, 익명은 "글쓴이"/"익1" 글자. 사진이 안 뜨면 첫 글자로.
// 댓글·답글 입력칸: Enter = 등록, Shift+Enter = 줄바꿈(한글 조합 중 Enter는 무시). 줄 수에 맞춰 높이가 늘어남.
// 좋아요(글·댓글) — 누르면 바로 바뀌고(낙관적), 서버 응답 개수로 맞춤. 내 글·댓글은 못 누름.
function bindLikes(root) {
  if (root.dataset.likeBound) return;
  root.dataset.likeBound = "1";
  root.addEventListener("click", async (e) => {
    const b = e.target.closest && e.target.closest("[data-like]");
    if (!b || b.disabled) return;
    if (!isLoggedIn()) { startLogin(); return; }
    if (b.classList.contains("own")) { b.classList.add("shake"); setTimeout(() => b.classList.remove("shake"), 400); return; }
    const n = b.querySelector(".n");
    const before = Number(n.textContent || 0);
    const on = !b.classList.contains("on");
    const isPost = b.dataset.like === "post";
    const show = (cnt) => { n.textContent = isPost ? String(cnt) : cnt ? String(cnt) : ""; };
    b.classList.toggle("on", on);
    show(Math.max(0, before + (on ? 1 : -1)));
    b.disabled = true;
    try {
      const r = await call({ action: "like", targetType: b.dataset.like, targetId: Number(b.dataset.id), on });
      b.classList.toggle("on", r.liked);
      show(r.count);
    } catch (err) {
      b.classList.toggle("on", !on);
      show(before);
      if (err.code !== "own_target") alert(errText(err));
    } finally {
      b.disabled = false;
    }
  });
}
function fitTextarea(ta) {
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight + 2, 160) + "px";
}
function bindCommentTextareas(root) {
  if (root.dataset.taBound) return;
  root.dataset.taBound = "1";
  root.addEventListener("keydown", (e) => {
    const ta = e.target.closest && e.target.closest("textarea.bd-ta");
    if (!ta || e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    const f = ta.closest("form");
    if (f) f.requestSubmit();
  });
  root.addEventListener("input", (e) => {
    const ta = e.target.closest && e.target.closest("textarea.bd-ta");
    if (ta) fitTextarea(ta);
  });
}
// 댓글 + 답글(한 단계). 서버가 id 순서로 평평하게 주면 원댓글(parentId 없음) 아래에 답글을 묶음.
function commentThreadsHtml(list) {
  const tops = list.filter((c) => !c.parentId);
  const kids = new Map();
  for (const c of list) if (c.parentId) { if (!kids.has(c.parentId)) kids.set(c.parentId, []); kids.get(c.parentId).push(c); }
  return tops.map((c, i) => {
    const rs = kids.get(c.id) || [];
    return `<div class="bd-thread" data-thread="${c.id}"${i === 0 ? ` style="border-top:0"` : ""}>
      ${commentHtml(c, c.id, false)}
      ${rs.length ? `<div class="bd-replies">${rs.map((r) => commentHtml(r, c.id, true)).join("")}</div>` : ""}
    </div>`;
  }).join("");
}
function commentHtml(c, parentId, isReply) {
  if (c.deleted) {
    return `<div class="bd-cm${isReply ? " bd-rp" : ""}"><div class="bd-av gone"></div><div class="bd-cm-main"><div class="t bd-gone">삭제된 댓글이에요</div></div></div>`;
  }
  const name = authorOf(c);
  const likeBtn = c.mine && !c.likeCount ? "" : `<button type="button" class="bd-clike${c.liked ? " on" : ""}${c.mine ? " own" : ""}" data-like="comment" data-id="${c.id}" aria-label="좋아요">${HEART_ICON}<span class="n">${c.likeCount ? c.likeCount : ""}</span></button>`;
  const replyBtn = c.hidden && !c.body ? "" : `<div class="bd-cm-act">${likeBtn}<button type="button" class="bd-reply-btn" data-parent="${parentId}" data-cid="${c.id}" data-name="${esc(name)}">답글 쓰기</button></div>`;
  return `<div class="bd-cm${isReply ? " bd-rp" : ""}" data-cmt="${c.id}">
    ${avatarHtml(c)}
    <div class="bd-cm-main">
      <div class="bd-meta">${whoHtml(name, c.badge, c.mine, c.staff)}<span class="dot">·</span><span>${fmtTime(c.createdAt)}</span>${admChip(c.adminName, c.author)}${adminHiddenChip(c)}${reportBtnHtml(c, "comment")}
        ${c.canDelete ? `<button type="button" class="bd-c-del" data-cid="${c.id}">삭제</button>` : ""}</div>
      ${c.hidden && !c.body ? `<div class="t">${veilHtml("댓글")}</div>` : `<div class="t">${c.replyTo ? `<span class="bd-at">@${esc(c.replyTo)}</span>` : ""}${esc(c.body)}</div>`}
      ${replyBtn}
    </div>
  </div>`;
}
function avatarHtml(c) {
  const fb = c.avatar ?? (c.author || "?").charAt(0);
  if (c.avatarImg) return `<div class="bd-av img${c.staff ? " staff" : ""}"><img src="${esc(c.avatarImg)}" alt="" referrerpolicy="no-referrer" data-fb="${esc(fb)}"></div>`;
  return `<div class="bd-av${c.op ? " op" : ""}">${esc(fb)}</div>`;
}
// ---------- 신고 (0057_board_reports.sql) ----------
const FLAG_ICON = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/></svg>`;
const VEIL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3 4.2M6.2 6.2A13 13 0 0 0 2 12c1 2.5 5 7 10 7a10 10 0 0 0 4.2-.9"/></svg>`;
const REPORT_REASONS = [["abuse", "욕설·비방"], ["spam", "도배·광고"], ["obscene", "음란·불쾌한 내용"], ["privacy", "개인정보 노출"], ["etc", "기타"]];
// 신고 버튼: 내 글·스트리머 글·관리자 화면에선 안 보임. 이미 신고했으면 "신고함".
function reportBtnHtml(x, type) {
  if (x.mine || x.staff || (typeof isAdmin === "function" && isAdmin())) return "";
  if (x.reported) return `<span class="bd-report-btn done">${FLAG_ICON} 신고함</span>`;
  return `<button type="button" class="bd-report-btn" data-report-type="${type}" data-report-id="${x.id}">${FLAG_ICON} 신고</button>`;
}
const veilHtml = (what) => `<span class="bd-hidden">${VEIL_ICON} 신고가 누적되어 가려진 ${what}이에요</span>`;
const adminHiddenChip = (x) => (x.hidden && typeof isAdmin === "function" && isAdmin() ? `<span class="adm-hidden-chip">자동 숨김 중</span>` : "");

function wireAvatarFallbacks(el) {
  el.querySelectorAll("img[data-fb]").forEach((img) => {
    img.addEventListener("error", () => { img.parentNode.textContent = img.dataset.fb; }, { once: true });
  });
}
// 관리자에게는 익명 대신 실제 닉네임을 보여주고, 일반 사용자에게 어떻게 보이는지만 작은 칩으로 알려줌.
const admChip = (name, shown) => (name ? `<span class="bd-adm">일반 사용자에겐 ${esc(shown)}</span>` : "");
const authorOf = (x) => x.adminName || x.author;
function chipsHtml(p) {
  return `${p.broadcast ? `<span class="bd-chip">${esc(p.broadcast)} 방송</span>` : ""}${p.paid ? `<span class="bd-paid">+100P</span>` : ""}`;
}

// 이미지를 긴 변 1600px 이하로 줄여서 JPEG로 저장(gif는 애니메이션 때문에 그대로).
async function shrinkImage(file) {
  if (file.type === "image/gif") return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.86));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally { URL.revokeObjectURL(url); }
}

export function initBoard(board) {
  const root = document.getElementById("board-root");
  if (!root) return;
  const cfg = CFG[board];
  let alive = true;
  let curPage = 0;
  let curView = "list";
  const PAGE_FILE = board === "free" ? "board-free.html" : "board-review.html";

  // 뒤로가기 지원: 글 보기/글쓰기로 들어갈 때 주소(?post=, ?write=)를 history에 쌓아서, 브라우저 뒤로가기가
  // 이전 페이지(랭킹 등)가 아니라 게시판 목록으로 돌아오게 함. 뒤로가기(popstate)가 오면 spa-router가 이
  // 페이지를 다시 실행하고, 아래 맨 끝의 초기 라우팅이 주소를 보고 알맞은 화면을 띄움.
  function setUrl(params, push, extra = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = PAGE_FILE + (qs ? `?${qs}` : "");
    const state = { spaPage: PAGE_FILE, ...extra };
    if (push) history.pushState(state, "", url);
    else history.replaceState(state, "", url);
  }
  const listParams = () => (curPage > 0 ? { page: String(curPage + 1) } : {});
  function openPost(id) { setUrl({ post: String(id) }, true, { fromBoard: true }); showPost(id); }
  // 게시판 안에서 쌓은 기록이면 브라우저 뒤로가기와 똑같이 돌아가고, 주소로 바로 들어온 경우엔 현재 기록을 목록으로 바꿈.
  function goBack(fallback) {
    if (history.state && history.state.fromBoard) history.back();
    else { setUrl(listParams(), false); fallback(); }
  }

  // ---------- 목록 ----------
  async function showList(page = curPage) {
    curPage = page;
    curView = "list";
    root.innerHTML = `
      <div class="bd-top"><h1 class="brand-heading">${cfg.name}</h1><button type="button" class="bd-write" id="bd-write-btn">${cfg.write}</button></div>
      <p class="bd-sub">${cfg.sub}</p>
      ${board === "review" ? `<div class="bd-banner" id="bd-banner" hidden></div>` : ""}
      <div class="bd-list" id="bd-list"><div class="bd-empty">불러오는 중...</div></div>
      <div class="bd-pager" id="bd-pager"></div>`;
    document.getElementById("bd-write-btn").addEventListener("click", () => {
      if (!isLoggedIn()) { startLogin(); return; }
      setUrl({ write: "1" }, true, { fromBoard: true });
      showEditor(null);
    });
    if (board === "review") loadBanner();
    const listEl = document.getElementById("bd-list");
    let data;
    try {
      data = await call({ action: "list", board, page });
    } catch (e) {
      if (listEl.isConnected) listEl.innerHTML = `<div class="bd-empty">글 목록을 불러오지 못했어요.</div>`;
      return;
    }
    if (!alive || !listEl.isConnected) return;
    const seen = loadSeen();
    if (!data.posts.length) {
      listEl.innerHTML = `<div class="bd-empty">아직 글이 없어요. 첫 글을 남겨보세요!</div>`;
    } else {
      listEl.innerHTML = data.posts.map((p) => p.hidden && !p.title ? `
        <a class="bd-item hidden-item" tabindex="0" role="button" data-id="${p.id}">
          <div class="bd-title">${veilHtml("글")}</div>
          <div class="bd-prev">운영자가 확인 중이에요.</div>
          <div class="bd-meta">${whoHtml(authorOf(p), p.badge, p.mine, p.staff)}<span class="dot">·</span><span>${fmtTime(p.createdAt)}</span><span class="cm">${CM_ICON} ${p.commentCount}</span></div>
        </a>` : `
        <a class="bd-item" tabindex="0" role="button" data-id="${p.id}">
          <div class="bd-title"><span class="tt">${esc(p.title)}</span>${p.hasImages ? IMG_ICON : ""}${isNew(p.createdAt, p.id, seen, p.mine) ? `<span class="new">N</span>` : ""}${chipsHtml(p)}${adminHiddenChip(p)}</div>
          <div class="bd-prev">${esc(String(p.preview || "").replace(/\[\[사진:\d*\]?\]?/g, " ").replace(/\[\[[^\]]*$/, "").replace(/\s+/g, " ").trim())}</div>
          <div class="bd-meta">${whoHtml(authorOf(p), p.badge, p.mine, p.staff)}<span class="dot">·</span><span>${fmtTime(p.createdAt)}</span>${admChip(p.adminName, p.author)}${p.likeCount ? `<span class="lk">${HEART_ICON} ${p.likeCount}</span>` : ""}<span class="cm">${CM_ICON} ${p.commentCount}</span></div>
        </a>`).join("");
    }
    renderPager(data.total, data.pageSize);
  }

  function renderPager(total, size) {
    const el = document.getElementById("bd-pager");
    const pages = Math.max(1, Math.ceil(total / size));
    if (!el || pages <= 1) { if (el) el.innerHTML = ""; return; }
    const start = Math.max(0, Math.min(curPage - 2, pages - 5));
    const end = Math.min(pages, start + 5);
    let h = `<button type="button" data-pg="${curPage - 1}" ${curPage === 0 ? "disabled" : ""}>‹</button>`;
    for (let i = start; i < end; i++) h += `<button type="button" data-pg="${i}" class="${i === curPage ? "on" : ""}">${i + 1}</button>`;
    h += `<button type="button" data-pg="${curPage + 1}" ${curPage >= pages - 1 ? "disabled" : ""}>›</button>`;
    el.innerHTML = h;
  }

  async function loadBanner() {
    try {
      const s = await call({ action: "review-status" });
      const el = document.getElementById("bd-banner");
      if (!el || !alive) return;
      let title, sub, dim = false;
      if (s.eligible && !s.alreadyRewarded) {
        title = `${s.isLive ? "지금 방송 중!" : "이번 방송"} 후기를 남기면 ${s.reward}P!`;
        sub = "방송 중이거나 종료 후 6시간 안에, 방송마다 첫 후기 한 번만 지급돼요.";
      } else if (s.eligible) {
        title = "이번 방송 후기 보상은 이미 받았어요";
        sub = "다음 방송 때 첫 후기를 남기면 또 받을 수 있어요.";
        dim = true;
      } else {
        title = `방송 후기를 남기면 ${s.reward}P!`;
        sub = "방송 중이거나 종료 후 6시간 안에, 방송마다 첫 후기 한 번만 지급돼요.";
        dim = true;
      }
      el.className = `bd-banner${dim ? " dim" : ""}`;
      el.innerHTML = `<div class="ic">+${s.reward}</div><div><b>${title}</b><span>${sub}</span></div>`;
      el.hidden = false;
    } catch { /* 배너는 없어도 됨 */ }
  }

  // ---------- 글 보기 ----------
  // soft: 댓글 등록·삭제 뒤 다시 그릴 때 — "불러오는 중" 화면 없이 바꿔치기하고 스크롤 위치 유지(focus = 새 댓글로 이동).
  async function showPost(id, { thenEdit = false, soft = false, focus = null } = {}) {
    curView = "post";
    const keepY = soft ? window.scrollY : null;
    if (!soft) root.innerHTML = `<div class="bd-top"><h1 class="brand-heading">${cfg.name}</h1></div><div class="bd-post"><div class="bd-empty">불러오는 중...</div></div>`;
    let data;
    try {
      data = await call({ action: "get", id });
    } catch (e) {
      root.innerHTML = `<div class="bd-top"><h1 class="brand-heading">${cfg.name}</h1><button type="button" class="bd-write secondary" id="bd-back">목록</button></div><div class="bd-post"><div class="bd-empty">${e.code === "not_found" ? "삭제됐거나 없는 글이에요." : "글을 불러오지 못했어요."}</div></div>`;
      document.getElementById("bd-back").addEventListener("click", () => goBack(() => showList()));
      return;
    }
    if (!alive) return;
    markSeen(id);
    const p = data.post;
    if (thenEdit && p.mine) { showEditor({ post: p, images: data.images }); return; }
    const review = board === "review";
    root.innerHTML = `
      <div class="bd-top"><h1 class="brand-heading">${cfg.name}</h1><button type="button" class="bd-write secondary" id="bd-back">목록</button></div>
      <div class="bd-post">
        <div class="bd-meta" style="margin-bottom:10px">${p.avatarImg ? `<img class="bd-mini-av" src="${esc(p.avatarImg)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}${whoHtml(authorOf(p), p.badge, p.mine, p.staff)}<span class="dot">·</span><span>${fmtTime(p.createdAt)}${p.updatedAt !== p.createdAt ? " · 수정됨" : ""}</span>${admChip(p.adminName, p.author)}${adminHiddenChip(p)}${reportBtnHtml(p, "post")}</div>
        ${p.hidden && !p.title ? `<div class="bd-body">${veilHtml("글")}</div>` : `
        <h2><span class="tt">${esc(p.title)}</span>${review ? `<span class="bd-chips">${chipsHtml(p)}</span>` : ""}</h2>
        ${bodyWithImagesHtml(p.body, data.images)}`}
        ${p.hidden && !p.title ? "" : `<div class="bd-like-row"><button type="button" class="bd-like${p.liked ? " on" : ""}${p.mine ? " own" : ""}" data-like="post" data-id="${p.id}"${p.mine ? ` title="내 글에는 좋아요를 누를 수 없어요"` : ""}>${HEART_ICON}<span>좋아요</span><span class="n">${p.likeCount || 0}</span></button></div>`}
        ${p.mine || p.canDelete ? `<div class="bd-actions">
          ${p.mine ? `<button type="button" class="secondary" id="bd-edit">수정</button>` : ""}
          ${p.canDelete ? `<button type="button" class="secondary danger" id="bd-del">삭제</button>` : ""}
        </div>` : ""}
      </div>
      <div class="bd-post">
        <div class="bd-cm-h">댓글 ${data.comments.filter((c) => !c.deleted).length}</div>
        <div id="bd-clist">${commentThreadsHtml(data.comments)}</div>
        <form class="bd-form" id="bd-cform">
          <textarea id="bd-cinput" class="notice-title-input bd-ta" rows="1" maxlength="500" placeholder="${!isLoggedIn() ? "로그인하면 댓글을 쓸 수 있어요" : review ? "댓글 남기기" : isAdmin() ? "댓글 남기기 (스트리머 계정은 닉네임으로 보여요)" : "익명으로 댓글 남기기"}" ${isLoggedIn() ? "" : "disabled"}></textarea>
          <button type="submit">${isLoggedIn() ? "등록" : "로그인"}</button>
        </form>
        ${review ? "" : `<div class="bd-note">같은 글 안에서는 같은 사람이 같은 익명 번호로 보여요.</div>`}
        <div class="bd-note" id="bd-cstatus"></div>
      </div>`;
    document.getElementById("bd-back").addEventListener("click", () => goBack(() => showList()));
    wireAvatarFallbacks(root);
    root.querySelectorAll("[data-report-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!isLoggedIn()) { startLogin(); return; }
        const type = btn.dataset.reportType;
        const tid = Number(btn.dataset.reportId);
        const preview = type === "post" ? p.title : (data.comments.find((c) => c.id === tid)?.body ?? "");
        openReportModal(type, tid, preview, () => showPost(p.id));
      });
    });
    const editBtn = document.getElementById("bd-edit");
    if (editBtn) editBtn.addEventListener("click", () => {
      setUrl({ post: String(p.id), edit: "1" }, true, { fromBoard: true });
      showEditor({ post: p, images: data.images });
    });
    const delBtn = document.getElementById("bd-del");
    if (delBtn) delBtn.addEventListener("click", async () => {
      const warn = review ? "이 후기를 삭제할까요?\n보상으로 받은 100P가 있다면 함께 회수돼요." : "이 글을 삭제할까요?";
      if (!confirm(warn)) return;
      delBtn.disabled = true;
      try {
        const r = await call({ action: "delete", id: p.id });
        if (r.revoked) { alert(`삭제했어요. 보상 ${r.revoked}P가 회수됐어요.`); refreshPoints(); }
        goBack(() => showList());
      } catch (e) { delBtn.disabled = false; alert(errText(e)); }
    });
    const statusEl = document.getElementById("bd-cstatus");
    document.getElementById("bd-cform").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!isLoggedIn()) { startLogin(); return; }
      const input = document.getElementById("bd-cinput");
      const text = input.value.trim();
      if (!text) return;
      const btn = e.target.querySelector("button");
      btn.disabled = true;
      try { const r = await call({ action: "comment", postId: p.id, body: text }); showPost(p.id, { soft: true, focus: r.id }); }
      catch (err) { btn.disabled = false; statusEl.textContent = errText(err); statusEl.style.color = "#ff8f8f"; }
    });
    bindCommentTextareas(root);
    const clist = document.getElementById("bd-clist");
    clist.addEventListener("click", async (e) => {
      const rb = e.target.closest(".bd-reply-btn");
      if (rb) { toggleReplyForm(rb); return; }
      if (e.target.closest(".bd-rcancel")) { closeReplyForm(); return; }
      const b = e.target.closest(".bd-c-del");
      if (!b || !confirm("댓글을 삭제할까요?")) return;
      try { await call({ action: "delete-comment", id: Number(b.dataset.cid) }); showPost(p.id, { soft: true }); }
      catch (err) { alert(errText(err)); }
    });
    clist.addEventListener("submit", async (e) => {
      const f = e.target.closest(".bd-rform");
      if (!f) return;
      e.preventDefault();
      const input = f.querySelector("textarea");
      const text = input.value.trim();
      if (!text) return;
      const btn = f.querySelector("button[type=submit]");
      btn.disabled = true;
      try { const r = await call({ action: "comment", postId: p.id, body: text, parentId: Number(f.dataset.parent), replyToId: Number(f.dataset.replyTo) }); showPost(p.id, { soft: true, focus: r.id }); }
      catch (err) { btn.disabled = false; const st = f.nextElementSibling; if (st && st.classList.contains("bd-rstatus")) { st.textContent = errText(err); } }
    });
    bindLikes(root);
    if (soft) {
      window.scrollTo(0, keepY);
      const el = focus ? root.querySelector(`[data-cmt="${focus}"]`) : null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.top < 70 || r.bottom > window.innerHeight - 20) el.scrollIntoView({ block: "center" });
        el.classList.add("bd-flash");
        setTimeout(() => el.classList.remove("bd-flash"), 1600);
      }
    }
    // 답글 입력칸 — 한 번에 하나만 열림. 원댓글 묶음 맨 아래(답글들 다음)에 붙음.
    function closeReplyForm() {
      clist.querySelectorAll(".bd-rwrap").forEach((w) => w.remove());
      clist.querySelectorAll(".bd-reply-btn.on").forEach((x) => x.classList.remove("on"));
    }
    function toggleReplyForm(rb) {
      const was = rb.classList.contains("on");
      closeReplyForm();
      if (was) return;
      if (!isLoggedIn()) { startLogin(); return; }
      rb.classList.add("on");
      const parent = rb.dataset.parent;
      const thread = clist.querySelector(`.bd-thread[data-thread="${parent}"]`);
      const wrap = document.createElement("div");
      wrap.className = "bd-rwrap";
      const to = rb.dataset.name;
      wrap.innerHTML = `<div class="bd-rto">↳ <b>${esc(to)}</b>님에게 답글</div>
        <form class="bd-rform" data-parent="${parent}" data-reply-to="${rb.dataset.cid}">
          <textarea class="notice-title-input bd-ta" rows="1" maxlength="500" placeholder="${board === "review" || isAdmin() ? "답글 남기기" : "익명으로 답글 남기기"}"></textarea>
          <button type="button" class="secondary bd-rcancel">취소</button><button type="submit">등록</button>
        </form><div class="bd-note bd-rstatus"></div>`;
      thread.appendChild(wrap);
      wrap.querySelector("textarea").focus();
    }
  }

  // ---------- 신고 창 ----------
  function openReportModal(type, targetId, preview, done) {
    let dlg = document.getElementById("bd-report-modal");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "bd-report-modal";
      dlg.className = "rp-modal";
      document.body.appendChild(dlg);
    }
    const what = type === "post" ? "글" : "댓글";
    dlg.innerHTML = `
      <h3>${what} 신고하기</h3>
      <p class="rp-sub">신고한 사람은 다른 사람에게 보이지 않아요.</p>
      <div class="rp-target">${esc(preview || "")}</div>
      <div class="rp-reasons">${REPORT_REASONS.map(([v, label]) => `<label><input type="radio" name="bd-rp-reason" value="${v}"> ${label}</label>`).join("")}</div>
      <textarea class="notice-title-input rp-memo" id="bd-rp-memo" rows="2" maxlength="200" placeholder="자세한 내용 (선택, 최대 200자)"></textarea>
      <p class="rp-note">서로 다른 5명이 신고한 ${what}은 운영자가 확인하기 전까지 자동으로 가려져요. 장난 신고는 이용 제한될 수 있어요.</p>
      <p class="rp-note" id="bd-rp-status"></p>
      <div class="rp-actions"><button type="button" class="secondary" id="bd-rp-cancel">취소</button><button type="button" class="rp-submit" id="bd-rp-submit">신고하기</button></div>`;
    const labels = Array.from(dlg.querySelectorAll(".rp-reasons label"));
    const statusEl = dlg.querySelector("#bd-rp-status");
    labels.forEach((l) => l.querySelector("input").addEventListener("change", () => {
      labels.forEach((x) => x.classList.toggle("on", x.querySelector("input").checked));
      statusEl.textContent = "";
    }));
    dlg.querySelector("#bd-rp-cancel").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    const submit = dlg.querySelector("#bd-rp-submit");
    submit.addEventListener("click", async () => {
      const reason = dlg.querySelector('input[name="bd-rp-reason"]:checked')?.value;
      if (!reason) { statusEl.textContent = "신고 사유를 골라주세요."; statusEl.style.color = "var(--red-text)"; return; }
      submit.disabled = true;
      try {
        const r = await call({ action: "report", targetType: type, targetId, reason, memo: dlg.querySelector("#bd-rp-memo").value });
        dlg.close();
        alert(r.hidden ? `신고했어요. 신고가 누적되어 이 ${what}은 가려졌어요.` : "신고했어요. 운영자가 확인할게요.");
        done();
      } catch (e) {
        submit.disabled = false;
        statusEl.textContent = errText(e);
        statusEl.style.color = "var(--red-text)";
        if (e.code === "already_reported") done();
      }
    });
    dlg.showModal();
  }

  // ---------- 글쓰기 / 수정 ----------
  function showEditor(existing) {
    const editing = !!existing;
    curView = "editor";
    // 이미지 항목: {key, path?, url, file?} — 기존(path 있음) / 새로 고른 것(file 있음). 본문 편집칸 안에 사진이 바로 보이고,
    // 저장할 때 편집칸을 "글 + [[사진:n]] 표시"로 바꿔서 보냄(n = 저장되는 사진 순서). 표시 없는 사진은 글 맨 아래.
    let keySeq = 0;
    const imgs = editing ? existing.images.map((i) => ({ key: ++keySeq, path: i.path, url: i.url })) : [];
    root.innerHTML = `
      <div class="bd-top"><h1 class="brand-heading">${cfg.name}</h1><button type="button" class="bd-write secondary" id="bd-back">${editing ? "취소" : "목록"}</button></div>
      <p class="bd-sub">${editing ? "글을 수정해요." : board === "free" && isAdmin() ? "스트리머 계정으로 쓴 글은 익명이 아니라 닉네임으로 보여요." : cfg.sub}</p>
      ${!editing && board === "review" ? `<div class="bd-banner" id="bd-banner" hidden></div>` : ""}
      <div class="bd-post bd-editor">
        <input type="text" id="bd-title" class="notice-title-input" maxlength="60" placeholder="제목 (최대 60자)" value="${editing ? esc(existing.post.title) : ""}">
        <div id="bd-body" class="notice-title-input bd-body-input bd-rich" contenteditable="true" role="textbox" aria-multiline="true" data-ph="내용을 입력하세요 (최대 5000자)"></div>
        <div class="bd-ed-tools"><button type="button" class="bd-add-img" id="bd-add-img">${IMG_ICON}<span id="bd-img-count">사진 0/${MAX_IMAGES}</span></button><span class="bd-ed-hint">사진은 글 쓰던 자리에 들어가요</span></div>
        <input type="file" id="bd-file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden>
        <p class="bd-note" id="bd-status"></p>
        <div class="bd-editor-actions"><button type="button" class="secondary" id="bd-cancel">취소</button><button type="button" id="bd-save">${editing ? "수정 완료" : "등록"}</button></div>
      </div>`;
    if (!editing && board === "review") loadBanner();
    const statusEl = document.getElementById("bd-status");
    const ed = document.getElementById("bd-body");
    const setStatus = (t, err = false) => { statusEl.textContent = t; statusEl.style.color = err ? "#ff8f8f" : ""; };
    const figHtml = (im) => `<figure class="bd-ed-img" contenteditable="false" data-k="${im.key}"><img src="${esc(im.url)}" alt=""><button type="button" class="bd-ed-rm" aria-label="사진 빼기">×</button></figure>`;
    const lineHtml = (t) => `<div>${t ? esc(t) : "<br>"}</div>`;

    // 기존 글 불러오기: [[사진:n]] 자리에 사진, 표시 없는 사진은 맨 아래.
    if (editing) {
      const used = new Set();
      const parts = String(existing.post.body).split(IMG_MARK_RE);
      let html = "";
      parts.forEach((seg, i) => {
        if (i % 2 === 1) {
          const im = imgs[Number(seg) - 1];
          if (im && !used.has(im.key)) { used.add(im.key); html += figHtml(im); }
          return;
        }
        const lines = seg.replace(/^\n/, "").replace(/\n$/, "").split("\n");
        if (seg.length) html += lines.map(lineHtml).join("");
      });
      for (const im of imgs) if (!used.has(im.key)) html += figHtml(im);
      ed.innerHTML = html || lineHtml("");
    } else {
      ed.innerHTML = lineHtml("");
    }

    const countImgs = () => ed.querySelectorAll("figure.bd-ed-img").length;
    const updateCount = () => {
      const n = countImgs();
      document.getElementById("bd-img-count").textContent = `사진 ${n}/${MAX_IMAGES}`;
      document.getElementById("bd-add-img").disabled = n >= MAX_IMAGES;
      ed.classList.toggle("empty", !ed.textContent.trim() && n === 0);
    };
    updateCount();

    // 마지막 커서 위치 기억 — 사진 버튼을 누르면 편집칸 포커스가 빠지므로.
    let savedRange = null;
    const remember = () => {
      const sel = window.getSelection();
      if (sel.rangeCount && ed.contains(sel.getRangeAt(0).commonAncestorContainer)) savedRange = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", remember);
    ed.addEventListener("input", updateCount);
    // 붙여넣기는 글자만(서식·외부 이미지 차단). 사진 파일을 붙여넣으면 사진으로 넣어줌.
    ed.addEventListener("paste", (e) => {
      e.preventDefault();
      const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
      if (files.length) { addFiles(files); return; }
      const text = (e.clipboardData?.getData("text/plain") || "").replace(/\r\n/g, "\n");
      document.execCommand("insertText", false, text);
    });
    ed.addEventListener("drop", (e) => {
      const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith("image/"));
      e.preventDefault();
      if (files.length) addFiles(files);
    });
    ed.addEventListener("click", (e) => {
      const rm = e.target.closest(".bd-ed-rm");
      if (!rm) return;
      const fig = rm.closest("figure");
      const im = imgs.find((x) => x.key === Number(fig.dataset.k));
      if (im && im.file) URL.revokeObjectURL(im.url);
      fig.remove();
      updateCount();
    });

    function insertFigures(list) {
      const frag = document.createDocumentFragment();
      for (const im of list) {
        const t = document.createElement("template");
        t.innerHTML = figHtml(im);
        frag.appendChild(t.content.firstChild);
      }
      const after = document.createElement("div");
      after.innerHTML = "<br>";
      frag.appendChild(after);
      // 커서가 있던 줄 바로 아래에 넣음(줄 중간이면 그 줄 뒤). 커서 기록이 없으면 맨 끝.
      let block = null;
      if (savedRange && ed.contains(savedRange.startContainer)) {
        block = savedRange.startContainer;
        while (block && block.parentNode !== ed) block = block.parentNode;
      }
      if (block && block !== ed) {
        // 빈 줄이면 그 줄을 사진으로 바꿔치기
        if (block.nodeName === "DIV" && !block.textContent.trim() && !block.querySelector("figure")) block.replaceWith(frag);
        else block.after(frag);
      } else {
        ed.appendChild(frag);
      }
      const r = document.createRange();
      r.setStart(after, 0);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      savedRange = r.cloneRange();
      updateCount();
    }
    function addFiles(files) {
      const room = MAX_IMAGES - countImgs();
      const added = [];
      for (const f of files) {
        if (added.length >= room) { setStatus(`사진은 최대 ${MAX_IMAGES}장까지 올릴 수 있어요.`, true); break; }
        if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) { setStatus("jpg, png, gif, webp 이미지만 올릴 수 있어요.", true); continue; }
        const im = { key: ++keySeq, file: f, url: URL.createObjectURL(f) };
        imgs.push(im);
        added.push(im);
      }
      if (added.length) insertFigures(added);
    }
    document.getElementById("bd-add-img").addEventListener("mousedown", (e) => e.preventDefault()); // 커서 유지
    document.getElementById("bd-add-img").addEventListener("click", () => document.getElementById("bd-file").click());
    document.getElementById("bd-file").addEventListener("change", (e) => {
      addFiles(Array.from(e.target.files));
      e.target.value = "";
    });

    // 편집칸 → { text, order(사진 key 순서) }. 줄(div/p/br) 단위로 줄바꿈, 사진은 [[사진:n]] 한 줄.
    function serialize() {
      const order = [];
      const lines = [];
      let cur = "";
      const flush = () => { lines.push(cur); cur = ""; };
      const walk = (node, isBlock) => {
        for (const ch of Array.from(node.childNodes)) {
          if (ch.nodeType === 3) { cur += ch.textContent.replace(/ /g, " "); continue; }
          if (ch.nodeType !== 1) continue;
          if (ch.matches("figure.bd-ed-img")) {
            if (cur) flush();
            order.push(Number(ch.dataset.k));
            lines.push(`[[사진:${order.length}]]`);
            continue;
          }
          if (ch.nodeName === "BR") { flush(); continue; }
          const block = /^(DIV|P|LI|H\d|BLOCKQUOTE)$/.test(ch.nodeName);
          if (block && cur) flush();
          walk(ch, block);
          if (block) {
            // <div><br></div> 처럼 빈 줄은 위의 BR에서 이미 한 줄 처리됨
            if (cur || !ch.querySelector("br, figure")) flush();
          }
        }
      };
      walk(ed, true);
      if (cur) flush();
      const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      return { text, order };
    }

    const back = () => {
      document.removeEventListener("selectionchange", remember);
      goBack(() => (editing ? showPost(existing.post.id) : showList()));
    };
    document.getElementById("bd-back").addEventListener("click", back);
    document.getElementById("bd-cancel").addEventListener("click", back);
    const saveBtn = document.getElementById("bd-save");
    saveBtn.addEventListener("click", async () => {
      const title = document.getElementById("bd-title").value.trim();
      const { text, order } = serialize();
      const plain = text.replace(IMG_MARK_RE_G, "").trim();
      if (!title) { setStatus("제목을 입력해주세요.", true); return; }
      if (!plain && !order.length) { setStatus("내용을 입력해주세요.", true); return; }
      if (text.length > 5000) { setStatus("내용이 너무 길어요. (최대 5000자)", true); return; }
      const chosen = order.map((k) => imgs.find((x) => x.key === k)).filter(Boolean);
      saveBtn.disabled = true;
      try {
        const fresh = chosen.filter((i) => i.file);
        let uploads = [];
        if (fresh.length) {
          setStatus("사진 올리는 중...");
          const files = await Promise.all(fresh.map((i) => shrinkImage(i.file)));
          ({ uploads } = await call({ action: "upload-urls", files: files.map((f) => ({ fileName: f.name, sizeBytes: f.size })) }));
          for (let i = 0; i < files.length; i++) {
            const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(uploads[i].path, uploads[i].token, files[i], { contentType: files[i].type });
            if (error) throw new Error("upload_failed");
          }
        }
        let k = 0;
        const paths = chosen.map((im) => (im.path ? im.path : uploads[k++].path));
        setStatus("저장 중...");
        document.removeEventListener("selectionchange", remember);
        if (editing) {
          await call({ action: "update", id: existing.post.id, title, body: text, images: paths });
          if (history.state && history.state.fromBoard) history.back();
          else { setUrl({ post: String(existing.post.id) }, false); showPost(existing.post.id); }
        } else {
          const r = await call({ action: "create", board, title, body: text, images: paths });
          if (r.rewarded) { alert(`후기 보상 ${r.rewarded}P가 지급됐어요!`); refreshPoints(); }
          setUrl({ post: String(r.id) }, false, { fromBoard: !!(history.state && history.state.fromBoard) });
          showPost(r.id);
        }
      } catch (e) {
        saveBtn.disabled = false;
        document.addEventListener("selectionchange", remember);
        setStatus(e.code ? errText(e) : "저장하지 못했어요. 다시 시도해주세요.", true);
      }
    });
  }


  function refreshPoints() {
    try { if (typeof verifySessionInBackground === "function") verifySessionInBackground(); } catch { /* 무시 */ }
  }

  root.addEventListener("click", (e) => {
    const item = e.target.closest(".bd-item");
    if (item) { e.preventDefault(); openPost(Number(item.dataset.id)); return; }
    const pg = e.target.closest("#bd-pager button[data-pg]");
    if (pg && !pg.disabled) {
      curPage = Number(pg.dataset.pg);
      setUrl(listParams(), false, history.state || {});
      showList(curPage);
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const item = e.target.closest(".bd-item");
    if (item) openPost(Number(item.dataset.id));
  });

  // 글을 보고 있을 때 사이드바의 같은 게시판 메뉴를 누르면(spa-router는 같은 페이지라 무시함) 목록으로.
  const onSidebarClick = (e) => {
    const a = e.target.closest(`a[href="${PAGE_FILE}"]`);
    if (!a || curView === "list") return;
    setUrl({}, true);
    showList(0);
  };
  document.addEventListener("click", onSidebarClick);
  window.__pageCleanup = () => {
    alive = false;
    document.removeEventListener("click", onSidebarClick);
    document.getElementById("bd-report-modal")?.remove();
  };

  // 초기 화면 — 주소의 ?post= / ?write= / ?page= 를 따름. 단, spa-router로 다른 페이지에서 넘어오는 중엔
  // 스크립트가 실행되는 시점의 주소가 아직 "이전 페이지"라서, 주소가 이 게시판일 때만 읽음.
  const here = location.pathname.split("/").pop() === PAGE_FILE;
  const q = here ? new URLSearchParams(location.search) : new URLSearchParams();
  // 홈의 "게시판 새 글"에서 넘어올 때는 주소가 아직 홈이라 전역으로 받은 글 번호를 씀(index.html 참고)
  const pending = Number(window.__boardOpenPost);
  window.__boardOpenPost = null;
  const postId = !here && pending > 0 ? pending : Number(q.get("post"));
  if (Number.isSafeInteger(postId) && postId > 0) showPost(postId, { thenEdit: q.get("edit") === "1" });
  else if (q.get("write") === "1" && isLoggedIn()) showEditor(null);
  else showList(Math.max(0, (Number(q.get("page")) || 1) - 1));
}
