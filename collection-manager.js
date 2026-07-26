"use strict";

(function () {
  const STORAGE_KEY = "pokemonDexCollectionOverridesV1";
  const EXPORT_FORMAT = "pokemon-dex-collection-v1";
  const originalFetch = window.fetch.bind(window);

  let overrides = readOverrides();
  let loadedData = null;
  let currentNumber = null;
  let tradeMode = false;

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
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (error) {
      console.warn("수집 관리 데이터를 읽지 못했습니다.", error);
      return {};
    }
  }

  function writeOverrides(next) {
    overrides = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  }

  function getOverride(number) {
    return overrides[String(number)] || null;
  }

  function normalizeOverride(value) {
    if (!value || typeof value !== "object") return null;
    return {
      owned: Boolean(value.owned),
      setCode: String(value.setCode || "").trim(),
      cardNumber: String(value.cardNumber || "").trim(),
      rarity: String(value.rarity || "").trim(),
      quantity: Math.max(0, Number(value.quantity) || 0),
      tradeStatus: Object.hasOwn(tradeLabels, value.tradeStatus)
        ? value.tradeStatus
        : "none",
      imageUrl: String(value.imageUrl || "").trim(),
      note: String(value.note || "").trim(),
      updatedAt: String(value.updatedAt || ""),
    };
  }

  function applyOverrides(data) {
    for (const record of data.records) {
      const item = normalizeOverride(getOverride(record.number));
      record.originalImageUrl = record.imageUrl;
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

    const owned = data.records.filter((record) => record.owned).length;
    data.meta.owned = owned;
    data.meta.missing = data.records.length - owned;
    data.meta.completionRate = Number(
      ((owned / data.records.length) * 100).toFixed(1),
    );

    for (const generation of data.generations) {
      const records = data.records.filter(
        (record) => record.generation === generation.generation,
      );
      generation.owned = records.filter((record) => record.owned).length;
      generation.missing = records.length - generation.owned;
      generation.completionRate = Number(
        ((generation.owned / records.length) * 100).toFixed(1),
      );
    }

    loadedData = data;
    return data;
  }

  window.fetch = async function managedFetch(input, init) {
    const response = await originalFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    if (!response.ok || !/data\/pokedex\.json(?:$|[?#])/.test(url)) {
      return response;
    }

    try {
      const data = applyOverrides(await response.json());
      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      headers.delete("content-length");
      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.warn("수집 관리 데이터를 적용하지 못했습니다.", error);
      return originalFetch(input, init);
    }
  };

  function parseNumber(element) {
    const label = element
      ?.querySelector(".number-badge")
      ?.textContent?.replace(/\D/g, "");
    return label ? Number(label) : null;
  }

  function recordFor(number) {
    return loadedData?.records?.find((record) => record.number === number) || null;
  }

  function makeButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function addManagementControls() {
    const actions = document.querySelector(".catalog-actions");
    if (!actions || actions.querySelector(".collection-manager-actions")) return;

    const wrap = document.createElement("div");
    wrap.className = "collection-manager-actions";
    wrap.append(
      makeButton("미보유 목록", "manager-button", showMissing),
      makeButton("교환 가능", "manager-button", showTradeable),
      makeButton("백업 내보내기", "manager-button", exportData),
      makeButton("백업 가져오기", "manager-button", () =>
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
    notice.className = "collection-manager-notice";
    notice.innerHTML =
      "<strong>내 카드 관리</strong><span>카드를 누르면 실제 보유 세트·카드번호·수량·교환 상태를 기록할 수 있습니다. 입력 내용은 현재 기기에 저장됩니다.</span>";
    document.querySelector(".filter-panel")?.before(notice);
  }

  function addDialogEditor() {
    const dialog = document.querySelector("#card-dialog");
    const details = dialog?.querySelector(".dialog-details");
    if (!dialog || !details || dialog.querySelector("#collection-editor")) return;

    const extraRows = [
      ["실제 세트", "dialog-actual-set"],
      ["실제 카드번호", "dialog-actual-number"],
      ["레어도", "dialog-actual-rarity"],
      ["수량", "dialog-actual-quantity"],
      ["교환 상태", "dialog-trade-status"],
    ];
    for (const [label, id] of extraRows) {
      const row = document.createElement("div");
      row.className = "collection-detail-row";
      row.innerHTML = `<dt>${label}</dt><dd id="${id}">—</dd>`;
      details.append(row);
    }

    const editor = document.createElement("section");
    editor.id = "collection-editor";
    editor.className = "collection-editor";
    editor.innerHTML = `
      <div class="collection-editor-heading">
        <div><span>MY CARD RECORD</span><strong>실제 보유 카드 입력</strong></div>
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
        <button id="collection-save-card" class="primary-button" type="button">저장</button>
      </div>
      <p class="collection-save-hint">사이트 전체에 반영하려면 ‘백업 내보내기’ 파일을 보관하거나 전달하면 됩니다.</p>
    `;
    details.after(editor);

    dialog.querySelector("#collection-save-card").addEventListener("click", saveCurrent);
    dialog.querySelector("#collection-reset-card").addEventListener("click", resetCurrent);
    dialog.querySelector("#edit-owned").addEventListener("change", (event) => {
      const quantity = dialog.querySelector("#edit-quantity");
      if (event.currentTarget.checked && Number(quantity.value) < 1) quantity.value = "1";
      if (!event.currentTarget.checked) quantity.value = "0";
    });
  }

  function fillEditor(number) {
    const record = recordFor(number);
    if (!record) return;
    currentNumber = number;
    const item = normalizeOverride(getOverride(number));
    const dialog = document.querySelector("#card-dialog");

    const value = (selector, next) => {
      const element = dialog.querySelector(selector);
      if (element) element.value = next;
    };

    dialog.querySelector("#edit-owned").checked = item ? item.owned : record.owned;
    value("#edit-set-code", item?.setCode || "");
    value("#edit-card-number", item?.cardNumber || "");
    value("#edit-rarity", item?.rarity || "");
    value("#edit-quantity", item ? item.quantity : record.owned ? 1 : 0);
    value("#edit-trade-status", item?.tradeStatus || "none");
    value("#edit-image-url", item?.imageUrl || "");
    value("#edit-note", item?.note || "");

    const setText = (id, text) => {
      const element = document.querySelector(id);
      if (element) element.textContent = text || "—";
    };
    setText("#dialog-actual-set", item?.setCode);
    setText("#dialog-actual-number", item?.cardNumber);
    setText("#dialog-actual-rarity", item?.rarity);
    setText("#dialog-actual-quantity", item ? `${item.quantity}장` : record.owned ? "1장" : "0장");
    setText("#dialog-trade-status", tradeLabels[item?.tradeStatus || "none"]);
  }

  function saveCurrent() {
    if (!currentNumber) return;
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

    writeOverrides({ ...overrides, [String(currentNumber)]: item });
    location.reload();
  }

  function resetCurrent() {
    if (!currentNumber || !getOverride(currentNumber)) return;
    if (!confirm("이 포켓몬에 입력한 실제 카드 정보를 초기화할까요?")) return;
    const next = { ...overrides };
    delete next[String(currentNumber)];
    writeOverrides(next);
    location.reload();
  }

  function showMissing() {
    tradeMode = false;
    const button = document.querySelector('#status-filters button[data-status="missing"]');
    button?.click();
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
    applyCardEnhancements();
    document.querySelector("#card-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applyCardEnhancements() {
    const cards = [...document.querySelectorAll("#card-grid .pokemon-card")];
    let tradeCount = 0;

    for (const card of cards) {
      const number = parseNumber(card);
      const item = normalizeOverride(getOverride(number));
      const top = card.querySelector(".card-topline");
      card.querySelectorAll(".collection-mini-badge").forEach((node) => node.remove());

      if (item && item.quantity > 1) {
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

      const isTradeable = item && ["trade", "sale"].includes(item.tradeStatus);
      card.classList.toggle("collection-manager-hidden", tradeMode && !isTradeable);
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
    const payload = {
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      recordCount: Object.keys(overrides).length,
      overrides,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pokemon-dex-collection-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importData(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      const source = parsed?.format === EXPORT_FORMAT ? parsed.overrides : parsed;
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        throw new Error("지원하지 않는 백업 형식입니다.");
      }

      const cleaned = {};
      for (const [key, value] of Object.entries(source)) {
        const number = Number(key);
        const item = normalizeOverride(value);
        if (Number.isInteger(number) && number >= 1 && number <= 1025 && item) {
          cleaned[String(number)] = item;
        }
      }

      if (!confirm(`${Object.keys(cleaned).length}개의 카드 기록을 가져올까요? 현재 기록과 합쳐집니다.`)) return;
      writeOverrides({ ...overrides, ...cleaned });
      location.reload();
    } catch (error) {
      alert(`백업 파일을 가져오지 못했습니다.\n${error.message}`);
    }
  }

  function bindPageEvents() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest(".pokemon-card-button");
      if (button) {
        const number = parseNumber(button);
        queueMicrotask(() => fillEditor(number));
      }

      if (
        event.target.closest("#status-filters, #generation-filters, #reset-filters, [data-reset]") ||
        event.target.matches("#search-input, #sort-select")
      ) {
        tradeMode = false;
      }
    });

    document.querySelector("#search-input")?.addEventListener("input", () => {
      tradeMode = false;
    });
    document.querySelector("#sort-select")?.addEventListener("change", () => {
      tradeMode = false;
    });

    const grid = document.querySelector("#card-grid");
    if (grid) {
      new MutationObserver(applyCardEnhancements).observe(grid, {
        childList: true,
      });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    addManagementControls();
    addDialogEditor();
    bindPageEvents();
    applyCardEnhancements();
  });
})();
