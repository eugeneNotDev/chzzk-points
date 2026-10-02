// 관리자 유저 상세 모달(포인트 내역 · 칭호 관리 · 미니게임 차단) — admin.html(유저 목록)과 ranking.html(랭킹에서
// 관리자가 이름을 눌렀을 때)이 같이 씀. 페이지 이동 때마다 body 아래 <script src>는 다시 실행되지 않고
// .main-content만 바뀌므로(spa-router.js), 모달 HTML은 처음 열 때 <body> 맨 끝에 한 번만 끼워 넣음.
// 쓰는 쪽: loadAdminUserModal()로 이 파일을 불러온 뒤 AdminUserModal.open(channelId, { onChanged }).
// chzzk-auth.js의 전역(authFetch, ADMIN_URL, FUNCTIONS_BASE_URL, createTitleColorPicker, DEFAULT_TITLE_COLOR,
// titleBadgeHtml)을 그대로 씀.
(function () {
  if (window.AdminUserModal) return;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // admin.html의 포인트 로그 탭에도 같은 함수가 있음(그쪽은 페이지 스크립트가 바로 쓰는 용도).
    function formatDateTime(iso) {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }

    function renderLogRow(entry) {
      const positive = entry.amount > 0;
      const sign = positive ? "+" : "";
      const whoLine = entry.channelName !== undefined
        ? `<strong>${escapeHtml(entry.channelName || "(알 수 없음)")}</strong>`
        : "";
      const undoArea = entry.adminAction
        ? (entry.undone
            ? `<span class="points-log-undone-label">취소됨</span>`
            : `<button type="button" class="link-btn points-log-undo-btn" data-id="${entry.id}">실행취소</button>`)
        : "";
      return `
        <div class="points-log-row">
          <div class="points-log-who">
            ${whoLine}
            <span class="points-log-reason">${escapeHtml(entry.reason || "")}</span>
          </div>
          <div class="points-log-amount ${positive ? "positive" : "negative"}">${sign}${entry.amount.toLocaleString("ko-KR")}P</div>
          <div class="points-log-time">${formatDateTime(entry.createdAt)}</div>
          <div class="points-log-undo-area">${undoArea}</div>
        </div>`;
    }

    function wireLogUndoButtons(container, onDone) {
      container.querySelectorAll(".points-log-undo-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("이 지급/차감 내역을 취소할까요? 반대 방향으로 포인트가 다시 조정돼요.")) return;
          const id = Number(btn.dataset.id);
          btn.disabled = true;
          try {
            const res = await authFetch(ADMIN_URL, {
              method: "POST",
              body: JSON.stringify({ action: "undo-adjustment", id }),
            });
            if (!res.ok) throw new Error(String(res.status));
            await onDone();
          } catch (err) {
            alert("실행취소에 실패했어요.");
            btn.disabled = false;
          }
        });
      });
    }

    function renderPagination(container, page, totalPages, onGoToPage) {
      if (totalPages <= 1) {
        container.innerHTML = "";
        return;
      }
      const pageSet = new Set([1, totalPages]);
      for (let p = page - 2; p <= page + 2; p++) {
        if (p >= 1 && p <= totalPages) pageSet.add(p);
      }
      const sorted = [...pageSet].sort((a, b) => a - b);

      let html = `<button type="button" class="page-btn" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>이전</button>`;
      let prev = 0;
      for (const p of sorted) {
        if (prev && p - prev > 1) html += `<span class="page-ellipsis">…</span>`;
        html += `<button type="button" class="page-btn${p === page ? " active" : ""}" data-page="${p}">${p}</button>`;
        prev = p;
      }
      html += `<button type="button" class="page-btn" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>다음</button>`;
      container.innerHTML = html;
      container.querySelectorAll(".page-btn:not(:disabled)").forEach((btn) => {
        btn.addEventListener("click", () => onGoToPage(Number(btn.dataset.page)));
      });
    }

  const MODAL_HTML = `
      <!-- 유저 목록에서 이름을 누르면 뜨는 상세 모달 — 그 유저의 전체 내역(24시간 제한 없음)을 봄. -->
      <dialog id="user-detail-modal" class="notice-modal admin-user-modal">
        <h3 id="user-detail-name"></h3>
        <p class="muted" id="user-detail-meta"></p>
        <div class="admin-user-detail-stats" id="user-detail-stats"></div>
        <!-- 칭호 요약(보유 개수 + 장착 중인 칭호). 보유 칭호 회수/새로 지급은 "칭호 관리" 버튼으로
             여는 별도 모달(user-titles-modal)에서 함. -->
        <div class="admin-user-titles-row">
          <div class="admin-user-titles-summary">
            <h4 class="admin-user-section-heading">칭호</h4>
            <p class="muted" id="user-detail-titles-summary"></p>
          </div>
          <button type="button" class="secondary" id="user-detail-titles-open-btn">칭호 관리</button>
        </div>
        <!-- 미니게임 차단 — 기간을 정해 룰렛·가위바위보·홀짝 참여를 막음(무료 뽑기·투표는 그대로). admin-minigame-block 함수. -->
        <div class="admin-user-titles-row">
          <div class="admin-user-titles-summary">
            <h4 class="admin-user-section-heading">미니게임</h4>
            <p class="muted" id="user-detail-minigame-status">불러오는 중...</p>
          </div>
          <div class="admin-minigame-actions">
            <select id="user-detail-minigame-duration" aria-label="차단 기간">
              <option value="day">하루</option>
              <option value="week">일주일</option>
              <option value="month">한 달</option>
              <option value="forever">계속</option>
            </select>
            <button type="button" class="secondary danger" id="user-detail-minigame-btn" disabled>차단</button>
            <button type="button" class="secondary" id="user-detail-minigame-off-btn" hidden>해제</button>
          </div>
        </div>
        <h4 class="admin-user-section-heading">포인트 내역</h4>
        <div id="user-detail-log-list"></div>
        <p id="user-detail-log-empty" class="empty-state" hidden>내역이 없어요.</p>
        <div id="user-detail-pagination" class="pagination"></div>
        <div class="notice-modal-actions">
          <button type="button" class="secondary" id="user-detail-close-btn">닫기</button>
        </div>
      </dialog>

      <!-- 칭호 관리 모달 — 유저 상세 모달 위에 한 겹 더 뜸. 보유 칭호 회수 + 칭호 지급(새로 만들기 /
           기존 칭호 주기 → 상점 칭호·커스텀 칭호 탭). 지급한 칭호는 유저가 마이페이지에서 직접 장착함. -->
      <dialog id="user-titles-modal" class="notice-modal admin-user-modal">
        <h3 id="user-titles-heading">칭호 관리</h3>
        <h4 class="admin-user-section-heading">보유 칭호</h4>
        <div class="admin-user-title-list" id="user-detail-titles"></div>
        <p id="user-detail-titles-empty" class="muted" hidden>보유한 칭호가 없어요.</p>

        <h4 class="admin-user-section-heading">칭호 지급</h4>
        <form id="user-detail-grant-form" class="admin-title-grant-form" autocomplete="off">
          <div class="admin-grant-tabs" role="tablist">
            <button type="button" class="admin-grant-tab is-active" data-grant-mode="new" role="tab">새로 만들기</button>
            <button type="button" class="admin-grant-tab" data-grant-mode="existing" role="tab">기존 칭호 주기</button>
          </div>
          <div id="user-detail-grant-new">
            <div class="shop-item-field">
              <label class="field-label" for="user-detail-grant-name">칭호명 (최대 20자)</label>
              <input type="text" id="user-detail-grant-name" class="notice-title-input" maxlength="20" placeholder="예: 1호 팬">
            </div>
            <div class="shop-item-field">
              <span class="field-label">칭호 꾸미기</span>
              <div id="user-detail-grant-color"></div>
            </div>
          </div>
          <div id="user-detail-grant-existing" hidden>
            <div class="admin-grant-subtabs" role="tablist">
              <button type="button" class="admin-grant-subtab is-active" data-existing-kind="shop" role="tab">상점 칭호 <span class="admin-grant-count" data-count-kind="shop"></span></button>
              <button type="button" class="admin-grant-subtab" data-existing-kind="custom" role="tab">커스텀 칭호 <span class="admin-grant-count" data-count-kind="custom"></span></button>
            </div>
            <p class="muted admin-grant-existing-help" id="user-detail-grant-existing-help"></p>
            <div class="admin-grant-existing-list" id="user-detail-grant-existing-list" role="radiogroup"></div>
          </div>
          <p class="status-msg" id="user-detail-grant-status"></p>
          <div class="admin-title-grant-actions">
            <button type="submit" id="user-detail-grant-submit-btn">지급하기</button>
          </div>
        </form>
        <div class="notice-modal-actions">
          <button type="button" class="secondary" id="user-titles-close-btn">닫기</button>
        </div>
      </dialog>
`;

  let openFn = null;
  let onChanged = null;

  function init() {
    if (!document.getElementById("user-detail-modal")) {
      const wrap = document.createElement("div");
      wrap.innerHTML = MODAL_HTML;
      while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
    }

    // 유저 상세 모달 ----------------------------------------------------------
    // 유저 목록에서 이름을 누르면 뜸 — 그 유저의 전체 내역(24시간 제한 없이, list-points-log와
    // 달리 get-user-detail을 씀, 한 페이지 5개)을 보여줌. renderLogRow/renderPagination을 포인트
    // 로그 탭과 그대로 재사용함(같은 모양의 데이터라서) — 처리완료 체크박스는 여기 안 뜸
    // (상점 내역 탭에서만 처리하기로 함, 채팅 피드백 반영).
    const userDetailModal = document.getElementById("user-detail-modal");
    const userDetailNameEl = document.getElementById("user-detail-name");
    const userDetailMetaEl = document.getElementById("user-detail-meta");
    const userDetailStatsEl = document.getElementById("user-detail-stats");
    const userDetailLogListEl = document.getElementById("user-detail-log-list");
    const userDetailLogEmptyEl = document.getElementById("user-detail-log-empty");
    const userDetailPaginationEl = document.getElementById("user-detail-pagination");

    // 칭호 요약 + 칭호 관리 모달(보유 칭호 회수 / 칭호 지급) --------------------------------
    const userDetailTitlesSummaryEl = document.getElementById("user-detail-titles-summary");
    const userTitlesModal = document.getElementById("user-titles-modal");
    const userTitlesHeadingEl = document.getElementById("user-titles-heading");
    const userDetailTitlesEl = document.getElementById("user-detail-titles");
    const userDetailTitlesEmptyEl = document.getElementById("user-detail-titles-empty");
    const grantForm = document.getElementById("user-detail-grant-form");
    const grantNameInput = document.getElementById("user-detail-grant-name");
    const grantStatusEl = document.getElementById("user-detail-grant-status");
    const grantSubmitBtn = document.getElementById("user-detail-grant-submit-btn");
    const grantColorPicker = createTitleColorPicker(document.getElementById("user-detail-grant-color"), {
      initialColor: DEFAULT_TITLE_COLOR,
      getPreviewName: () => grantNameInput.value,
    });
    grantNameInput.addEventListener("input", () => grantColorPicker.refreshPreview());
    // 지금 상세 모달에 떠 있는 유저/페이지 — 지급/회수 후 같은 화면을 다시 불러올 때 씀.
    let detailChannelId = null;
    let detailChannelName = "";
    let detailPage = 1;
    let detailOwnedTitles = [];
    let detailOwnedIds = new Set();
    // 지급 방식: "new"(새 칭호 만들기) | "existing"(기존 칭호에서 고르기)
    // 기존 칭호는 다시 "shop"(상점 칭호) | "custom"(관리자가 만들어 줬던 칭호) 탭으로 나눔.
    let grantMode = "new";
    let existingKind = "shop";
    let selectedExistingTitleId = null;
    let allGrantableTitles = null; // 칭호 관리 모달을 열 때마다 새로 받아옴(방금 만든 칭호도 보이게)
    const grantNewEl = document.getElementById("user-detail-grant-new");
    const grantExistingEl = document.getElementById("user-detail-grant-existing");
    const grantExistingListEl = document.getElementById("user-detail-grant-existing-list");
    const grantExistingHelpEl = document.getElementById("user-detail-grant-existing-help");
    const grantTabs = Array.from(document.querySelectorAll(".admin-grant-tab"));
    const grantSubtabs = Array.from(document.querySelectorAll(".admin-grant-subtab"));
    const EXISTING_HELP = {
      shop: "상점에서 파는 칭호를 그대로 지급해요. 포인트는 안 빠지고 상품 남은 수량도 안 줄어요.",
      custom: "전에 다른 유저한테 새로 만들어 줬던 칭호를 똑같이 지급해요.",
    };

    // 지급할 수 있는 기존 칭호(상점/커스텀, 포인트 구간 칭호 제외) — titles는 공개 읽기라 anon으로 바로 읽음.
    async function fetchGrantableTitles() {
      const { supabase } = await import("./supabase-client.js");
      const { data, error } = await supabase.from("titles").select("id, name, color, kind").order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []).filter((t) => t.kind === "shop" || t.kind === "custom");
    }

    function updateExistingCounts() {
      document.querySelectorAll(".admin-grant-count").forEach((el) => {
        if (!allGrantableTitles) { el.textContent = ""; return; }
        const n = allGrantableTitles.filter((t) => t.kind === el.dataset.countKind && !detailOwnedIds.has(t.id)).length;
        el.textContent = String(n);
      });
    }

    async function renderExistingTitleChoices() {
      grantSubtabs.forEach((b) => b.classList.toggle("is-active", b.dataset.existingKind === existingKind));
      grantExistingHelpEl.textContent = EXISTING_HELP[existingKind];
      if (!allGrantableTitles) {
        grantExistingListEl.innerHTML = '<p class="muted">불러오는 중...</p>';
        try {
          allGrantableTitles = await fetchGrantableTitles();
        } catch (err) {
          console.error("[admin] 칭호 목록 조회 실패", err);
          grantExistingListEl.innerHTML = '<p class="muted">칭호 목록을 불러오지 못했어요.</p>';
          return;
        }
      }
      updateExistingCounts();
      const choices = allGrantableTitles.filter((t) => t.kind === existingKind && !detailOwnedIds.has(t.id));
      if (!choices.some((t) => t.id === selectedExistingTitleId)) selectedExistingTitleId = null;
      if (choices.length === 0) {
        const hasAny = allGrantableTitles.some((t) => t.kind === existingKind);
        grantExistingListEl.innerHTML = `<p class="muted">${hasAny ? "이 유저가 이미 전부 가지고 있어요." : existingKind === "shop" ? "상점 칭호가 아직 없어요." : "만들어 준 커스텀 칭호가 아직 없어요."}</p>`;
        return;
      }
      grantExistingListEl.innerHTML = choices.map((t) => `
        <button type="button" class="admin-grant-existing-option${t.id === selectedExistingTitleId ? " is-selected" : ""}" role="radio" data-title-id="${escapeHtml(t.id)}">
          ${titleBadgeHtml(t.name, t.color)}
        </button>`).join("");
      grantExistingListEl.querySelectorAll(".admin-grant-existing-option").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedExistingTitleId = btn.dataset.titleId;
          grantExistingListEl.querySelectorAll(".admin-grant-existing-option").forEach((b) => b.classList.toggle("is-selected", b === btn));
        });
      });
    }

    function setGrantStatus(text, kind = "") {
      grantStatusEl.textContent = text;
      grantStatusEl.className = `status-msg${kind ? ` ${kind}` : ""}`;
    }

    function setGrantMode(mode) {
      grantMode = mode;
      grantTabs.forEach((t) => t.classList.toggle("is-active", t.dataset.grantMode === mode));
      grantNewEl.hidden = mode !== "new";
      grantExistingEl.hidden = mode !== "existing";
      setGrantStatus("");
      if (mode === "existing") renderExistingTitleChoices();
    }
    grantTabs.forEach((t) => t.addEventListener("click", () => setGrantMode(t.dataset.grantMode)));
    grantSubtabs.forEach((b) => b.addEventListener("click", () => {
      existingKind = b.dataset.existingKind;
      selectedExistingTitleId = null;
      setGrantStatus("");
      renderExistingTitleChoices();
    }));

    function resetGrantForm() {
      setGrantMode("new");
      existingKind = "shop";
      selectedExistingTitleId = null;
      grantNameInput.value = "";
      grantColorPicker.setColor(DEFAULT_TITLE_COLOR);
      setGrantStatus("");
    }

    // 유저 상세 모달의 칭호 요약 한 줄.
    function renderTitlesSummary() {
      const list = detailOwnedTitles;
      if (list.length === 0) {
        userDetailTitlesSummaryEl.textContent = "보유한 칭호가 없어요.";
        return;
      }
      const equipped = list.find((t) => t.equipped);
      userDetailTitlesSummaryEl.innerHTML = `보유 ${list.length.toLocaleString("ko-KR")}개`
        + (equipped ? ` · 장착 중 ${titleBadgeHtml(equipped.name, equipped.color)}` : " · 장착 안 함");
    }

    // 칭호 관리 모달의 보유 칭호 목록(회수 버튼 포함).
    function renderOwnedTitles() {
      const list = detailOwnedTitles;
      userDetailTitlesEmptyEl.hidden = list.length > 0;
      userDetailTitlesEl.innerHTML = list.map((t) => `
        <span class="admin-user-title-chip">
          ${titleBadgeHtml(t.name, t.color)}
          <span class="chip-meta">${t.kind === "custom" ? "관리자 지급" : "상점 칭호"}${t.equipped ? " · 장착 중" : ""}</span>
          <button type="button" class="secondary" data-revoke-title-id="${escapeHtml(t.id)}" data-title-name="${escapeHtml(t.name)}">회수</button>
        </span>`).join("");
      userDetailTitlesEl.querySelectorAll("button[data-revoke-title-id]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm(`"${btn.dataset.titleName}" 칭호를 이 유저에게서 회수할까요?`)) return;
          btn.disabled = true;
          try {
            const res = await authFetch(ADMIN_URL, {
              method: "POST",
              body: JSON.stringify({ action: "revoke-title", channelId: detailChannelId, titleId: btn.dataset.revokeTitleId }),
            });
            if (!res.ok) throw new Error(String(res.status));
            // 커스텀 칭호는 마지막 보유자에게서 회수되면 칭호 자체가 지워지니 목록도 다시 받아옴.
            allGrantableTitles = null;
            await loadUserDetail(detailChannelId, detailPage);
            setGrantStatus(`"${btn.dataset.titleName}" 칭호를 회수했어요.`, "ok");
          } catch (err) {
            console.error("[admin] 칭호 회수 실패", err);
            alert("칭호를 회수하지 못했어요.");
            btn.disabled = false;
          }
        });
      });
      if (!userTitlesModal.open) return;
      if (grantMode === "existing") renderExistingTitleChoices();
      else updateExistingCounts();
    }

    function applyOwnedTitles(ownedTitles) {
      detailOwnedTitles = ownedTitles ?? [];
      detailOwnedIds = new Set(detailOwnedTitles.map((t) => t.id));
      renderTitlesSummary();
      renderOwnedTitles();
    }

    document.getElementById("user-detail-titles-open-btn").addEventListener("click", () => {
      resetGrantForm();
      allGrantableTitles = null;
      userTitlesHeadingEl.textContent = `${detailChannelName || "유저"} 칭호 관리`;
      renderOwnedTitles();
      userTitlesModal.showModal();
      // 목록 개수 표시용으로 미리 받아둠(탭을 눌렀을 때 바로 뜨게).
      fetchGrantableTitles().then((list) => { allGrantableTitles = list; updateExistingCounts(); }).catch(() => {});
    });
    document.getElementById("user-titles-close-btn").addEventListener("click", () => userTitlesModal.close());
    userTitlesModal.addEventListener("click", (e) => {
      if (e.target === userTitlesModal) userTitlesModal.close();
    });

    grantForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      let payload;
      if (grantMode === "existing") {
        if (!selectedExistingTitleId) {
          setGrantStatus("지급할 칭호를 골라주세요.", "error");
          return;
        }
        payload = { action: "grant-title", channelId: detailChannelId, titleId: selectedExistingTitleId };
      } else {
        const name = grantNameInput.value.trim();
        if (!name) {
          setGrantStatus("칭호명을 입력해주세요.", "error");
          return;
        }
        payload = { action: "grant-custom-title", channelId: detailChannelId, name, color: grantColorPicker.getColor() };
      }
      grantSubmitBtn.disabled = true;
      setGrantStatus("지급 중...");
      try {
        const res = await authFetch(ADMIN_URL, { method: "POST", body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setGrantStatus(
            data.error === "already_owned" ? "이미 가지고 있는 칭호예요."
              : data.error === "title_not_found" ? "없는 칭호예요(그새 지워졌을 수 있어요)."
              : data.error === "invalid_title_name" ? "칭호명은 1~20자로 입력해주세요."
              : data.error === "invalid_title_color" ? "칭호 색상이 올바르지 않아요."
              : "지급에 실패했어요.",
            "error",
          );
          return;
        }
        const keepMode = grantMode;
        const keepKind = existingKind;
        resetGrantForm();
        allGrantableTitles = null;
        await loadUserDetail(detailChannelId, detailPage);
        if (keepMode === "existing") {
          existingKind = keepKind;
          setGrantMode("existing");
        }
        setGrantStatus("칭호를 지급했어요. 유저가 마이페이지에서 장착할 수 있어요.", "ok");
      } catch (err) {
        console.error("[admin] 칭호 지급 실패", err);
        setGrantStatus("지급에 실패했어요.", "error");
      } finally {
        grantSubmitBtn.disabled = false;
      }
    });

    // 미니게임 차단(기간) — 유저 상세를 열 때마다 따로 불러옴(admin-minigame-block 함수, 0053_minigame_block.sql).
    const ADMIN_MINIGAME_BLOCK_URL = `${FUNCTIONS_BASE_URL}/admin-minigame-block`;
    const minigameStatusEl = document.getElementById("user-detail-minigame-status");
    const minigameBtn = document.getElementById("user-detail-minigame-btn");
    const minigameOffBtn = document.getElementById("user-detail-minigame-off-btn");
    const minigameDurationEl = document.getElementById("user-detail-minigame-duration");
    const MINIGAME_DURATION_LABEL = { day: "하루", week: "일주일", month: "한 달", forever: "계속" };
    function renderMinigameBlock(state) {
      if (!state) {
        minigameStatusEl.textContent = "불러오는 중...";
        minigameBtn.disabled = true;
        minigameOffBtn.hidden = true;
        return;
      }
      minigameStatusEl.textContent = !state.blocked
        ? "참여 가능"
        : state.forever ? "차단 중 — 기간 없이 계속" : `차단 중 — ${new Date(state.until).toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}까지`;
      minigameStatusEl.classList.toggle("is-blocked", !!state.blocked);
      minigameBtn.textContent = state.blocked ? "기간 바꾸기" : "차단";
      minigameBtn.disabled = false;
      minigameOffBtn.hidden = !state.blocked;
    }
    async function loadMinigameBlock(channelId) {
      renderMinigameBlock(null);
      try {
        const res = await authFetch(`${ADMIN_MINIGAME_BLOCK_URL}?channelId=${encodeURIComponent(channelId)}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (detailChannelId !== channelId) return; // 그 사이 다른 유저를 열었으면 무시
        renderMinigameBlock(data);
      } catch (err) {
        minigameStatusEl.textContent = "상태를 불러오지 못했어요.";
      }
    }
    async function setMinigameBlock(duration) {
      const channelId = detailChannelId;
      if (!channelId) return;
      const msg = duration === "off"
        ? `${detailChannelName}님의 미니게임 차단을 풀까요?`
        : `${detailChannelName}님의 미니게임 참여를 ${MINIGAME_DURATION_LABEL[duration]} 막을까요?\n(룰렛·가위바위보·홀짝 불가, 무료 뽑기·투표는 가능)`;
      if (!confirm(msg)) return;
      minigameBtn.disabled = true;
      try {
        const res = await authFetch(ADMIN_MINIGAME_BLOCK_URL, { method: "POST", body: JSON.stringify({ channelId, duration }) });
        if (!res.ok) throw new Error(String(res.status));
        renderMinigameBlock(await res.json());
      } catch (err) {
        alert("변경하지 못했어요.");
        minigameBtn.disabled = false;
      }
    }
    minigameBtn.addEventListener("click", () => setMinigameBlock(minigameDurationEl.value));
    minigameOffBtn.addEventListener("click", () => setMinigameBlock("off"));

    async function openUserDetailModal(channelId) {
      detailOwnedTitles = [];
      detailOwnedIds = new Set();
      userDetailTitlesSummaryEl.textContent = "";
      userDetailNameEl.textContent = "불러오는 중...";
      userDetailMetaEl.textContent = "";
      userDetailStatsEl.innerHTML = "";
      userDetailLogListEl.innerHTML = "";
      userDetailLogEmptyEl.hidden = true;
      userDetailPaginationEl.innerHTML = "";
      if (!userDetailModal.open) userDetailModal.showModal();
      detailChannelId = channelId;
      loadMinigameBlock(channelId);
      await loadUserDetail(channelId, 1);
    }

    async function loadUserDetail(channelId, page) {
      detailChannelId = channelId;
      detailPage = page;
      try {
        const res = await authFetch(ADMIN_URL, {
          method: "POST",
          body: JSON.stringify({ action: "get-user-detail", channelId, page }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();

        detailChannelName = data.channelName || "(이름 없음)";
        userDetailNameEl.textContent = detailChannelName;
        userDetailMetaEl.textContent = `가입일 ${formatDateTime(data.createdAt)}${data.banned ? " · 밴됨" : ""}`;
        userDetailStatsEl.innerHTML = `
          <div class="admin-user-detail-stat"><strong>${data.balance.toLocaleString("ko-KR")}P</strong><span>현재 잔액</span></div>
          <div class="admin-user-detail-stat"><strong>${data.maxBalanceReached.toLocaleString("ko-KR")}P</strong><span>역대 최고 보유</span></div>
          <div class="admin-user-detail-stat"><strong>${data.attendanceCount.toLocaleString("ko-KR")}회</strong><span>출석체크</span></div>
          <div class="admin-user-detail-stat"><strong>${data.isPublic ? "공개" : "비공개"}</strong><span>공개 설정</span></div>
        `;
        applyOwnedTitles(data.ownedTitles);

        if (!data.log || data.log.length === 0) {
          userDetailLogListEl.innerHTML = "";
          userDetailLogEmptyEl.hidden = false;
          userDetailPaginationEl.innerHTML = "";
          return;
        }
        userDetailLogEmptyEl.hidden = true;
        userDetailLogListEl.innerHTML = data.log.map(renderLogRow).join("");
        wireLogUndoButtons(userDetailLogListEl, async () => {
          await loadUserDetail(channelId, page);
          if (onChanged) await onChanged(); // 호출한 화면(관리자 유저 목록 등)의 잔액도 같이 갱신
        });
        renderPagination(userDetailPaginationEl, data.page, data.totalPages, (p) => loadUserDetail(channelId, p));
      } catch (err) {
        userDetailNameEl.textContent = "불러오지 못했어요.";
      }
    }

    document.getElementById("user-detail-close-btn").addEventListener("click", () => userDetailModal.close());
    // 배경(backdrop) 클릭 시 닫기 — index.html의 공지 모달과 같은 패턴.
    userDetailModal.addEventListener("click", (e) => {
      if (e.target === userDetailModal) userDetailModal.close();
    });

    return openUserDetailModal;

  }

  window.AdminUserModal = {
    open(channelId, opts) {
      onChanged = (opts && opts.onChanged) || null;
      if (!openFn) openFn = init();
      return openFn(channelId);
    },
  };
})();
