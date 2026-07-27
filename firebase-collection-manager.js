"use strict";

(function () {
  const SDK_VERSION = "12.16.0";
  const CONFIG = window.POKEMON_DEX_FIREBASE || {};
  const LOCAL_STORAGE_KEY = "pokemonDexCollectionOverridesV1";
  const EXPORT_FORMAT = "pokemon-dex-user-collection-v1";
  const originalFetch = window.fetch.bind(window);

  let firebase = null;
  let userDocumentRef = null;
  let currentUser = null;
  let accountProfile = null;
  let remoteOverrides = {};
  let currentNumber = null;
  let tradeMode = false;
  let snapshotStarted = false;
  let seriesCatalogPromise = null;
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

  function isOwnerAccount(user) {
    return Boolean(
      user &&
        normalizeEmail(CONFIG.ownerEmail) &&
        normalizeEmail(user.email) === normalizeEmail(CONFIG.ownerEmail),
    );
  }

  function configured() {
    const config = CONFIG.config || {};
    return Boolean(
      CONFIG.enabled &&
        config.apiKey &&
        config.authDomain &&
        config.projectId &&
        normalizeEmail(CONFIG.ownerEmail),
    );
  }

  function normalizeSetCode(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9-]/gi, "")
      .toUpperCase();
  }

  function normalizedCardNumber(value) {
    const numerator = String(value || "")
      .split("/")[0]
      .match(/\d{1,4}/)?.[0];
    return numerator ? numerator.padStart(3, "0") : "";
  }

  function normalizeCardName(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase("ko-KR")
      .replace(/[\s·._()\-]+/g, "");
  }

  function namesAreCompatible(inputName, catalogName) {
    const input = normalizeCardName(inputName);
    const catalog = normalizeCardName(catalogName);
    return (
      !input ||
      !catalog ||
      input === catalog ||
      input.includes(catalog) ||
      catalog.includes(input)
    );
  }

  function catalogCardNumber(card) {
    const value = String(card?.cardNumber || card?.code || card?.meta || "");
    const separator = value.lastIndexOf("_");
    return separator >= 0 ? value.slice(separator + 1) : value;
  }

  async function loadSeriesCatalog() {
    if (!seriesCatalogPromise) {
      seriesCatalogPromise = originalFetch("./data/series.json", {
        cache: "no-store",
      })
        .then((response) => {
          if (!response.ok) throw new Error(`series.json ${response.status}`);
          return response.json();
        })
        .catch((error) => {
          console.warn("시리즈 카드 목록을 불러오지 못했습니다.", error);
          return [];
        });
    }
    return seriesCatalogPromise;
  }

  async function lookupSeriesCard(setCode, cardNumber, cardName) {
    const normalizedSet = normalizeSetCode(setCode);
    const normalizedNumber = normalizedCardNumber(cardNumber);
    if (!normalizedSet || !normalizedNumber) return null;

    const groups = await loadSeriesCatalog();
    const group = groups.find(
      (candidate) =>
        normalizeSetCode(candidate.code || candidate.name) === normalizedSet,
    );
    if (!group) return null;

    const numberMatches = (group.cards || []).filter((card) => {
      const code = String(card.code || card.meta || "");
      const codeSet = code.includes("_") ? code.split("_")[0] : group.code;
      return (
        normalizeSetCode(codeSet) === normalizedSet &&
        normalizedCardNumber(catalogCardNumber(card)) === normalizedNumber
      );
    });
    if (!numberMatches.length) return null;

    const matched =
      numberMatches.find((card) => namesAreCompatible(cardName, card.name)) ||
      numberMatches[0];

    if (
      matched.name &&
      cardName &&
      !namesAreCompatible(cardName, matched.name)
    ) {
      throw new Error(
        `입력한 카드명(${cardName})과 검색된 카드명(${matched.name})이 다릅니다. 카드번호를 확인해주세요.`,
      );
    }

    return {
      imageUrl: matched.originalImage || matched.image || "",
      cardName: matched.name || cardName,
    };
  }

  function officialImageCandidates(setCode, cardNumber) {
    const code = normalizeSetCode(setCode);
    const number = normalizedCardNumber(cardNumber);
    if (!code || !number) return [];
    const typedCode = String(setCode || "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9-]/gi, "");
    const canonicalCode = typedCode
      .replace(/^sv/i, "SV")
      .replace(/^sm/i, "SM")
      .replace(/^xy/i, "XY")
      .replace(/^bw/i, "BW")
      .replace(/^m/i, "M")
      .replace(/^s/i, "S");
    const codeVariants = [canonicalCode, code].filter(
      (value, index, values) =>
        value && values.indexOf(value) === index,
    );

    let primaryRoot = "";
    if (code.startsWith("SV")) primaryRoot = "SV";
    else if (code.startsWith("SM")) primaryRoot = "SM";
    else if (code.startsWith("XY")) primaryRoot = "XY";
    else if (code.startsWith("BW")) primaryRoot = "BW";
    else if (/^M\d/.test(code)) primaryRoot = "MEGA";
    else if (code.startsWith("S")) primaryRoot = "S";

    const roots = [
      primaryRoot,
      "SV",
      "S",
      "MEGA",
      "SM",
      "XY",
      "BW",
    ].filter((root, index, values) => root && values.indexOf(root) === index);
    const base = "https://cards.image.pokemonkorea.co.kr/data/wmimages";

    return roots.flatMap((root) =>
      codeVariants.flatMap((candidateCode) => [
        `${base}/${root}/${candidateCode}/${candidateCode}_${number}.png`,
        `${base}/${root}/${candidateCode}/${candidateCode}_${number}.jpg`,
      ]),
    );
  }

  function imageLoads(url, timeout = 5000) {
    return new Promise((resolve) => {
      if (!url) {
        resolve(false);
        return;
      }

      let parsed;
      try {
        parsed = new URL(url, window.location.href);
      } catch {
        resolve(false);
        return;
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        resolve(false);
        return;
      }

      const probe = new Image();
      let settled = false;
      const finish = (success) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        probe.onload = null;
        probe.onerror = null;
        resolve(success);
      };
      const timer = window.setTimeout(() => finish(false), timeout);
      probe.onload = () => finish(probe.naturalWidth > 0);
      probe.onerror = () => finish(false);
      probe.src = parsed.href;
    });
  }

  async function findOwnedCardImage(setCode, cardNumber, cardName) {
    const catalogMatch = await lookupSeriesCard(
      setCode,
      cardNumber,
      cardName,
    );
    if (
      catalogMatch?.imageUrl &&
      (await imageLoads(catalogMatch.imageUrl))
    ) {
      return catalogMatch;
    }

    const candidates = officialImageCandidates(setCode, cardNumber);
    const results = await Promise.all(
      candidates.map(async (imageUrl) => ({
        imageUrl,
        loaded: await imageLoads(imageUrl),
      })),
    );
    const match = results.find((result) => result.loaded);
    return match ? { imageUrl: match.imageUrl, cardName } : null;
  }

  function setEditorMessage(message, state = "") {
    const element = document.querySelector("#collection-editor-message");
    if (!element) return;
    element.textContent = message;
    element.dataset.state = state;
  }

  function updateOwnedCardFields() {
    const editor = document.querySelector("#collection-editor");
    if (!editor) return;

    const owned = Boolean(editor.querySelector("#edit-owned")?.checked);
    editor.querySelectorAll("[data-owned-card-field]").forEach((field) => {
      field.disabled = !owned;
    });

    const save = editor.querySelector("#collection-save-card");
    if (save && !save.disabled) {
      save.textContent = owned ? "이미지 찾아 저장" : "미보유로 저장";
    }

    setEditorMessage(
      owned
        ? "세트 코드와 카드번호로 이미지를 자동 검색합니다."
        : "미보유로 저장하면 전국도감의 기본 대표 이미지로 돌아갑니다.",
    );
  }

  function canEdit() {
    return Boolean(currentUser && firebase && userDocumentRef);
  }

  function normalizeOverride(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const tradeStatus = Object.prototype.hasOwnProperty.call(
      tradeLabels,
      value.tradeStatus,
    )
      ? value.tradeStatus
      : "none";

    return {
      owned: Boolean(value.owned),
      setCode: String(value.setCode || "").trim(),
      cardNumber: String(value.cardNumber || "").trim(),
      cardName: String(value.cardName || "").trim(),
      rarity: String(value.rarity || "").trim(),
      quantity: Math.max(0, Number(value.quantity) || 0),
      tradeStatus,
      imageUrl: String(value.imageUrl || "").trim(),
      imageSource:
        value.imageSource === "auto" || value.imageSource === "manual"
          ? value.imageSource
          : value.imageUrl
            ? "manual"
            : "",
      note: String(value.note || "").trim(),
      updatedAt: value.updatedAt || null,
      updatedBy: String(value.updatedBy || "").trim(),
    };
  }

  function sanitizeOverrides(source) {
    const cleaned = {};
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return cleaned;
    }

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
    const records = data.records || [];
    const baseMode = currentUser ? accountProfile?.baseMode || "empty" : "public";

    for (const record of records) {
      record.originalImageUrl = record.imageUrl;
      record.actualSet = "";
      record.actualCardNumber = "";
      record.actualCardName = "";
      record.actualRarity = "";
      record.quantity = record.owned ? 1 : 0;
      record.tradeStatus = "none";
      record.collectionNote = "";

      if (baseMode === "empty") {
        record.owned = false;
        record.quantity = 0;
      }

      const item = normalizeOverride(remoteOverrides[String(record.number)]);
      if (!item) continue;

      record.owned = item.owned;
      record.actualSet = item.setCode;
      record.actualCardNumber = item.cardNumber;
      record.actualCardName = item.cardName;
      record.actualRarity = item.rarity;
      record.quantity = item.quantity;
      record.tradeStatus = item.tradeStatus;
      record.collectionNote = item.note;
      if (item.imageUrl) record.imageUrl = item.imageUrl;
    }

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

  window.fetch = async function accountManagedFetch(input, init) {
    const response = await originalFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";

    if (!response.ok || !/data\/pokedex\.json(?:$|[?#])/.test(url)) {
      return response;
    }

    try {
      await Promise.race([
        firebaseReady,
        new Promise((resolve) => window.setTimeout(resolve, 8000)),
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
      console.warn("계정별 도감 데이터를 적용하지 못했습니다.", error);
      return response;
    }
  };

  async function firstAuthUser(auth, authModule) {
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      unsubscribe = authModule.onAuthStateChanged(
        auth,
        (user) => {
          unsubscribe();
          resolve(user);
        },
        reject,
      );
    });
  }

  async function loadAccountDocument(user) {
    const { firestoreModule, db } = firebase;
    userDocumentRef = firestoreModule.doc(
      db,
      "users",
      user.uid,
      CONFIG.userCollection || "collections",
      CONFIG.userDocument || "nationalDex",
    );

    const snapshot = await firestoreModule.getDoc(userDocumentRef);
    if (snapshot.exists()) {
      const data = snapshot.data() || {};
      accountProfile = {
        baseMode: data.baseMode === "legacy" ? "legacy" : "empty",
        email: data.email || user.email || "",
      };
      remoteOverrides = sanitizeOverrides(data.overrides || {});
      return;
    }

    const baseMode = isOwnerAccount(user) ? "legacy" : "empty";
    accountProfile = { baseMode, email: user.email || "" };
    remoteOverrides = {};

    await firestoreModule.setDoc(userDocumentRef, {
      baseMode,
      email: user.email || "",
      displayName: user.displayName || "",
      overrides: {},
      createdAt: firestoreModule.serverTimestamp(),
      updatedAt: firestoreModule.serverTimestamp(),
    });
  }

  function subscribeToAccountDocument() {
    if (!userDocumentRef || snapshotStarted) return;
    snapshotStarted = true;
    let firstSnapshot = true;

    firebase.firestoreModule.onSnapshot(
      userDocumentRef,
      (snapshot) => {
        const data = snapshot.data() || {};
        const nextProfile = {
          baseMode: data.baseMode === "legacy" ? "legacy" : "empty",
          email: data.email || currentUser?.email || "",
        };
        const nextOverrides = sanitizeOverrides(data.overrides || {});
        const changed =
          JSON.stringify(nextProfile) !== JSON.stringify(accountProfile) ||
          JSON.stringify(nextOverrides) !== JSON.stringify(remoteOverrides);

        accountProfile = nextProfile;
        remoteOverrides = nextOverrides;

        if (!firstSnapshot && changed) window.location.reload();
        firstSnapshot = false;
      },
      (error) => {
        console.warn("개인 도감 실시간 동기화에 실패했습니다.", error);
      },
    );
  }

  async function initializeFirebase() {
    if (!configured()) {
      document.documentElement.classList.add("firebase-not-configured");
      resolveReady();
      updateAuthUi();
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

      firebase = { auth, db, authModule, firestoreModule };

      try {
        await authModule.getRedirectResult(auth);
      } catch (error) {
        console.warn("Google 로그인 리디렉션 결과를 확인하지 못했습니다.", error);
      }

      currentUser = await firstAuthUser(auth, authModule);
      if (currentUser) {
        await loadAccountDocument(currentUser);
        subscribeToAccountDocument();
      }

      resolveReady();
      updateAuthUi();
      updateAccountAccess();
      updateNotice();
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
    panel.classList.toggle("is-account", Boolean(currentUser));
    panel.classList.toggle("is-owner", isOwnerAccount(currentUser));

    if (!configured()) {
      status.textContent = "Firebase 설정 필요 · 공개 도감";
      login.hidden = true;
      logout.hidden = true;
      return;
    }

    if (error || document.documentElement.classList.contains("firebase-error")) {
      status.textContent = "Firebase 연결 오류 · 공개 도감";
      login.hidden = false;
      logout.hidden = true;
      return;
    }

    if (!currentUser) {
      status.textContent = "방문자 · 공개 도감";
      login.hidden = false;
      logout.hidden = true;
      return;
    }

    const name = currentUser.displayName || currentUser.email || "내 계정";
    const startLabel = accountProfile?.baseMode === "legacy" ? "기존 도감 유지" : "0종부터 시작";
    status.textContent = `${name} · ${startLabel}`;
    login.hidden = true;
    logout.hidden = false;
  }

    async function signIn() {
    if (!firebase) return;

    const { auth, authModule } = firebase;
    const provider = new authModule.GoogleAuthProvider();

    provider.setCustomParameters({
      prompt: "select_account",
    });

    try {
      await authModule.setPersistence(
        auth,
        authModule.browserLocalPersistence
      );

      await authModule.signInWithPopup(auth, provider);

      window.location.reload();
    } catch (error) {
      console.error("Google 로그인 오류:", error);

      if (error.code === "auth/popup-closed-by-user") {
        return;
      }

      let message = "Google 로그인에 실패했습니다.";

      if (error.code === "auth/popup-blocked") {
        message =
          "로그인 팝업이 차단되었습니다.\nChrome 또는 Safari에서 사이트를 직접 열고 팝업을 허용한 뒤 다시 시도하세요.";
      } else if (error.code === "auth/unauthorized-domain") {
        message =
          "Firebase 승인 도메인에 pokemon-dogam.github.io가 등록되지 않았습니다.";
      } else if (error.code === "auth/cancelled-popup-request") {
        message =
          "로그인 창이 이미 열려 있습니다. 열려 있는 Google 로그인 창을 확인하세요.";
      } else if (error.message) {
        message += `\n${error.message}`;
      }

      alert(message);
    }
  }

  async function signOutUser() {
    if (!firebase) return;
    await firebase.authModule.signOut(firebase.auth);
    window.location.reload();
  }

  function createManagementControls() {
    const actions = document.querySelector(".catalog-actions");
    if (!actions || actions.querySelector(".collection-manager-actions")) return;

    const wrap = document.createElement("div");
    wrap.className = "collection-manager-actions";
    wrap.append(
      makeButton("미보유 목록", "manager-button", showMissing),
      makeButton("교환 가능", "manager-button", showTradeable),
      makeButton("내 도감 백업", "manager-button account-only-control", exportData),
      makeButton("기존 기록 이전", "manager-button account-only-control", migrateLocalData),
    );
    actions.append(wrap);

    const notice = document.createElement("div");
    notice.id = "collection-account-notice";
    notice.className = "collection-manager-notice";
    document.querySelector(".filter-panel")?.before(notice);
    updateNotice();
  }

  function updateNotice() {
    const notice = document.querySelector("#collection-account-notice");
    if (!notice) return;

    if (!configured()) {
      notice.innerHTML =
        "<strong>Firebase 연결 대기</strong><span>설정값을 연결하면 Google 계정별 개인 도감이 활성화됩니다.</span>";
      return;
    }

    if (!currentUser) {
      notice.innerHTML =
        "<strong>계정별 개인 도감</strong><span>Google 로그인 후 자신의 보유 카드만 수정할 수 있습니다. 다른 사용자의 데이터에는 접근할 수 없습니다.</span>";
      return;
    }

    const description = accountProfile?.baseMode === "legacy"
      ? "현재 전국도감 보유 상태를 그대로 이어서 사용하는 소유자 계정입니다."
      : "새 계정으로 생성되어 모든 포켓몬이 미보유 상태에서 시작합니다.";
    notice.innerHTML = `<strong>내 개인 도감</strong><span>${description}</span>`;
  }

  function createDialogEditor() {
    const dialog = document.querySelector("#card-dialog");
    const details = dialog?.querySelector(".dialog-details");
    if (!dialog || !details || dialog.querySelector("#collection-editor")) return;

    const rows = [
      ["실제 세트", "dialog-actual-set"],
      ["실제 카드번호", "dialog-actual-number"],
      ["실제 카드명", "dialog-actual-name"],
      ["레어도", "dialog-actual-rarity"],
      ["수량", "dialog-actual-quantity"],
      ["교환 상태", "dialog-trade-status"],
    ];

    for (const [label, id] of rows) {
      const row = document.createElement("div");
      row.className = "collection-detail-row";
      row.innerHTML = `<dt>${label}</dt><dd id="${id}">—</dd>`;
      details.append(row);
    }

    const editor = document.createElement("section");
    editor.id = "collection-editor";
    editor.className = "collection-editor account-only-control";
    editor.innerHTML = `
      <div class="collection-editor-heading">
        <div><span>MY CARD RECORD</span><strong>내 실제 보유 카드 입력</strong></div>
        <label class="owned-switch"><input id="edit-owned" type="checkbox" /><span>보유</span></label>
      </div>
      <div class="collection-editor-grid">
        <label><span>세트 코드</span><input id="edit-set-code" data-owned-card-field type="text" placeholder="예: sv2a" /></label>
        <label><span>카드번호</span><input id="edit-card-number" data-owned-card-field type="text" placeholder="예: 025/165" /></label>
        <label class="collection-editor-wide"><span>카드명</span><input id="edit-card-name" data-owned-card-field type="text" placeholder="예: 피카츄" /></label>
        <label><span>레어도</span><input id="edit-rarity" data-owned-card-field type="text" placeholder="예: C, AR, SAR" /></label>
        <label><span>수량</span><input id="edit-quantity" data-owned-card-field type="number" min="0" max="999" inputmode="numeric" /></label>
        <label class="collection-editor-wide"><span>교환 상태</span><select id="edit-trade-status" data-owned-card-field><option value="none">없음</option><option value="duplicate">중복 보유</option><option value="trade">교환 가능</option><option value="sale">판매 가능</option><option value="reserved">예약 중</option></select></label>
        <details class="manual-image-fallback collection-editor-wide">
          <summary>자동 검색이 안 될 때 이미지 URL 직접 입력</summary>
          <label><span>실제 카드 이미지 URL</span><input id="edit-image-url" data-owned-card-field type="url" inputmode="url" placeholder="https://..." /></label>
          <p>자동 검색을 먼저 시도하며, 카드를 찾지 못했을 때만 이 주소를 사용합니다.</p>
        </details>
        <label class="collection-editor-wide"><span>메모</span><textarea id="edit-note" rows="2" placeholder="구매처, 카드 상태, 보관 위치 등"></textarea></label>
      </div>
      <p id="collection-editor-message" class="collection-editor-message"></p>
      <div class="collection-editor-actions">
        <button id="collection-reset-card" class="manager-button manager-button--danger" type="button">이 카드 입력 초기화</button>
        <button id="collection-save-card" class="primary-button" type="button">이미지 찾아 저장</button>
      </div>
      <p class="collection-save-hint">자동으로 찾은 이미지와 입력 내용은 로그인한 Google 계정에만 저장됩니다.</p>
    `;

    details.after(editor);
    editor.querySelector("#collection-save-card")?.addEventListener("click", saveCurrent);
    editor.querySelector("#collection-reset-card")?.addEventListener("click", resetCurrent);
    editor.querySelector("#edit-owned")?.addEventListener("change", (event) => {
      const quantity = editor.querySelector("#edit-quantity");
      if (event.currentTarget.checked && Number(quantity.value) < 1) quantity.value = "1";
      if (!event.currentTarget.checked) quantity.value = "0";
      updateOwnedCardFields();
    });
    updateOwnedCardFields();
    updateAccountAccess();
  }

  function updateAccountAccess() {
    document.querySelectorAll(".account-only-control").forEach((element) => {
      element.hidden = !canEdit();
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
    setValue(
      "#edit-card-name",
      item?.cardName || dialog.querySelector("#dialog-name-ko")?.textContent || "",
    );
    setValue("#edit-rarity", item?.rarity || "");
    setValue("#edit-quantity", item ? item.quantity : owned ? 1 : 0);
    setValue("#edit-trade-status", item?.tradeStatus || "none");
    setValue(
      "#edit-image-url",
      item?.imageSource === "manual" ? item.imageUrl : "",
    );
    setValue("#edit-note", item?.note || "");
    setText("#dialog-actual-set", item?.setCode);
    setText("#dialog-actual-number", item?.cardNumber);
    setText("#dialog-actual-name", item?.cardName);
    setText("#dialog-actual-rarity", item?.rarity);
    setText("#dialog-actual-quantity", item ? `${item.quantity}장` : owned ? "1장" : "0장");
    setText("#dialog-trade-status", tradeLabels[item?.tradeStatus || "none"]);
    const manualDetails = dialog.querySelector(".manual-image-fallback");
    if (manualDetails) {
      manualDetails.open = Boolean(
        item?.imageSource === "manual" && item.imageUrl,
      );
    }
    updateOwnedCardFields();
  }

  function requireAccount() {
    if (!canEdit()) {
      alert("Google 계정으로 로그인해야 내 도감을 수정할 수 있습니다.");
      return false;
    }
    return true;
  }

  async function writeAccountOverrides(nextOverrides) {
    await firebase.firestoreModule.setDoc(
      userDocumentRef,
      {
        baseMode: accountProfile?.baseMode || "empty",
        email: currentUser.email || "",
        displayName: currentUser.displayName || "",
        overrides: nextOverrides,
        updatedAt: firebase.firestoreModule.serverTimestamp(),
      },
      { merge: true },
    );
  }

  async function saveCurrent() {
    if (!currentNumber || !requireAccount()) return;

    const dialog = document.querySelector("#card-dialog");
    const saveButton = dialog.querySelector("#collection-save-card");
    const owned = dialog.querySelector("#edit-owned").checked;
    const setCode = dialog.querySelector("#edit-set-code").value.trim();
    const cardNumber = dialog.querySelector("#edit-card-number").value.trim();
    const cardName = dialog.querySelector("#edit-card-name").value.trim();
    const manualImageUrl = dialog.querySelector("#edit-image-url").value.trim();
    let quantity = Math.max(0, Number(dialog.querySelector("#edit-quantity").value) || 0);
    if (owned && quantity < 1) quantity = 1;
    if (!owned) quantity = 0;

    if (
      owned &&
      (!normalizeSetCode(setCode) ||
        !normalizedCardNumber(cardNumber) ||
        !cardName)
    ) {
      setEditorMessage(
        "보유 카드의 세트 코드, 카드번호, 카드명을 모두 입력해주세요.",
        "error",
      );
      return;
    }

    let imageUrl = "";
    let imageSource = "";
    const item = {
      owned,
      setCode: owned ? setCode : "",
      cardNumber: owned ? cardNumber : "",
      cardName: owned ? cardName : "",
      rarity: owned ? dialog.querySelector("#edit-rarity").value.trim() : "",
      quantity,
      tradeStatus: owned
        ? dialog.querySelector("#edit-trade-status").value
        : "none",
      imageUrl,
      imageSource,
      note: dialog.querySelector("#edit-note").value.trim(),
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.email || currentUser.uid,
    };

    saveButton.disabled = true;
    saveButton.textContent = owned ? "카드 찾는 중…" : "저장 중…";

    try {
      if (owned) {
        setEditorMessage(
          "세트 코드와 카드번호로 카드 이미지를 자동 검색하고 있습니다.",
          "loading",
        );
        const found = await findOwnedCardImage(setCode, cardNumber, cardName);

        if (found) {
          imageUrl = found.imageUrl;
          imageSource = "auto";
        } else if (manualImageUrl) {
          setEditorMessage(
            "자동 검색 결과가 없어 입력한 이미지 URL을 확인하고 있습니다.",
            "loading",
          );
          if (!(await imageLoads(manualImageUrl))) {
            throw new Error(
              "자동 검색과 직접 입력한 URL 모두에서 이미지를 불러오지 못했습니다.",
            );
          }
          imageUrl = manualImageUrl;
          imageSource = "manual";
        } else {
          const manualDetails = dialog.querySelector(".manual-image-fallback");
          if (manualDetails) manualDetails.open = true;
          throw new Error(
            "카드를 자동으로 찾지 못했습니다. 세트 코드와 카드번호를 확인하거나 이미지 URL을 직접 입력해주세요.",
          );
        }
      }

      item.imageUrl = imageUrl;
      item.imageSource = imageSource;
      await writeAccountOverrides({
        ...remoteOverrides,
        [String(currentNumber)]: item,
      });
      window.location.reload();
    } catch (error) {
      console.error(error);
      setEditorMessage(error.message || "저장하지 못했습니다.", "error");
      saveButton.disabled = false;
      saveButton.textContent = owned ? "이미지 찾아 저장" : "미보유로 저장";
    }
  }

  async function resetCurrent() {
    if (!currentNumber || !requireAccount()) return;
    if (!remoteOverrides[String(currentNumber)]) return;
    if (!confirm("이 포켓몬에 입력한 내 카드 정보를 초기화할까요?")) return;

    const next = { ...remoteOverrides };
    delete next[String(currentNumber)];

    try {
      await writeAccountOverrides(next);
      window.location.reload();
    } catch (error) {
      alert(`초기화하지 못했습니다.\n${error.message}`);
    }
  }

  function showMissing() {
    tradeMode = false;
    clearTradeFilter();
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
    applyCardEnhancements();
    document.querySelector("#card-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearTradeFilter() {
    document.querySelectorAll("#card-grid .collection-manager-hidden").forEach((card) => {
      card.classList.remove("collection-manager-hidden");
    });
  }

  function exportData() {
    if (!requireAccount()) return;

    const payload = {
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      accountEmail: currentUser.email || "",
      baseMode: accountProfile?.baseMode || "empty",
      recordCount: Object.keys(remoteOverrides).length,
      overrides: remoteOverrides,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pokemon-dex-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function readLocalOverrides() {
    try {
      return sanitizeOverrides(
        JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "{}"),
      );
    } catch {
      return {};
    }
  }

  async function migrateLocalData() {
    if (!requireAccount()) return;

    const local = readLocalOverrides();
    const count = Object.keys(local).length;
    if (!count) {
      alert("이 브라우저에 이전할 기존 기록이 없습니다.");
      return;
    }

    if (!confirm(`이 브라우저의 기존 기록 ${count}개를 현재 Google 계정으로 이전할까요?`)) {
      return;
    }

    try {
      await writeAccountOverrides({ ...remoteOverrides, ...local });
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      alert("기존 기록을 현재 계정의 개인 도감으로 이전했습니다.");
      window.location.reload();
    } catch (error) {
      alert(`기존 기록을 이전하지 못했습니다.\n${error.message}`);
    }
  }

  function applyCardEnhancements() {
    let tradeCount = 0;

    for (const card of document.querySelectorAll("#card-grid .pokemon-card")) {
      const item = normalizeOverride(remoteOverrides[String(parseNumber(card))]);
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

      const tradeable = item && ["trade", "sale"].includes(item.tradeStatus);
      card.classList.toggle("collection-manager-hidden", tradeMode && !tradeable);
      card.classList.toggle("has-collection-record", Boolean(item));
    }

    if (tradeMode) {
      const result = document.querySelector("#result-count");
      const label = document.querySelector("#active-filter-label");
      if (result) result.textContent = String(tradeCount);
      if (label) label.textContent = "· 내 교환·판매 가능";
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
        tradeMode = false;
        clearTradeFilter();
      }
    });

    document.querySelector("#search-input")?.addEventListener("input", () => {
      tradeMode = false;
      clearTradeFilter();
    });
    document.querySelector("#sort-select")?.addEventListener("change", () => {
      tradeMode = false;
      clearTradeFilter();
    });

    const grid = document.querySelector("#card-grid");
    if (grid) {
      new MutationObserver(() => {
        window.setTimeout(applyCardEnhancements, 0);
      }).observe(grid, { childList: true });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    createAuthUi();
    createManagementControls();
    createDialogEditor();
    bindPageEvents();
    updateAuthUi();
    updateAccountAccess();
    updateNotice();
    applyCardEnhancements();
  });

  initializeFirebase();
})();
