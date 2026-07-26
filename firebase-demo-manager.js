"use strict";

(function () {
  const STORAGE_KEY = "pokemonDexCollectionOverridesV1";
  const SESSION_KEY = "pokemonDexDemoAdminSessionV1";
  const EXPORT_FORMAT = "pokemon-dex-demo-v1";
  const originalFetch = window.fetch.bind(window);

  let overrides = readOverrides();
  let loadedData = null;
  let currentNumber = null;
  let tradeMode = false;
  let isAdmin = sessionStorage.getItem(SESSION_KEY) === "1";

  const tradeLabels = {
    none: "없음",
    duplicate: "중복 보유",
    trade: "교환 가능",
    sale: "판매 가능",
    reserved: "예약 중",
  };

  function readOverrides() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveOverrides(next) {
    overrides = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  }

  function normalize(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return {
      owned: Boolean(value.owned),
      setCode: String(value.setCode || "").trim(),
      cardNumber: String(value.cardNumber || "").trim(),
      rarity: String(value.rarity || "").trim(),
      quantity: Math.max(0, Number(value.quantity) || 0),
      tradeStatus: Object.hasOwn(tradeLabels, value.tradeStatus) ? value.tradeStatus : "none",
      imageUrl: String(value.imageUrl || "").trim(),
      note: String(value.note || "").trim(),
      updatedAt: String(value.updatedAt || ""),
    };
  }

  function applyOverrides(data) {
    for (const record of data.records || []) {
      const item = normalize(overrides[String(record.number)]);
      record.originalImageUrl = record.imageUrl;
      record.actualSet = "";
      record.actualCardNumber = "";
      record.actualRarity = "";
      record.quantity = record.owned ? 1 : 0;
      record.tradeStatus = "none";
      record.collectionNote = "";
      if (!item) continue;
      record.owned = item.owned;
      record.actualSet = item.setCode;
      record.actualCardNumber = item.cardNumber;
      record.actualRarity = item.rarity;
      record.quantity = item.quantity;
      record.tradeStatus = item.tradeStatus;
      record.collectionNote = item.note;
      if (item.imageUrl) record.imageUrl = item.imageUrl;
    }

    const records = data.records || [];
    const owned = records.filter((record) => record.owned).length;
    data.meta.owned = owned;
    data.meta.missing = records.length - owned;
    data.meta.completionRate = records.length ? Number(((owned / records.length) * 100).toFixed(1)) : 0;

    for (const generation of data.generations || []) {
      const rows = records.filter((record) => record.generation === generation.generation);
      generation.owned = rows.filter((record) => record.owned).length;
      generation.missing = rows.length - generation.owned;
      generation.completionRate = rows.length ? Number(((generation.owned / rows.length) * 100).toFixed(1)) : 0;
    }

    loadedData = data;
    return data;
  }

  window.fetch = async function demoManagedFetch(input, init) {
    const response = await originalFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    if (!response.ok || !/data\/pokedex\.json(?:$|[?#])/.test(url)) return response;

    try {
      const data = applyOverrides(await response.clone().json());
      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      headers.delete("content-length");
      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.warn("테스트 수집 데이터를 적용하지 못했습니다.", error);
      return response;
    }
  };

  function createAuthUi() {
    if (document.querySelector("#firebase-auth-panel")) return;
    const panel = document.createElement("div");
    panel.id = "firebase-auth-panel";
    panel.className = "firebase-auth-panel is-demo";
    panel.innerHTML = `
      <span class="firebase-auth-dot" aria-hidden="true"></span>
      <span id="firebase-auth-status"></span>
      <button id="firebase-login" type="button">테스트 관리자 로그인</button>
      <button id="firebase-logout" type="button" hidden>로그아웃</button>
    `;
    document.querySelector(".site-header")?.append(panel);
    panel.querySelector("#firebase-login")?.addEventListener("click", () => {
      sessionStorage.setItem(SESSION_KEY, "1");
      isAdmin = true;
      updateAccess();
    });
    panel.querySelector("#firebase-logout")?.addEventListener("click", () => {
      sessionStorage.removeItem(SESSION_KEY);
      isAdmin = false;
      updateAccess();
    });
    updateAccess();
  }

  function updateAccess() {
    const panel = document.querySelector("#firebase-auth-panel");
    if (panel) {
      panel.classList.toggle("is-admin", isAdmin);
      panel.classList.toggle("is-readonly", !isAdmin);
      panel.querySelector("#firebase-auth-status").textContent = isAdmin
        ? "TEST MODE · 관리자"
        : "TEST MODE · 읽기 전용";
      panel.querySelector("#firebase-login").hidden = isAdmin;
      panel.querySelector("#firebase-logout").hidden = !isAdmin;
    }
    document.querySelectorAll(".admin-only-control").forEach((element) => {
      element.hidden = !isAdmin;
    });
  }

  function makeButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function createControls() {
    const actions = document.querySelector(".catalog-actions");
    if (!actions || actions.querySelector(".collection-manager-actions")) return;

    const wrap = document.createElement("div");
    wrap.className = "collection-manager-actions";
    wrap.append(
      makeButton("미보유 목록", "manager-button", showMissing),
      makeButton("교환 가능", "manager-button", showTradeable),
      makeButton("백업 내보내기", "manager-button admin-only-control", exportData),
      makeButton("백업 가져오기", "manager-button admin-only-control", () =>
        document.querySelector("#collection-import")?.click(),
      ),
    );

    const input = document.createElement("input");
    input.id = "collection-import";
    input.type = "file";
    input.accept = "application/json,.json";
    input.hidden = true;
    input.addEventListener("change", importData);
    actions.append(wrap, input);

    const notice = document.createElement("div");
    notice.className = "collection-manager-notice collection-manager-notice--demo";
    notice.innerHTML =
      "<strong>Firebase 테스트 모드</strong><span>로그인 전에는 열람만 가능하고, 테스트 관리자 로그인 후 편집할 수 있습니다. 현재 입력은 이 브라우저에만 저장되며 실제 Firebase 연결 전 기능 검사용입니다.</span>";
    document.querySelector(".filter-panel")?.before(notice);
    updateAccess();
  }

  function createEditor() {
    const dialog = document.querySelector("#card-dialog");
    const details = dialog?.querySelector(".dialog-details");
    if (!dialog || !details || dialog.querySelector("#collection-editor")) return;

    for (const [label, id] of [
      ["실제 세트", "dialog-actual-set"],
      ["실제 카드번호", "dialog-actual-number"],
      ["레어도", "dialog-actual-rarity"],
      ["수량", "dialog-actual-quantity"],
      ["교환 상태", "dialog-trade-status"],
    ]) {
      const row = document.createElement("div");
      row.className = "collection-detail-row";
      row.innerHTML = `<dt>${label}</dt><dd id="${id}">—</dd>`;
      details.append(row);
    }

    const editor = document.createElement("section");
    editor.id = "collection-editor";
    editor.className = "collection-editor admin-only-control";
    editor.innerHTML = `
      <div class="collection-editor-heading">
        <div><span>TEST CARD RECORD</span><strong>실제 보유 카드 입력</strong></div>
        <label class="owned-switch"><input id="edit-owned" type="checkbox" /><span>보유</span></label>
      </div>
      <div class="collection-editor-grid">
        <label><span>세트 코드</span><input id="edit-set-code" type="text" placeholder="예: sv2a" /></label>
        <label><span>카드번호</span><input id="edit-card-number" type="text" placeholder="예: 025/165" /></label>
        <label><span>레어도</span><input id="edit-rarity" type="text" placeholder="예: C, AR, SAR" /></label>
        <label><span>수량</span><input id="edit-quantity" type="number" min="0" max="999" inputmode="numeric" /></label>
        <label class="collection-editor-wide"><span>교환 상태</span><select id="edit-trade-status"><option value="none">없음</option><option value="duplicate">중복 보유</option><option value="trade">교환 가능</option><option value="sale">판매 가능</option><option value="reserved">예약 중</option></select></label>
        <label class="collection-editor-wide"><span>실제 카드 이미지 URL</span><input id="edit-image-url" type="url" placeholder="비워두면 현재 대표 이미지 유지" /></label>
        <label class="collection-editor-wide"><span>메모</span><textarea id="edit-note" rows="2" placeholder="구매처, 카드 상태, 보관 위치 등"></textarea></label>
      </div>
      <div class="collection-editor-actions">
        <button id="collection-reset-card" class="manager-button manager-button--danger" type="button">이 카드 입력 초기화</button>
        <button id="collection-save-card" class="primary-button" type="button">테스트 저장</button>
      </div>
      <p class="collection-save-hint">테스트 데이터는 현재 브라우저에 저장됩니다. 실제 Firebase 연결 시 같은 입력 화면을 그대로 사용합니다.</p>
    `;
    details.after(editor);
    editor.querySelector("#collection-save-card")?.addEventListener("click", saveCurrent);
    editor.querySelector("#collection-reset-card")?.addEventListener("click", resetCurrent);
    editor.querySelector("#edit-owned")?.addEventListener("change", (event) => {
      const quantity = editor.querySelector("#edit-quantity");
      if (event.currentTarget.checked && Number(quantity.value) < 1) quantity.value = "1";
      if (!event.currentTarget.checked) quantity.value = "0";
    });
    updateAccess();
  }

  function parseNumber(element) {
    const text = element?.querySelector(".number-badge")?.textContent || "";
    const value = Number(text.replace(/\D/g, ""));
    return Number.isInteger(value) ? value : null;
  }

  function fillEditor(number) {
    if (!number) return;
    currentNumber = number;
    const item = normalize(overrides[String(number)]);
    const record = loadedData?.records?.find((candidate) => candidate.number === number);
    const dialog = document.querySelector("#card-dialog");
    if (!dialog || !record) return;

    const setValue = (selector, value) => {
      const element = dialog.querySelector(selector);
      if (element) element.value = value;
    };
    const setText = (selector, value) => {
      const element = dialog.querySelector(selector);
      if (element) element.textContent = value || "—";
    };

    dialog.querySelector("#edit-owned").checked = item ? item.owned : record.owned;
    setValue("#edit-set-code", item?.setCode || "");
    setValue("#edit-card-number", item?.cardNumber || "");
    setValue("#edit-rarity", item?.rarity || "");
    setValue("#edit-quantity", item ? item.quantity : record.owned ? 1 : 0);
    setValue("#edit-trade-status", item?.tradeStatus || "none");
    setValue("#edit-image-url", item?.imageUrl || "");
    setValue("#edit-note", item?.note || "");
    setText("#dialog-actual-set", item?.setCode);
    setText("#dialog-actual-number", item?.cardNumber);
    setText("#dialog-actual-rarity", item?.rarity);
    setText("#dialog-actual-quantity", item ? `${item.quantity}장` : record.owned ? "1장" : "0장");
    setText("#dialog-trade-status", tradeLabels[item?.tradeStatus || "none"]);
  }

  function requireAdmin() {
    if (isAdmin) return true;
    alert("테스트 관리자 로그인 후 수정할 수 있습니다.");
    return false;
  }

  function saveCurrent() {
    if (!currentNumber || !requireAdmin()) return;
    const dialog = document.querySelector("#card-dialog");
    const owned = dialog.querySelector("#edit-owned").checked;
    let quantity = Math.max(0, Number(dialog.querySelector("#edit-quantity").value) || 0);
    if (owned && quantity < 1) quantity = 1;
    if (!owned) quantity = 0;

    const item = {
      owned,
      setCode: dialog.querySelector("#edit-set-code").value.trim(),
      cardNumber: dialog.querySelector("#edit-card-number").value.trim(),
      rarity: dialog.querySelector("#edit-rarity").value.trim(),
      quantity,
      tradeStatus: dialog.querySelector("#edit-trade-status").value,
      imageUrl: dialog.querySelector("#edit-image-url").value.trim(),
      note: dialog.querySelector("#edit-note").value.trim(),
      updatedAt: new Date().toISOString(),
    };
    saveOverrides({ ...overrides, [String(currentNumber)]: item });
    location.reload();
  }

  function resetCurrent() {
    if (!currentNumber || !requireAdmin() || !overrides[String(currentNumber)]) return;
    if (!confirm("이 포켓몬의 테스트 입력을 초기화할까요?")) return;
    const next = { ...overrides };
    delete next[String(currentNumber)];
    saveOverrides(next);
    location.reload();
  }

  function showMissing() {
    tradeMode = false;
    document.querySelector('#status-filters button[data-status="missing"]')?.click();
    document.querySelector("#card-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showTradeable() {
    tradeMode = true;
    document.querySelector('#status-filters button[data-status="all"]')?.click();
    const loadMore = document.querySelector("#load-more");
    let guard = 0;
    while (loadMore && !loadMore.hidden && guard < 100) {
      loadMore.click();
      guard += 1;
    }
    enhanceCards();
    document.querySelector("#card-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function enhanceCards() {
    let tradeCount = 0;
    for (const card of document.querySelectorAll("#card-grid .pokemon-card")) {
      const item = normalize(overrides[String(parseNumber(card))]);
      const top = card.querySelector(".card-topline");
      card.querySelectorAll(".collection-mini-badge").forEach((node) => node.remove());

      if (item?.quantity > 1) {
        const badge = document.createElement("span");
        badge.className = "collection-mini-badge";
        badge.textContent = `×${item.quantity}`;
        top?.append(badge);
      }
      if (item && ["trade", "sale"].includes(item.tradeStatus)) {
        tradeCount += 1;
        const badge = document.createElement("span");
        badge.className = "collection-mini-badge collection-mini-badge--trade";
        badge.textContent = tradeLabels[item.tradeStatus];
        top?.append(badge);
      }

      const tradeable = item && ["trade", "sale"].includes(item.tradeStatus);
      card.classList.toggle("collection-manager-hidden", tradeMode && !tradeable);
      card.classList.toggle("has-collection-record", Boolean(item));
    }

    if (tradeMode) {
      const result = document.querySelector("#result-count");
      const label = document.querySelector("#active-filter-label");
      if (result) result.textContent = String(tradeCount);
      if (label) label.textContent = "· 교환·판매 가능";
    }
  }

  function exportData() {
    if (!requireAdmin()) return;
    const payload = {
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      recordCount: Object.keys(overrides).length,
      overrides,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pokemon-dex-test-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importData(event) {
    if (!requireAdmin()) return;
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const source = parsed?.overrides || parsed;
      const cleaned = {};
      for (const [key, value] of Object.entries(source || {})) {
        const number = Number(key);
        const item = normalize(value);
        if (Number.isInteger(number) && number >= 1 && number <= 1025 && item) cleaned[String(number)] = item;
      }
      if (!confirm(`${Object.keys(cleaned).length}개의 테스트 기록을 가져올까요?`)) return;
      saveOverrides({ ...overrides, ...cleaned });
      location.reload();
    } catch (error) {
      alert(`백업 파일을 가져오지 못했습니다.\n${error.message}`);
    }
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const cardButton = event.target.closest(".pokemon-card-button");
      if (cardButton) queueMicrotask(() => fillEditor(parseNumber(cardButton)));

      if (
        event.target.closest("#status-filters, #generation-filters, #reset-filters, [data-reset]") ||
        event.target.matches("#search-input, #sort-select")
      ) {
        tradeMode = false;
        document.querySelectorAll("#card-grid .collection-manager-hidden").forEach((card) =>
          card.classList.remove("collection-manager-hidden"),
        );
      }
    });

    const grid = document.querySelector("#card-grid");
    if (grid) new MutationObserver(enhanceCards).observe(grid, { childList: true });
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.classList.add("firebase-demo-mode");
    createAuthUi();
    createControls();
    createEditor();
    bindEvents();
    enhanceCards();
  });
})();
