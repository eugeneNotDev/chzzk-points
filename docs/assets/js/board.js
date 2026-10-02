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
const isNew = (iso) => Date.now() - new Date(iso).getTime() < 86_400_000;

const CM_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>`;
const IMG_ICON = `<svg class="bd-imgico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="사진 있음"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/></svg>`;

function whoHtml(name, badge, mine) {
  const b = badge && typeof titleBadgeHtml === "function" ? `${titleBadgeHtml(badge.name, badge.color)} ` : "";
  return `<span class="who${mine ? " me" : ""}">${b}${esc(name)}</span>`;
}
const admChip = (name) => (name ? `<span class="bd-adm">관리자에게만 보임: ${esc(name)}</span>` : "");
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
  window.__pageCleanup = () => { alive = false; };
  let curPage = 0;

  // ---------- 목록 ----------
  async function showList(page = curPage) {
    curPage = page;
    root.innerHTML = `
      <div class="bd-top"><h1 class="brand-heading">${cfg.name}</h1><button type="button" class="bd-write" id="bd-write-btn">${cfg.write}</button></div>
      <p class="bd-sub">${cfg.sub}</p>
      ${board === "review" ? `<div class="bd-banner" id="bd-banner" hidden></div>` : ""}
      <div class="bd-list" id="bd-list"><div class="bd-empty">불러오는 중...</div></div>
      <div class="bd-pager" id="bd-pager"></div>`;
    document.getElementById("bd-write-btn").addEventListener("click", () => {
      if (!isLoggedIn()) { startLogin(); return; }
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
    if (!data.posts.length) {
      listEl.innerHTML = `<div class="bd-empty">아직 글이 없어요. 첫 글을 남겨보세요!</div>`;
    } else {
      listEl.innerHTML = data.posts.map((p) => `
        <a class="bd-item" tabindex="0" role="button" data-id="${p.id}">
          <div class="bd-title"><span class="tt">${esc(p.title)}</span>${isNew(p.createdAt) ? `<span class="new">N</span>` : ""}${p.hasImages ? IMG_ICON : ""}${chipsHtml(p)}</div>
          <div class="bd-prev">${esc(p.preview)}</div>
          <div class="bd-meta">${whoHtml(p.author, p.badge, p.mine)}<span class="dot">·</span><span>${fmtTime(p.createdAt)}</span>${admChip(p.adminName)}<span class="cm">${CM_ICON} ${p.commentCount}</span></div>
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
  async function showPost(id) {
    root.innerHTML = `<div class="bd-top"><h1 class="brand-heading">${cfg.name}</h1></div><div class="bd-post"><div class="bd-empty">불러오는 중...</div></div>`;
    let data;
    try {
      data = await call({ action: "get", id });
    } catch (e) {
      root.innerHTML = `<div class="bd-top"><h1 class="brand-heading">${cfg.name}</h1><button type="button" class="bd-write secondary" id="bd-back">목록</button></div><div class="bd-post"><div class="bd-empty">${e.code === "not_found" ? "삭제됐거나 없는 글이에요." : "글을 불러오지 못했어요."}</div></div>`;
      document.getElementById("bd-back").addEventListener("click", () => showList());
      return;
    }
    if (!alive) return;
    const p = data.post;
    const review = board === "review";
    root.innerHTML = `
      <div class="bd-top"><h1 class="brand-heading">${cfg.name}</h1><button type="button" class="bd-write secondary" id="bd-back">목록</button></div>
      <div class="bd-post">
        <div class="bd-meta" style="margin-bottom:10px">${whoHtml(p.author, p.badge, p.mine)}<span class="dot">·</span><span>${fmtTime(p.createdAt)}${p.updatedAt !== p.createdAt ? " · 수정됨" : ""}</span>${admChip(p.adminName)}</div>
        <h2>${esc(p.title)}${review ? ` <span class="bd-chips">${chipsHtml(p)}</span>` : ""}</h2>
        <div class="bd-body">${esc(p.body)}</div>
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
            <div class="bd-av${c.op ? " op" : ""}">${esc(c.avatar ?? (c.author || "?").charAt(0))}</div>
            <div class="bd-cm-main">
              <div class="bd-meta">${whoHtml(c.author, c.badge, c.mine)}<span class="dot">·</span><span>${fmtTime(c.createdAt)}</span>${admChip(c.adminName)}
                ${c.canDelete ? `<button type="button" class="bd-c-del" data-cid="${c.id}">삭제</button>` : ""}</div>
              <div class="t">${esc(c.body)}</div>
            </div>
          </div>`).join("")}</div>
        <form class="bd-form" id="bd-cform">
          <input type="text" id="bd-cinput" class="notice-title-input" maxlength="500" placeholder="${isLoggedIn() ? (review ? "댓글 남기기" : "익명으로 댓글 남기기") : "로그인하면 댓글을 쓸 수 있어요"}" ${isLoggedIn() ? "" : "disabled"}>
          <button type="submit">${isLoggedIn() ? "등록" : "로그인"}</button>
        </form>
        ${review ? "" : `<div class="bd-note">같은 글 안에서는 같은 사람이 같은 익명 번호로 보여요.</div>`}
        <div class="bd-note" id="bd-cstatus"></div>
      </div>`;
    document.getElementById("bd-back").addEventListener("click", () => showList());
    const editBtn = document.getElementById("bd-edit");
    if (editBtn) editBtn.addEventListener("click", () => showEditor({ post: p, images: data.images }));
    const delBtn = document.getElementById("bd-del");
    if (delBtn) delBtn.addEventListener("click", async () => {
      const warn = review ? "이 후기를 삭제할까요?\n보상으로 받은 100P가 있다면 함께 회수돼요." : "이 글을 삭제할까요?";
      if (!confirm(warn)) return;
      delBtn.disabled = true;
      try {
        const r = await call({ action: "delete", id: p.id });
        if (r.revoked) { alert(`삭제했어요. 보상 ${r.revoked}P가 회수됐어요.`); refreshPoints(); }
        showList();
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

  // ---------- 글쓰기 / 수정 ----------
  function showEditor(existing) {
    const editing = !!existing;
    // 이미지 항목: {path?, url, file?}  — 기존(path 있음) / 새로 고른 것(file 있음)
    let imgs = editing ? existing.images.map((i) => ({ path: i.path, url: i.url })) : [];
    root.innerHTML = `
      <div class="bd-top"><h1 class="brand-heading">${cfg.name}</h1><button type="button" class="bd-write secondary" id="bd-back">${editing ? "취소" : "목록"}</button></div>
      <p class="bd-sub">${editing ? "글을 수정해요." : cfg.sub}</p>
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
    const back = () => (editing ? showPost(existing.post.id) : showList());
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
          showPost(existing.post.id);
        } else {
          const r = await call({ action: "create", board, title, body: text, images: paths });
          if (r.rewarded) { alert(`후기 보상 ${r.rewarded}P가 지급됐어요!`); refreshPoints(); }
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
    if (item) { e.preventDefault(); showPost(Number(item.dataset.id)); return; }
    const pg = e.target.closest("#bd-pager button[data-pg]");
    if (pg && !pg.disabled) showList(Number(pg.dataset.pg));
  });
  showList(0);
}
