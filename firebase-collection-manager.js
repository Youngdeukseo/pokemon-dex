"use strict";

(function () {
  const SDK_VERSION = "12.16.0";
  const CONFIG = window.POKEMON_DEX_FIREBASE || {};
  const COLLECTION_DOC = CONFIG.documentPath || ["collections", "nationalDex"];
  const LOCAL_STORAGE_KEY = "pokemonDexCollectionOverridesV1";
  const EXPORT_FORMAT = "pokemon-dex-collection-v2";
  const originalFetch = window.fetch.bind(window);

  let firebase = null;
  let collectionRef = null;
  let remoteOverrides = {};
  let currentNumber = null;
  let currentUser = null;
  let isAdmin = false;
  let initialSnapshotLoaded = false;
  let resolveReady;
  const firebaseReady = new Promise((resolve) => {
    resolveReady = resolve;
  });

  const tradeLabels = {
    none: "없음",
    duplicate: "중복 보유",
    trade: "교환 가능",
    sale: "판매 가능",
    reserved: "예약 중",
  };

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function configured() {
    const config = CONFIG.config || {};
    return Boolean(
      CONFIG.enabled &&
        config.apiKey &&
        config.authDomain &&
        config.projectId &&
        Array.isArray(CONFIG.adminEmails) &&
        CONFIG.adminEmails.length,
    );
  }

  function normalizeOverride(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const tradeStatus = Object.hasOwn(tradeLabels, value.tradeStatus)
      ? value.tradeStatus
      : "none";
    return {
      owned: Boolean(value.owned),
      setCode: String(value.setCode || "").trim(),
      cardNumber: String(value.cardNumber || "").trim(),
      rarity: String(value.rarity || "").trim(),
      quantity: Math.max(0, Number(value.quantity) || 0),
      tradeStatus,
      imageUrl: String(value.imageUrl || "").trim(),
      note: String(value.note || "").trim(),
      updatedAt: value.updatedAt || null,
      updatedBy: String(value.updatedBy || "").trim(),
    };
  }

  function sanitizeOverrides(source) {
    const cleaned = {};
    if (!source || typeof source !== "object" || Array.isArray(source)) return cleaned;
    for (const [key, value] of Object.entries(source)) {
      const number = Number(key);
      const item = normalizeOverride(value);
      if (Number.isInteger(number) && number >= 1 && number <= 1025 && item) {
        cleaned[String(number)] = item;
      }
    }
    return cleaned;
  }

  function applyOverrides(data) {
    const overrides = sanitizeOverrides(remoteOverrides);
    for (const record of data.records || []) {
      const item = overrides[String(record.number)];
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
    data.meta.completionRate = records.length
      ? Number(((owned / records.length) * 100).toFixed(1))
      : 0;

    for (const generation of data.generations || []) {
      const generationRecords = records.filter(
        (record) => record.generation === generation.generation,
      );
      generation.owned = generationRecords.filter((record) => record.owned).length;
      generation.missing = generationRecords.length - generation.owned;
      generation.completionRate = generationRecords.length
        ? Number(((generation.owned / generationRecords.length) * 100).toFixed(1))
        : 0;
    }
    return data;
  }

  window.fetch = async function firebaseManagedFetch(input, init) {
    const response = await originalFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    if (!response.ok || !/data\/pokedex\.json(?:$|[?#])/.test(url)) {
      return response;
    }

    try {
      await Promise.race([
        firebaseReady,
        new Promise((resolve) => window.setTimeout(resolve, 7000)),
      ]);
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
      console.warn("Firebase 도감 데이터를 적용하지 못했습니다.", error);
      return response;
    }
  };

  async function initializeFirebase() {
    if (!configured()) {
      resolveReady();
      document.documentElement.classList.add("firebase-not-configured");
      return;
    }

    try {
      const [appModule, authModule, firestoreModule] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`),
      ]);

      const app = appModule.initializeApp(CONFIG.config);
      const auth = authModule.getAuth(app);
      const db = firestoreModule.getFirestore(app);
      auth.useDeviceLanguage();
      await authModule.setPersistence(auth, authModule.browserLocalPersistence);

      collectionRef = firestoreModule.doc(db, ...COLLECTION_DOC);
      firebase = { auth, authModule, firestoreModule };

      try {
        await authModule.getRedirectResult(auth);
      } catch (error) {
        console.warn("Google 로그인 결과를 확인하지 못했습니다.", error);
      }

      const snapshot = await firestoreModule.getDoc(collectionRef);
      remoteOverrides = sanitizeOverrides(snapshot.data()?.overrides || {});
      initialSnapshotLoaded = true;
      resolveReady();

      authModule.onAuthStateChanged(auth, (user) => {
        currentUser = user;
        const adminEmails = CONFIG.adminEmails.map(normalizeEmail);
        isAdmin = Boolean(
          user && user.emailVerified && adminEmails.includes(normalizeEmail(user.email)),
        );
        updateAuthUi();
        updateEditorAccess();
      });

      firestoreModule.onSnapshot(
        collectionRef,
        (nextSnapshot) => {
          const next = sanitizeOverrides(nextSnapshot.data()?.overrides || {});
          const changed = JSON.stringify(next) !== JSON.stringify(remoteOverrides);
          remoteOverrides = next;
          if (initialSnapshotLoaded && changed) {
            window.location.reload();
          }
          initialSnapshotLoaded = true;
        },
        (error) => {
          console.warn("Firestore 실시간 동기화에 실패했습니다.", error);
        },
      );
    } catch (error) {
      console.error("Firebase 초기화에 실패했습니다.", error);
      document.documentElement.classList.add("firebase-error");
      resolveReady();
      updateAuthUi(error);
    }
  }

  function makeButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function createAuthUi() {
    if (document.querySelector("#firebase-auth-panel")) return;
    const panel = document.createElement("div");
    panel.id = "firebase-auth-panel";
    panel.className = "firebase-auth-panel";
    panel.innerHTML = `
      <span class="firebase-auth-dot" aria-hidden="true"></span>
      <span id="firebase-auth-status">로그인 상태 확인 중</span>
      <button id="firebase-login" type="button">Google 로그인</button>
      <button id="firebase-logout" type="button" hidden>로그아웃</button>
    `;
    document.querySelector(".site-header")?.append(panel);
    panel.querySelector("#firebase-login")?.addEventListener("click", signIn);
    panel.querySelector("#firebase-logout")?.addEventListener("click", signOutUser);
    updateAuthUi();
  }

  function updateAuthUi(error) {
    const panel = document.querySelector("#firebase-auth-panel");
    if (!panel) return;
    const status = panel.querySelector("#firebase-auth-status");
    const login = panel.querySelector("#firebase-login");
    const logout = panel.querySelector("#firebase-logout");
    panel.classList.toggle("is-admin", isAdmin);
    panel.classList.toggle("is-readonly", Boolean(currentUser && !isAdmin));

    if (!configured()) {
      status.textContent = "Firebase 설정 필요 · 읽기 전용";
      login.hidden = true;
      logout.hidden = true;
      return;
    }
    if (error || document.documentElement.classList.contains("firebase-error")) {
      status.textContent = "Firebase 연결 오류 · 읽기 전용";
      login.hidden = false;
      logout.hidden = true;
      return;
    }
    if (!currentUser) {
      status.textContent = "방문자 · 읽기 전용";
      login.hidden = false;
      logout.hidden = true;
      return;
    }
    if (isAdmin) {
      status.textContent = `${currentUser.displayName || currentUser.email} · 관리자`;
    } else {
      status.textContent = `${currentUser.displayName || currentUser.email} · 열람 전용`;
    }
    login.hidden = true;
    logout.hidden = false;
  }

  async function signIn() {
    if (!firebase) return;
    const { auth, authModule } = firebase;
    const provider = new authModule.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      const mobile = window.matchMedia("(max-width: 690px), (pointer: coarse)").matches;
      if (mobile) {
        await authModule.signInWithRedirect(auth, provider);
      } else {
        await authModule.signInWithPopup(auth, provider);
      }
    } catch (error) {
      if (error.code !== "auth/popup-closed-by-user") {
        alert(`Google 로그인에 실패했습니다.\n${error.message}`);
      }
    }
  }

  async function signOutUser() {
    if (!firebase) return;
    await firebase.authModule.signOut(firebase.auth);
  }

  function createManagementControls() {
    const actions = document.querySelector(".catalog-actions");
    if (!actions || actions.querySelector(".collection-manager-actions")) return;
    const wrap = document.createElement("div");
    wrap.className = "collection-manager-actions";
    wrap.append(
      makeButton("미보유 목록", "manager-button", showMissing),
      makeButton("교환 가능", "manager-button", showTradeable),
      makeButton("백업 내보내기", "manager-button admin-only-control", exportData),
      makeButton("기존 기록 이전", "manager-button admin-only-control", migrateLocalData),
    );
    actions.append(wrap);

    const notice = document.createElement("div");
    notice.className = "collection-manager-notice";
    notice.innerHTML =
      "<strong>Firebase 동기화</strong><span>방문자는 열람만 가능하며, 지정된 Google 관리자 계정으로 로그인한 경우에만 실제 보유 카드를 수정할 수 있습니다.</span>";
    document.querySelector(".filter-panel")?.before(notice);
  }

  function createDialogEditor() {
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
    editor.className = "collection-editor admin-only-control";
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
        <button id="collection-save-card" class="primary-button" type="button">Firebase에 저장</button>
      </div>
      <p class="collection-save-hint">저장 내용은 Firestore에 기록되어 휴대전화와 PC에서 동일하게 표시됩니다.</p>
    `;
    details.after(editor);
    editor.querySelector("#collection-save-card")?.addEventListener("click", saveCurrent);
    editor.querySelector("#collection-reset-card")?.addEventListener("click", resetCurrent);
    editor.querySelector("#edit-owned")?.addEventListener("change", (event) => {
      const quantity = editor.querySelector("#edit-quantity");
      if (event.currentTarget.checked && Number(quantity.value) < 1) quantity.value = "1";
      if (!event.currentTarget.checked) quantity.value = "0";
    });
    updateEditorAccess();
  }

  function updateEditorAccess() {
    document.querySelectorAll(".admin-only-control").forEach((element) => {
      element.hidden = !isAdmin;
    });
  }

  function parseNumber(element) {
    const label = element?.querySelector(".number-badge")?.textContent || "";
    const value = Number(label.replace(/\D/g, ""));
    return Number.isInteger(value) ? value : null;
  }

  function fillEditor(number) {
    if (!number) return;
    currentNumber = number;
    const item = normalizeOverride(remoteOverrides[String(number)]);
    const dialog = document.querySelector("#card-dialog");
    if (!dialog) return;
    const owned = item?.owned ?? dialog.querySelector("#dialog-status")?.classList.contains("is-owned");
    const setValue = (selector, value) => {
      const element = dialog.querySelector(selector);
      if (element) element.value = value;
    };
    const setText = (selector, value) => {
      const element = dialog.querySelector(selector);
      if (element) element.textContent = value || "—";
    };

    const ownedInput = dialog.querySelector("#edit-owned");
    if (ownedInput) ownedInput.checked = Boolean(owned);
    setValue("#edit-set-code", item?.setCode || "");
    setValue("#edit-card-number", item?.cardNumber || "");
    setValue("#edit-rarity", item?.rarity || "");
    setValue("#edit-quantity", item ? item.quantity : owned ? 1 : 0);
    setValue("#edit-trade-status", item?.tradeStatus || "none");
    setValue("#edit-image-url", item?.imageUrl || "");
    setValue("#edit-note", item?.note || "");
    setText("#dialog-actual-set", item?.setCode);
    setText("#dialog-actual-number", item?.cardNumber);
    setText("#dialog-actual-rarity", item?.rarity);
    setText("#dialog-actual-quantity", item ? `${item.quantity}장` : owned ? "1장" : "0장");
    setText("#dialog-trade-status", tradeLabels[item?.tradeStatus || "none"]);
  }

  function requireAdmin() {
    if (!isAdmin || !firebase || !collectionRef) {
      alert("지정된 Google 관리자 계정으로 로그인해야 수정할 수 있습니다.");
      return false;
    }
    return true;
  }

  async function saveCurrent() {
    if (!currentNumber || !requireAdmin()) return;
    const dialog = document.querySelector("#card-dialog");
    const saveButton = dialog.querySelector("#collection-save-card");
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
      updatedBy: currentUser.email || currentUser.uid,
    };
    saveButton.disabled = true;
    saveButton.textContent = "저장 중…";
    try {
      const { firestoreModule } = firebase;
      await firestoreModule.setDoc(collectionRef, { overrides: {} }, { merge: true });
      await firestoreModule.updateDoc(collectionRef, {
        [`overrides.${currentNumber}`]: item,
        updatedAt: firestoreModule.serverTimestamp(),
      });
      window.location.reload();
    } catch (error) {
      console.error(error);
      alert(`저장하지 못했습니다.\n${error.message}`);
      saveButton.disabled = false;
      saveButton.textContent = "Firebase에 저장";
    }
  }

  async function resetCurrent() {
    if (!currentNumber || !requireAdmin()) return;
    if (!remoteOverrides[String(currentNumber)]) return;
    if (!confirm("이 포켓몬의 실제 카드 입력을 초기화할까요?")) return;
    try {
      await firebase.firestoreModule.updateDoc(collectionRef, {
        [`overrides.${currentNumber}`]: firebase.firestoreModule.deleteField(),
        updatedAt: firebase.firestoreModule.serverTimestamp(),
      });
      window.location.reload();
    } catch (error) {
      alert(`초기화하지 못했습니다.\n${error.message}`);
    }
  }

  function showMissing() {
    document.querySelector('#status-filters button[data-status="missing"]')?.click();
    document.querySelector("#card-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showTradeable() {
    document.querySelector('#status-filters button[data-status="all"]')?.click();
    const loadMore = document.querySelector("#load-more");
    let guard = 0;
    while (loadMore && !loadMore.hidden && guard < 100) {
      loadMore.click();
      guard += 1;
    }
    let count = 0;
    for (const card of document.querySelectorAll("#card-grid .pokemon-card")) {
      const item = remoteOverrides[String(parseNumber(card))];
      const visible = item && ["trade", "sale"].includes(item.tradeStatus);
      card.classList.toggle("collection-manager-hidden", !visible);
      if (visible) count += 1;
    }
    const result = document.querySelector("#result-count");
    const label = document.querySelector("#active-filter-label");
    if (result) result.textContent = String(count);
    if (label) label.textContent = "· 교환·판매 가능";
    document.querySelector("#card-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearTradeFilter() {
    document.querySelectorAll("#card-grid .collection-manager-hidden").forEach((card) => {
      card.classList.remove("collection-manager-hidden");
    });
  }

  function exportData() {
    if (!requireAdmin()) return;
    const payload = {
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      recordCount: Object.keys(remoteOverrides).length,
      overrides: remoteOverrides,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pokemon-dex-firebase-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function readLocalOverrides() {
    try {
      return sanitizeOverrides(JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "{}"));
    } catch {
      return {};
    }
  }

  async function migrateLocalData() {
    if (!requireAdmin()) return;
    const local = readLocalOverrides();
    const count = Object.keys(local).length;
    if (!count) {
      alert("이 브라우저에 이전할 기존 기록이 없습니다.");
      return;
    }
    if (!confirm(`이 브라우저에 저장된 ${count}개의 기록을 Firebase로 이전할까요?`)) return;
    try {
      const merged = { ...remoteOverrides, ...local };
      await firebase.firestoreModule.setDoc(
        collectionRef,
        {
          overrides: merged,
          updatedAt: firebase.firestoreModule.serverTimestamp(),
        },
        { merge: true },
      );
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      alert("기존 기록을 Firebase로 이전했습니다.");
      window.location.reload();
    } catch (error) {
      alert(`기존 기록을 이전하지 못했습니다.\n${error.message}`);
    }
  }

  function addCardBadges() {
    for (const card of document.querySelectorAll("#card-grid .pokemon-card")) {
      const item = normalizeOverride(remoteOverrides[String(parseNumber(card))]);
      const top = card.querySelector(".card-topline");
      card.querySelectorAll(".collection-mini-badge").forEach((node) => node.remove());
      card.classList.toggle("has-collection-record", Boolean(item));
      if (item?.quantity > 1) {
        const badge = document.createElement("span");
        badge.className = "collection-mini-badge";
        badge.textContent = `×${item.quantity}`;
        top?.append(badge);
      }
      if (item && ["trade", "sale"].includes(item.tradeStatus)) {
        const badge = document.createElement("span");
        badge.className = "collection-mini-badge collection-mini-badge--trade";
        badge.textContent = tradeLabels[item.tradeStatus];
        top?.append(badge);
      }
    }
  }

  function bindPageEvents() {
    document.addEventListener("click", (event) => {
      const cardButton = event.target.closest(".pokemon-card-button");
      if (cardButton) {
        const number = parseNumber(cardButton);
        queueMicrotask(() => fillEditor(number));
      }
      if (
        event.target.closest(
          "#status-filters, #generation-filters, #reset-filters, [data-reset]",
        )
      ) {
        clearTradeFilter();
      }
    });
    document.querySelector("#search-input")?.addEventListener("input", clearTradeFilter);
    document.querySelector("#sort-select")?.addEventListener("change", clearTradeFilter);
    const grid = document.querySelector("#card-grid");
    if (grid) {
      new MutationObserver(addCardBadges).observe(grid, { childList: true });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    createAuthUi();
    createManagementControls();
    createDialogEditor();
    bindPageEvents();
    addCardBadges();
    updateAuthUi();
  });

  initializeFirebase();
})();
