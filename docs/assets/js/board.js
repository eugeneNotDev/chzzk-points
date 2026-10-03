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
const isNew = (iso, id, seen) => Date.now() - new Date(iso).getTime() < 3_600_000 && !seen.has(id);

const CM_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>`;
const IMG_ICON = `<svg class="bd-imgico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="사진 있음"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/></svg>`;

function whoHtml(name, badge, mine, staff) {
  const b = badge && typeof titleBadgeHtml === "function" ? `${titleBadgeHtml(badge.name, badge.color)} ` : "";
  // 스트리머 계정은 실명으로 보이는 유일한 계정이고 "스트리머" 칭호를 이미 달고 있어서 이름 뒤 뱃지는 따로 안 붙임
  void staff;
  return `<span class="who${mine ? " me" : ""}">${b}${esc(name)}</span>`;
}
// 댓글 아바타: 실명(후기 게시판/스트리머)은 프로필 사진, 익명은 "글쓴이"/"익1" 글자. 사진이 안 뜨면 첫 글자로.
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
          <div class="bd-title"><span class="tt">${esc(p.title)}</span>${isNew(p.createdAt, p.id, seen) ? `<span class="new">N</span>` : ""}${p.hasImages ? IMG_ICON : ""}${chipsHtml(p)}${adminHiddenChip(p)}</div>
          <div class="bd-prev">${esc(p.preview)}</div>
          <div class="bd-meta">${whoHtml(authorOf(p), p.badge, p.mine, p.staff)}<span class="dot">·</span><span>${fmtTime(p.createdAt)}</span>${admChip(p.adminName, p.author)}<span class="cm">${CM_ICON} ${p.commentCount}</span></div>
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
  async function showPost(id, { thenEdit = false } = {}) {
    curView = "post";
    root.innerHTML = `<div class="bd-top"><h1 class="brand-heading">${cfg.name}</h1></div><div class="bd-post"><div class="bd-empty">불러오는 중...</div></div>`;
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
        <h2>${esc(p.title)}${review ? ` <span class="bd-chips">${chipsHtml(p)}</span>` : ""}</h2>
        <div class="bd-body">${esc(p.body)}</div>`}
        ${data.images.length ? `<div class="bd-images">${data.images.map((i) => `<a href="${esc(i.url)}" target="_blank" rel="noopener"><img src="${esc(i.url)}" alt="" loading="lazy"></a>`).join("")}</div>` : ""}
        ${p.mine || p.canDelete ? `<div class="bd-actions">
          ${p.mine ? `<button type="button" class="secondary" id="bd-edit">수정</button>` : ""}
          ${p.canDelete ? `<button type="button" class="secondary danger" id="bd-del">삭제</button>` : ""}
        </div>` : ""}
      </div>
      <div class="bd-post">
        <div class="bd-cm-h">댓글 ${data.comments.length}</div>
        <div id="bd-clist">${data.comments.map((c, i) => `
          <div class="bd-cm"${i === 0 ? ` style="border-top:0"` : ""}>
            ${avatarHtml(c)}
            <div class="bd-cm-main">
              <div class="bd-meta">${whoHtml(authorOf(c), c.badge, c.mine, c.staff)}<span class="dot">·</span><span>${fmtTime(c.createdAt)}</span>${admChip(c.adminName, c.author)}${adminHiddenChip(c)}${reportBtnHtml(c, "comment")}
                ${c.canDelete ? `<button type="button" class="bd-c-del" data-cid="${c.id}">삭제</button>` : ""}</div>
              ${c.hidden && !c.body ? `<div class="t">${veilHtml("댓글")}</div>` : `<div class="t">${esc(c.body)}</div>`}
            </div>
          </div>`).join("")}</div>
        <form class="bd-form" id="bd-cform">
          <input type="text" id="bd-cinput" class="notice-title-input" maxlength="500" placeholder="${!isLoggedIn() ? "로그인하면 댓글을 쓸 수 있어요" : review ? "댓글 남기기" : isAdmin() ? "댓글 남기기 (스트리머 계정은 닉네임으로 보여요)" : "익명으로 댓글 남기기"}" ${isLoggedIn() ? "" : "disabled"}>
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
      try { await call({ action: "comment", postId: p.id, body: text }); showPost(p.id); }
      catch (err) { btn.disabled = false; statusEl.textContent = errText(err); statusEl.style.color = "#ff8f8f"; }
    });
    document.getElementById("bd-clist").addEventListener("click", async (e) => {
      const b = e.target.closest(".bd-c-del");
      if (!b || !confirm("댓글을 삭제할까요?")) return;
      try { await call({ action: "delete-comment", id: Number(b.dataset.cid) }); showPost(p.id); }
      catch (err) { alert(errText(err)); }
    });
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
    // 이미지 항목: {path?, url, file?}  — 기존(path 있음) / 새로 고른 것(file 있음)
    let imgs = editing ? existing.images.map((i) => ({ path: i.path, url: i.url })) : [];
    root.innerHTML = `
      <div class="bd-top"><h1 class="brand-heading">${cfg.name}</h1><button type="button" class="bd-write secondary" id="bd-back">${editing ? "취소" : "목록"}</button></div>
      <p class="bd-sub">${editing ? "글을 수정해요." : board === "free" && isAdmin() ? "스트리머 계정으로 쓴 글은 익명이 아니라 닉네임으로 보여요." : cfg.sub}</p>
      ${!editing && board === "review" ? `<div class="bd-banner" id="bd-banner" hidden></div>` : ""}
      <div class="bd-post bd-editor">
        <input type="text" id="bd-title" class="notice-title-input" maxlength="60" placeholder="제목 (최대 60자)" value="${editing ? esc(existing.post.title) : ""}">
        <textarea id="bd-body" class="notice-title-input bd-body-input" maxlength="5000" rows="10" placeholder="내용을 입력하세요 (최대 5000자)">${editing ? esc(existing.post.body) : ""}</textarea>
        <div class="bd-img-row" id="bd-imgs"></div>
        <input type="file" id="bd-file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden>
        <p class="bd-note" id="bd-status"></p>
        <div class="bd-editor-actions"><button type="button" class="secondary" id="bd-cancel">취소</button><button type="button" id="bd-save">${editing ? "수정 완료" : "등록"}</button></div>
      </div>`;
    if (!editing && board === "review") loadBanner();
    const statusEl = document.getElementById("bd-status");
    const imgsEl = document.getElementById("bd-imgs");
    const setStatus = (t, err = false) => { statusEl.textContent = t; statusEl.style.color = err ? "#ff8f8f" : ""; };
    function renderImgs() {
      imgsEl.innerHTML = imgs.map((im, i) => `<div class="bd-thumb"><img src="${esc(im.url)}" alt=""><button type="button" data-rm="${i}" aria-label="삭제">×</button></div>`).join("") +
        (imgs.length < MAX_IMAGES ? `<button type="button" class="bd-add-img" id="bd-add-img">${IMG_ICON}<span>사진 ${imgs.length}/${MAX_IMAGES}</span></button>` : "");
      const add = document.getElementById("bd-add-img");
      if (add) add.addEventListener("click", () => document.getElementById("bd-file").click());
    }
    renderImgs();
    imgsEl.addEventListener("click", (e) => {
      const rm = e.target.closest("[data-rm]");
      if (!rm) return;
      const [gone] = imgs.splice(Number(rm.dataset.rm), 1);
      if (gone.file) URL.revokeObjectURL(gone.url);
      renderImgs();
    });
    document.getElementById("bd-file").addEventListener("change", (e) => {
      for (const f of Array.from(e.target.files)) {
        if (imgs.length >= MAX_IMAGES) break;
        if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) { setStatus("jpg, png, gif, webp 이미지만 올릴 수 있어요.", true); continue; }
        imgs.push({ file: f, url: URL.createObjectURL(f) });
      }
      e.target.value = "";
      renderImgs();
    });
    const back = () => goBack(() => (editing ? showPost(existing.post.id) : showList()));
    document.getElementById("bd-back").addEventListener("click", back);
    document.getElementById("bd-cancel").addEventListener("click", back);
    const saveBtn = document.getElementById("bd-save");
    saveBtn.addEventListener("click", async () => {
      const title = document.getElementById("bd-title").value.trim();
      const text = document.getElementById("bd-body").value.trim();
      if (!title) { setStatus("제목을 입력해주세요.", true); return; }
      if (!text) { setStatus("내용을 입력해주세요.", true); return; }
      saveBtn.disabled = true;
      try {
        let paths = imgs.filter((i) => i.path).map((i) => i.path);
        const fresh = imgs.filter((i) => i.file);
        if (fresh.length) {
          setStatus("사진 올리는 중...");
          const files = await Promise.all(fresh.map((i) => shrinkImage(i.file)));
          const { uploads } = await call({ action: "upload-urls", files: files.map((f) => ({ fileName: f.name, sizeBytes: f.size })) });
          for (let i = 0; i < files.length; i++) {
            const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(uploads[i].path, uploads[i].token, files[i], { contentType: files[i].type });
            if (error) throw new Error("upload_failed");
          }
          // 순서 유지: 기존/새 이미지를 화면에 보이던 순서대로
          let k = 0;
          paths = imgs.map((im) => (im.path ? im.path : uploads[k++].path));
        }
        setStatus("저장 중...");
        if (editing) {
          await call({ action: "update", id: existing.post.id, title, body: text, images: paths });
          // 글 보기 → 수정으로 들어온 기록이면 뒤로 돌아가면서 글을 새로 불러옴
          if (history.state && history.state.fromBoard) history.back();
          else { setUrl({ post: String(existing.post.id) }, false); showPost(existing.post.id); }
        } else {
          const r = await call({ action: "create", board, title, body: text, images: paths });
          if (r.rewarded) { alert(`후기 보상 ${r.rewarded}P가 지급됐어요!`); refreshPoints(); }
          // 글쓰기 기록을 새 글 보기로 바꿔치기 → 뒤로가기하면 목록
          setUrl({ post: String(r.id) }, false, { fromBoard: !!(history.state && history.state.fromBoard) });
          showPost(r.id);
        }
      } catch (e) {
        saveBtn.disabled = false;
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
