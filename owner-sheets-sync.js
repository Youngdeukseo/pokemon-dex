"use strict";

(function () {
  const SDK_VERSION = "12.16.0";
  const CONFIG = window.POKEMON_DEX_FIREBASE || {};
  const SHEETS = CONFIG.ownerSheets || {};
  const TOKEN_KEY = "pokemonDexOwnerSheetsTokenV1";
  const PENDING_KEY = "pokemonDexOwnerSheetsPendingV1";
  const LAST_SYNC_KEY = "pokemonDexOwnerSheetsLastSyncV1";
  const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
  const VALID_CATEGORIES = ["national", "pack", "artist", "series", "pokemon"];
  const DOCUMENT_IDS = {
    national: CONFIG.userDocument || "nationalDex",
    pack: "packDex",
    artist: "artistDex",
    series: "seriesDex",
    pokemon: "pokemonCollectionsDex",
  };
  const DATA_FILES = {
    pokedex: "./data/pokedex.json",
    artists: "./data/artists.json",
    series: "./data/series.json",
    pokemon: "./data/pokemon-collections.json",
    packs: "./packs.js",
  };

  let firebase = null;
  let currentUser = null;
  let catalogPromise = null;
  let rowMap = new Map();
  let busy = false;
  let pendingChanges = new Map();
  let changeTimer = null;

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isOwner(user) {
    return Boolean(
      user &&
        normalizeEmail(CONFIG.ownerEmail) &&
        normalizeEmail(user.email) === normalizeEmail(CONFIG.ownerEmail),
    );
  }

  function configured() {
    return Boolean(
      CONFIG.enabled &&
        CONFIG.config?.apiKey &&
        CONFIG.config?.projectId &&
        normalizeEmail(CONFIG.ownerEmail) &&
        SHEETS.enabled &&
        SHEETS.spreadsheetId &&
        SHEETS.sheetName,
    );
  }

  function storageGet(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // 세션 저장소를 사용할 수 없어도 현재 페이지 동기화는 계속합니다.
    }
  }

  function storageRemove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // 저장소 접근이 막힌 환경에서는 무시합니다.
    }
  }

  function readToken() {
    try {
      const parsed = JSON.parse(storageGet(TOKEN_KEY) || "null");
      if (
        parsed?.accessToken &&
        Number(parsed.expiresAt) > Date.now() + 60_000
      ) {
        return parsed.accessToken;
      }
    } catch {
      // 잘못된 토큰은 아래에서 정리합니다.
    }
    storageRemove(TOKEN_KEY);
    return "";
  }

  function writeToken(accessToken) {
    storageSet(
      TOKEN_KEY,
      JSON.stringify({
        accessToken,
        expiresAt: Date.now() + 50 * 60 * 1000,
      }),
    );
  }

  function setPending(value = true) {
    if (value) storageSet(PENDING_KEY, "1");
    else storageRemove(PENDING_KEY);
  }

  function hasPending() {
    return storageGet(PENDING_KEY) === "1";
  }

  function setLastSync() {
    storageSet(LAST_SYNC_KEY, String(Date.now()));
  }

  function shouldRunStartupSync() {
    const last = Number(storageGet(LAST_SYNC_KEY) || 0);
    return hasPending() || !last || Date.now() - last > 5 * 60 * 1000;
  }

  function sheetUrl() {
    return `https://docs.google.com/spreadsheets/d/${SHEETS.spreadsheetId}/edit`;
  }

  function createOwnerUi() {
    const authPanel = document.querySelector("#firebase-auth-panel");
    if (!authPanel || authPanel.querySelector("#owner-sheets-connect")) return;

    const status = document.createElement("span");
    status.id = "owner-sheets-status";
    status.className = "owner-sheets-status";
    status.textContent = "시트 미연결";

    const connect = document.createElement("button");
    connect.id = "owner-sheets-connect";
    connect.type = "button";
    connect.textContent = "Sheets 연결";
    connect.addEventListener("click", connectSheets);

    const sync = document.createElement("button");
    sync.id = "owner-sheets-sync";
    sync.type = "button";
    sync.textContent = "시트 동기화";
    sync.hidden = true;
    sync.addEventListener("click", () => void syncAll({ showAlert: true }));

    const link = document.createElement("a");
    link.id = "owner-sheets-link";
    link.className = "owner-sheets-link";
    link.href = sheetUrl();
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "시트 ↗";
    link.hidden = true;

    authPanel.append(status, connect, sync, link);
    updateOwnerUi();
  }

  function removeOwnerUi() {
    document
      .querySelectorAll(
        "#owner-sheets-status, #owner-sheets-connect, #owner-sheets-sync, #owner-sheets-link",
      )
      .forEach((element) => element.remove());
  }

  function setSyncStatus(message, state = "") {
    const status = document.querySelector("#owner-sheets-status");
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  function setUiBusy(value) {
    for (const button of document.querySelectorAll(
      "#owner-sheets-connect, #owner-sheets-sync",
    )) {
      button.disabled = value;
    }
  }

  function updateOwnerUi() {
    if (!isOwner(currentUser)) {
      removeOwnerUi();
      return;
    }

    const connect = document.querySelector("#owner-sheets-connect");
    const sync = document.querySelector("#owner-sheets-sync");
    const link = document.querySelector("#owner-sheets-link");
    if (!connect || !sync || !link) return;

    const connected = Boolean(readToken());
    connect.hidden = connected;
    sync.hidden = !connected;
    link.hidden = !connected;
    setSyncStatus(connected ? "Sheets 연결됨" : "시트 미연결", connected ? "connected" : "");
  }

  async function waitForAuthPanel(timeout = 10_000) {
    const existing = document.querySelector("#firebase-auth-panel");
    if (existing) return existing;

    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const panel = document.querySelector("#firebase-auth-panel");
        if (!panel) return;
        observer.disconnect();
        resolve(panel);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.setTimeout(() => {
        observer.disconnect();
        resolve(document.querySelector("#firebase-auth-panel"));
      }, timeout);
    });
  }

  async function connectSheets() {
    if (!firebase || !isOwner(currentUser)) return;

    const { authModule } = firebase;
    const provider = new authModule.GoogleAuthProvider();
    provider.addScope(SHEETS.scope || SHEETS_SCOPE);
    provider.setCustomParameters({
      prompt: "consent",
      login_hint: currentUser.email || "",
    });

    setUiBusy(true);
    setSyncStatus("권한 확인 중…", "loading");

    try {
      const result = await authModule.reauthenticateWithPopup(
        currentUser,
        provider,
      );
      const credential =
        authModule.GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error("Google Sheets 접근 토큰을 받지 못했습니다.");
      }

      writeToken(credential.accessToken);
      updateOwnerUi();
      await syncAll({ showAlert: true });
    } catch (error) {
      console.error("Google Sheets 연결 실패", error);
      if (
        error.code !== "auth/popup-closed-by-user" &&
        error.code !== "auth/cancelled-popup-request"
      ) {
        alert(
          error.code === "auth/user-mismatch"
            ? "현재 사이트에 로그인한 onesmemory@gmail.com 계정을 선택해주세요."
            : error.message || "Google Sheets 연결에 실패했습니다.",
        );
      }
      setSyncStatus("시트 연결 필요", "error");
    } finally {
      setUiBusy(false);
      updateOwnerUi();
    }
  }

  function quotedSheetName() {
    return `'${String(SHEETS.sheetName).replace(/'/g, "''")}'`;
  }

  async function sheetsRequest(path, options = {}) {
    const token = readToken();
    if (!token) throw new Error("Google Sheets 연결이 필요합니다.");

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS.spreadsheetId}${path}`,
      {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      },
    );

    if (response.ok) {
      if (response.status === 204) return {};
      return response.json().catch(() => ({}));
    }

    const payload = await response.json().catch(() => ({}));
    const message =
      payload?.error?.message ||
      `Google Sheets 요청에 실패했습니다. (${response.status})`;

    if (response.status === 401) {
      storageRemove(TOKEN_KEY);
      updateOwnerUi();
    }

    if (
      response.status === 403 &&
      /has not been used|disabled|accessNotConfigured/i.test(message)
    ) {
      throw new Error(
        "Google Sheets API가 아직 활성화되지 않았습니다. Firebase 프로젝트에서 Sheets API를 한 번 활성화한 뒤 다시 연결해주세요.",
      );
    }

    throw new Error(message);
  }

  function rangePath(range) {
    return encodeURIComponent(`${quotedSheetName()}!${range}`);
  }

  async function readSheetRows() {
    const maxRows = Number(SHEETS.maxRows) || 8000;
    const payload = await sheetsRequest(
      `/values/${rangePath(`A2:N${maxRows}`)}?majorDimension=ROWS`,
    );
    const values = Array.isArray(payload.values) ? payload.values : [];
    return values.map((row, index) => {
      const padded = Array.from({ length: 14 }, (_, column) => row[column] ?? "");
      return { rowNumber: index + 2, values: padded };
    });
  }

  async function replaceSheetRows(rows) {
    const maxRows = Number(SHEETS.maxRows) || 8000;
    if (rows.length > maxRows - 1) {
      throw new Error(
        `동기화 항목 ${rows.length}개가 시트 허용 범위를 초과했습니다.`,
      );
    }

    await sheetsRequest(`/values/${rangePath(`A2:N${maxRows}`)}:clear`, {
      method: "POST",
      body: "{}",
    });

    if (!rows.length) return;

    await sheetsRequest(
      `/values/${rangePath(`A2:N${rows.length + 1}`)}?valueInputOption=RAW`,
      {
        method: "PUT",
        body: JSON.stringify({
          range: `${quotedSheetName()}!A2:N${rows.length + 1}`,
          majorDimension: "ROWS",
          values: rows,
        }),
      },
    );

    rowMap = new Map(
      rows.map((row, index) => [
        `${row[0]}::${row[1]}`,
        index + 2,
      ]),
    );
  }

  async function writeSheetRow(rowNumber, row) {
    await sheetsRequest(
      `/values/${rangePath(`A${rowNumber}:N${rowNumber}`)}?valueInputOption=RAW`,
      {
        method: "PUT",
        body: JSON.stringify({
          range: `${quotedSheetName()}!A${rowNumber}:N${rowNumber}`,
          majorDimension: "ROWS",
          values: [row],
        }),
      },
    );
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${url} ${response.status}`);
    return response.json();
  }

  async function fetchPacks() {
    const response = await fetch(DATA_FILES.packs, { cache: "no-store" });
    if (!response.ok) throw new Error(`${DATA_FILES.packs} ${response.status}`);
    const source = await response.text();
    const packs = [];
    const pattern =
      /\["([^"]+)","([^"]+)","([^"]+)",([01])\]/g;
    let match;
    while ((match = pattern.exec(source))) {
      packs.push({
        era: match[1],
        name: match[2],
        code: match[3],
        legacyOwned: match[4] === "1",
      });
    }
    if (!packs.length) throw new Error("팩 목록을 읽지 못했습니다.");
    return packs;
  }

  async function loadCatalogs() {
    if (!catalogPromise) {
      catalogPromise = Promise.all([
        fetchJson(DATA_FILES.pokedex),
        fetchJson(DATA_FILES.artists),
        fetchJson(DATA_FILES.series),
        fetchJson(DATA_FILES.pokemon),
        fetchPacks(),
      ]).then(([pokedex, artists, series, pokemon, packs]) => ({
        pokedex,
        artists,
        series,
        pokemon,
        packs,
      }));
    }
    return catalogPromise;
  }

  function groupIdentity(group, groupIndex) {
    return String(group.code || group.name || group.title || groupIndex);
  }

  function pageCardIdentity(category, group, card, groupIndex, cardIndex) {
    const groupId = groupIdentity(group, groupIndex);
    if (category === "artist") {
      return [
        groupId,
        card.set || "",
        card.cardNumber || "",
        card.order ?? cardIndex,
      ].join("::");
    }
    if (category === "series") {
      return [
        groupId,
        card.code || card.meta || cardIndex,
        cardIndex,
      ].join("::");
    }
    return [
      groupId,
      card.meta || card.code || card.name || cardIndex,
      cardIndex,
    ].join("::");
  }

  function boolValue(value) {
    if (typeof value === "boolean") return value;
    return ["true", "1", "yes", "y", "보유"].includes(
      String(value || "").trim().toLowerCase(),
    );
  }

  function timestampDate(value) {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value.toDate();
    if (Number.isFinite(value?.seconds)) {
      return new Date(value.seconds * 1000);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function displayTimestamp(value) {
    const date = timestampDate(value);
    if (!date) return "";
    return date
      .toLocaleString("sv-SE", {
        timeZone: "Asia/Seoul",
        hour12: false,
      })
      .replace(",", "");
  }

  function overrideFor(data, key) {
    const overrides =
      data?.overrides && typeof data.overrides === "object"
        ? data.overrides
        : {};
    const item = overrides[key];
    return item && typeof item === "object" ? item : null;
  }

  function effectiveOwned(data, item, legacyOwned) {
    if (item) return Boolean(item.owned);
    return data?.baseMode === "legacy" && Boolean(legacyOwned);
  }

  function sourceLabel(item, owned) {
    if (item) return "사이트 입력";
    return owned ? "기존 도감" : "기본값";
  }

  function syncRow({
    category,
    key,
    group,
    name,
    owned,
    setCode = "",
    cardNumber = "",
    rarity = "",
    quantity = 0,
    imageUrl = "",
    note = "",
    updatedAt = "",
    source = "",
  }) {
    return [
      category,
      String(key),
      group,
      name,
      Boolean(owned),
      setCode,
      cardNumber,
      rarity,
      Number(quantity) || 0,
      imageUrl,
      note,
      false,
      displayTimestamp(updatedAt),
      source,
    ];
  }

  function buildNationalRows(catalog, data) {
    return (catalog.records || []).map((record) => {
      const key = String(record.number);
      const item = overrideFor(data, key);
      const owned = effectiveOwned(data, item, record.owned);
      return syncRow({
        category: "national",
        key,
        group: `${record.generation}세대`,
        name: item?.cardName || record.nameKo || record.nameEn || key,
        owned,
        setCode: item?.setCode || "",
        cardNumber: item?.cardNumber || "",
        rarity: item?.rarity || "",
        quantity: owned ? Math.max(1, Number(item?.quantity) || 1) : 0,
        imageUrl: item?.imageUrl || record.imageUrl || "",
        note: item?.note || "",
        updatedAt: item?.updatedAt || data?.updatedAt,
        source: sourceLabel(item, owned),
      });
    });
  }

  function buildPackRows(catalog, data) {
    const fallback = catalog
      .filter((pack) => pack.legacyOwned)
      .map((pack) => pack.code);
    const ownedCodes = new Set(
      (Array.isArray(data?.ownedCodes)
        ? data.ownedCodes
        : data?.baseMode === "legacy"
          ? fallback
          : []
      ).map((code) => String(code).toLowerCase()),
    );

    return catalog.map((pack) => {
      const owned = ownedCodes.has(pack.code.toLowerCase());
      return syncRow({
        category: "pack",
        key: pack.code,
        group: pack.era,
        name: pack.name,
        owned,
        quantity: owned ? 1 : 0,
        updatedAt: data?.updatedAt,
        source: data?.ownedCodes ? "사이트 입력" : sourceLabel(null, owned),
      });
    });
  }

  function groupsForCategory(category, catalogs) {
    if (category === "artist") return catalogs.artists.artists || [];
    if (category === "series") return catalogs.series || [];
    return catalogs.pokemon || [];
  }

  function collectionCardMeta(category, group, card, item) {
    if (category === "series") {
      return {
        setCode: group.code || "",
        cardNumber: card.code || card.meta || "",
        rarity: "",
        imageUrl: card.image || "",
      };
    }

    if (category === "artist") {
      return {
        setCode: item?.setCode || card.set || "",
        cardNumber: item?.cardNumber || card.cardNumber || "",
        rarity: card.rarity || "",
        imageUrl: item?.imageUrl || card.image || "",
      };
    }

    const meta = String(card.meta || "")
      .split("·")
      .map((part) => part.trim());
    return {
      setCode: item?.setCode || meta[2] || "",
      cardNumber: item?.cardNumber || meta[0] || "",
      rarity: meta[1] || "",
      imageUrl: item?.imageUrl || card.image || "",
    };
  }

  function buildCollectionRows(category, catalogs, data) {
    const rows = [];
    const groups = groupsForCategory(category, catalogs);
    groups.forEach((group, groupIndex) => {
      (group.cards || []).forEach((card, cardIndex) => {
        const key = pageCardIdentity(
          category,
          group,
          card,
          groupIndex,
          cardIndex,
        );
        const item = overrideFor(data, key);
        const owned = effectiveOwned(data, item, card.owned);
        const meta = collectionCardMeta(category, group, card, item);
        rows.push(
          syncRow({
            category,
            key,
            group: group.name || group.title || group.code || "",
            name: item?.cardName || card.name || card.code || card.meta || key,
            owned,
            setCode: meta.setCode,
            cardNumber: meta.cardNumber,
            rarity: meta.rarity,
            quantity: owned ? 1 : 0,
            imageUrl: meta.imageUrl,
            updatedAt: item?.updatedAt || data?.updatedAt,
            source: sourceLabel(item, owned),
          }),
        );
      });
    });
    return rows;
  }

  function buildRowsForCategory(category, catalogs, data) {
    if (category === "national") {
      return buildNationalRows(catalogs.pokedex, data);
    }
    if (category === "pack") {
      return buildPackRows(catalogs.packs, data);
    }
    return buildCollectionRows(category, catalogs, data);
  }

  async function documentRef(category) {
    const { db, firestoreModule } = firebase;
    return firestoreModule.doc(
      db,
      "users",
      currentUser.uid,
      CONFIG.userCollection || "collections",
      DOCUMENT_IDS[category],
    );
  }

  async function loadDocument(category) {
    const ref = await documentRef(category);
    const snapshot = await firebase.firestoreModule.getDoc(ref);
    return {
      ref,
      data: snapshot.exists()
        ? snapshot.data() || {}
        : { baseMode: isOwner(currentUser) ? "legacy" : "empty" },
    };
  }

  async function loadAllDocuments() {
    const entries = await Promise.all(
      VALID_CATEGORIES.map(async (category) => [
        category,
        await loadDocument(category),
      ]),
    );
    return Object.fromEntries(entries);
  }

  function validKeys(catalogs) {
    const keys = Object.fromEntries(
      VALID_CATEGORIES.map((category) => [category, new Set()]),
    );
    for (const record of catalogs.pokedex.records || []) {
      keys.national.add(String(record.number));
    }
    for (const pack of catalogs.packs) keys.pack.add(pack.code);
    for (const category of ["artist", "series", "pokemon"]) {
      groupsForCategory(category, catalogs).forEach((group, groupIndex) => {
        (group.cards || []).forEach((card, cardIndex) => {
          keys[category].add(
            pageCardIdentity(category, group, card, groupIndex, cardIndex),
          );
        });
      });
    }
    return keys;
  }

  async function applySheetChanges(sheetRows, catalogs, documents) {
    const keys = validKeys(catalogs);
    const changed = Object.fromEntries(
      VALID_CATEGORIES.map((category) => [category, []]),
    );
    let skipped = 0;

    for (const row of sheetRows) {
      const values = row.values;
      const category = String(values[0] || "").trim();
      const key = String(values[1] || "").trim();
      if (!boolValue(values[11])) continue;
      if (!VALID_CATEGORIES.includes(category) || !keys[category].has(key)) {
        skipped += 1;
        continue;
      }
      changed[category].push(values);
    }

    let applied = 0;
    for (const category of VALID_CATEGORIES) {
      const rows = changed[category];
      if (!rows.length) continue;

      const { ref, data } = documents[category];
      if (category === "pack") {
        const ownedCodes = new Set(
          Array.isArray(data.ownedCodes)
            ? data.ownedCodes
            : data.baseMode === "legacy"
              ? catalogs.packs
                  .filter((pack) => pack.legacyOwned)
                  .map((pack) => pack.code)
              : [],
        );
        for (const values of rows) {
          const key = String(values[1]);
          if (boolValue(values[4])) ownedCodes.add(key);
          else ownedCodes.delete(key);
        }
        await firebase.firestoreModule.setDoc(
          ref,
          {
            baseMode: data.baseMode === "empty" ? "empty" : "legacy",
            email: currentUser.email || "",
            displayName: currentUser.displayName || "",
            ownedCodes: [...ownedCodes],
            updatedAt: firebase.firestoreModule.serverTimestamp(),
          },
          { merge: true },
        );
        applied += rows.length;
        continue;
      }

      const overrides = {
        ...(data.overrides && typeof data.overrides === "object"
          ? data.overrides
          : {}),
      };
      for (const values of rows) {
        const key = String(values[1]);
        const owned = boolValue(values[4]);
        const existing =
          overrides[key] && typeof overrides[key] === "object"
            ? overrides[key]
            : {};
        const item = {
          ...existing,
          owned,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.email || currentUser.uid,
        };

        if (category === "national") {
          item.setCode = String(values[5] || "").trim();
          item.cardNumber = String(values[6] || "").trim();
          item.cardName = String(values[3] || "").trim();
          item.rarity = String(values[7] || "").trim();
          item.quantity = owned
            ? Math.max(1, Number(values[8]) || 1)
            : 0;
          item.imageUrl = String(values[9] || "").trim();
          item.imageSource = item.imageUrl
            ? existing.imageSource || "manual"
            : "";
          item.note = String(values[10] || "").trim();
        } else if (category !== "series") {
          item.setCode = String(values[5] || "").trim();
          item.cardNumber = String(values[6] || "").trim();
          item.cardName = String(values[3] || "").trim();
          item.imageUrl = String(values[9] || "").trim();
        }

        overrides[key] = item;
      }

      await firebase.firestoreModule.setDoc(
        ref,
        {
          baseMode: data.baseMode === "empty" ? "empty" : "legacy",
          email: currentUser.email || "",
          displayName: currentUser.displayName || "",
          overrides,
          updatedAt: firebase.firestoreModule.serverTimestamp(),
        },
        { merge: true },
      );
      applied += rows.length;
    }

    return { applied, skipped };
  }

  async function syncAll({ showAlert = false } = {}) {
    if (busy || !isOwner(currentUser)) return;
    if (!readToken()) {
      updateOwnerUi();
      if (showAlert) alert("먼저 Google Sheets 연결을 눌러주세요.");
      return;
    }

    busy = true;
    setUiBusy(true);
    setSyncStatus("동기화 중…", "loading");

    try {
      const [catalogs, documents, sheetRows] = await Promise.all([
        loadCatalogs(),
        loadAllDocuments(),
        readSheetRows(),
      ]);
      const { applied, skipped } = await applySheetChanges(
        sheetRows,
        catalogs,
        documents,
      );
      const nextDocuments = applied ? await loadAllDocuments() : documents;
      const rows = VALID_CATEGORIES.flatMap((category) =>
        buildRowsForCategory(category, catalogs, nextDocuments[category].data),
      );

      await replaceSheetRows(rows);
      setPending(false);
      setLastSync();
      setSyncStatus(`동기화 완료 · ${rows.length.toLocaleString()}개`, "success");

      if (showAlert) {
        const messages = [
          `Google Sheets 동기화가 완료되었습니다.\n총 ${rows.length.toLocaleString()}개 항목`,
        ];
        if (applied) messages.push(`시트 → 사이트 반영 ${applied}개`);
        if (skipped) messages.push(`식별값 오류로 건너뜀 ${skipped}개`);
        alert(messages.join("\n"));
      }

      if (applied) {
        window.setTimeout(() => window.location.reload(), 500);
      }
    } catch (error) {
      console.error("Google Sheets 동기화 실패", error);
      setSyncStatus("동기화 실패", "error");
      if (showAlert) alert(error.message || "동기화하지 못했습니다.");
    } finally {
      busy = false;
      setUiBusy(false);
      updateOwnerUi();
      if (pendingChanges.size) {
        window.clearTimeout(changeTimer);
        changeTimer = window.setTimeout(() => void flushChanges(), 800);
      }
    }
  }

  async function ensureRowMap() {
    if (rowMap.size) return;
    const rows = await readSheetRows();
    rowMap = new Map();
    for (const row of rows) {
      const category = String(row.values[0] || "").trim();
      const key = String(row.values[1] || "").trim();
      if (VALID_CATEGORIES.includes(category) && key) {
        rowMap.set(`${category}::${key}`, row.rowNumber);
      }
    }
  }

  async function syncChangedItem(category, key) {
    if (!VALID_CATEGORIES.includes(category) || !readToken()) return;
    const catalogs = await loadCatalogs();
    const document = await loadDocument(category);
    const rows = buildRowsForCategory(category, catalogs, document.data);
    const row = key
      ? rows.find((candidate) => String(candidate[1]) === String(key))
      : null;

    if (!row) {
      await syncAll();
      return;
    }

    await ensureRowMap();
    const rowNumber = rowMap.get(`${category}::${key}`);
    if (!rowNumber) {
      await syncAll();
      return;
    }

    await writeSheetRow(rowNumber, row);
    setPending(false);
    setLastSync();
    setSyncStatus("사이트 변경 저장됨", "success");
  }

  async function flushChanges() {
    if (busy || !isOwner(currentUser) || !readToken()) return;
    const changes = [...pendingChanges.entries()];
    pendingChanges.clear();
    if (!changes.length) return;

    try {
      for (const [identity, detail] of changes) {
        const [category, key] = identity.split("::", 2);
        await syncChangedItem(category, detail.key || key);
      }
    } catch (error) {
      console.warn("변경 항목 시트 기록 실패", error);
      setPending(true);
      setSyncStatus("다음 동기화 대기", "error");
    }
  }

  function scheduleChange(detail = {}) {
    const category = String(detail.category || "");
    const key = String(detail.key || "");
    if (!VALID_CATEGORIES.includes(category)) return;

    setPending(true);
    pendingChanges.set(`${category}::${key}`, { category, key });
    window.clearTimeout(changeTimer);
    changeTimer = window.setTimeout(() => void flushChanges(), 800);
  }

  async function firstAuthUser(auth, authModule) {
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      unsubscribe = authModule.onAuthStateChanged(
        auth,
        (user) => {
          unsubscribe();
          resolve(user || null);
        },
        reject,
      );
    });
  }

  async function initialize() {
    if (!configured()) return;

    try {
      const [appModule, authModule, firestoreModule] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`),
      ]);

      const app = appModule.getApps().length
        ? appModule.getApp()
        : appModule.initializeApp(CONFIG.config);
      const auth = authModule.getAuth(app);
      const db = firestoreModule.getFirestore(app);
      firebase = { auth, db, authModule, firestoreModule };
      currentUser = await firstAuthUser(auth, authModule);

      await waitForAuthPanel();
      if (!isOwner(currentUser)) return;

      createOwnerUi();
      updateOwnerUi();
      if (readToken() && shouldRunStartupSync()) {
        void syncAll();
      }
    } catch (error) {
      console.warn("소유자 Google Sheets 동기화 초기화 실패", error);
    }
  }

  window.addEventListener("pokemon-dex:collection-changed", (event) => {
    scheduleChange(event.detail || {});
  });

  window.PokemonDexOwnerSheets = {
    syncNow: () => syncAll({ showAlert: true }),
    scheduleChange,
    get connected() {
      return Boolean(readToken());
    },
  };

  initialize();
})();
