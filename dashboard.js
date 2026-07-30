"use strict";

(function () {
  const SDK_VERSION = "12.16.0";
  const CONFIG = window.POKEMON_DEX_FIREBASE || {};
  const CATEGORY_ORDER = [
    "national",
    "pack",
    "artist",
    "series",
    "pokemon",
    "ar",
  ];
  const CATEGORY_META = {
    national: {
      number: "01",
      title: "전국도감",
      description: "1세대부터 9세대까지",
      href: "./national.html",
      unit: "종",
    },
    pack: {
      number: "02",
      title: "팩 전종수집",
      description: "S · SV · M 확장팩",
      href: "./packs.html",
      unit: "팩",
    },
    artist: {
      number: "03",
      title: "작가 도감",
      description: "일러스트레이터별 카드",
      href: "./artists.html",
      unit: "장",
    },
    series: {
      number: "04",
      title: "시리즈 도감",
      description: "확장팩별 카드 목록",
      href: "./series.html",
      unit: "장",
    },
    pokemon: {
      number: "05",
      title: "포켓몬 컬렉션",
      description: "좋아하는 포켓몬별 카드",
      href: "./pokemon-collections.html",
      unit: "장",
    },
    ar: {
      number: "06",
      title: "AR 전종도감",
      description: "SV 시리즈 AR 406장",
      href: "./ar.html",
      unit: "장",
    },
  };
  const DOCUMENT_IDS = {
    national: CONFIG.userDocument || "nationalDex",
    pack: "packDex",
    artist: "artistDex",
    series: "seriesDex",
    pokemon: "pokemonCollectionsDex",
    ar: "arDex",
  };

  const elements = {
    headerChip: document.querySelector(".header-chip"),
    rate: document.querySelector("#dashboard-rate"),
    owned: document.querySelector("#dashboard-owned"),
    total: document.querySelector("#dashboard-total"),
    missing: document.querySelector("#dashboard-missing"),
    ring: document.querySelector("#dashboard-progress-ring"),
    statOwned: document.querySelector("#stat-dashboard-owned"),
    statMissing: document.querySelector("#stat-dashboard-missing"),
    statCompleteGroups: document.querySelector("#stat-dashboard-complete-groups"),
    accountNote: document.querySelector("#dashboard-account-note"),
    loginCta: document.querySelector("#dashboard-login-cta"),
    collectionGrid: document.querySelector("#dashboard-collection-grid"),
    nearestList: document.querySelector("#dashboard-nearest-list"),
    nearestEmpty: document.querySelector("#dashboard-nearest-empty"),
    nearestCount: document.querySelector("#nearest-count"),
    recentList: document.querySelector("#dashboard-recent-list"),
    recentEmpty: document.querySelector("#dashboard-recent-empty"),
    error: document.querySelector("#dashboard-error"),
  };

  let firebase = null;
  let currentUser = null;
  let sharedViewActive = false;
  let catalogs = null;
  let documents = Object.fromEntries(CATEGORY_ORDER.map((key) => [key, null]));
  let documentReadFailed = false;
  let unsubscribeDocuments = [];

  function preserveLegacyNationalLinks() {
    const params = new URLSearchParams(window.location.search);
    if (params.has("pokemon") || window.location.hash === "#national-dex") {
      const target = new URL("./national.html", window.location.href);
      target.search = window.location.search;
      window.location.replace(target.href);
      return true;
    }
    return false;
  }

  if (preserveLegacyNationalLinks()) return;

  function formatNumber(value) {
    return new Intl.NumberFormat("ko-KR").format(Number(value) || 0);
  }

  function percentage(owned, total) {
    return total ? Number(((owned / total) * 100).toFixed(1)) : 0;
  }

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
    const config = CONFIG.config || {};
    return Boolean(
      CONFIG.enabled &&
        config.apiKey &&
        config.authDomain &&
        config.projectId,
    );
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

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${url} ${response.status}`);
    return response.json();
  }

  async function fetchPacks() {
    const response = await fetch("./packs.js", { cache: "no-store" });
    if (!response.ok) throw new Error(`./packs.js ${response.status}`);
    const source = await response.text();
    const result = [];
    const pattern = /\["([^"]+)","([^"]+)","([^"]+)",([01])\]/g;
    let match;

    while ((match = pattern.exec(source))) {
      result.push({
        era: match[1],
        name: match[2],
        code: match[3],
        legacyOwned: match[4] === "1",
      });
    }

    if (!result.length) throw new Error("팩도감 목록을 확인하지 못했습니다.");
    return result;
  }

  function createCategory(key, items, groups) {
    return {
      key,
      ...CATEGORY_META[key],
      items,
      groups,
      itemMap: new Map(items.map((item) => [item.key, item])),
    };
  }

  function buildCatalogs(
    pokedex,
    artistData,
    seriesData,
    pokemonData,
    arData,
    packData,
  ) {
    const nationalItems = pokedex.records.map((record) => ({
      key: String(record.number),
      name: record.nameKo,
      group: `${record.generation}세대`,
      baselineOwned: Boolean(record.owned),
    }));
    const nationalGroups = (pokedex.generations || []).map((generation) => ({
      key: `generation-${generation.generation}`,
      name: `${generation.generation}세대 전국도감`,
      itemKeys: nationalItems
        .filter((item) => item.group === `${generation.generation}세대`)
        .map((item) => item.key),
    }));

    const packItems = packData.map((pack) => ({
      key: pack.code,
      name: pack.name,
      group: `${pack.era} 시리즈`,
      baselineOwned: Boolean(pack.legacyOwned),
    }));
    const packGroups = [...new Set(packData.map((pack) => pack.era))].map((era) => ({
      key: `pack-${era}`,
      name: `${era} 팩 컬렉션`,
      itemKeys: packItems
        .filter((item) => item.group === `${era} 시리즈`)
        .map((item) => item.key),
    }));

    const artistItems = [];
    const artistGroups = (artistData.artists || []).map((group, groupIndex) => {
      const itemKeys = (group.cards || []).map((card, cardIndex) => {
        const key = pageCardIdentity("artist", group, card, groupIndex, cardIndex);
        artistItems.push({
          key,
          name: card.name || "이름 미상 카드",
          group: group.name,
          baselineOwned: Boolean(card.owned),
        });
        return key;
      });
      return { key: groupIdentity(group, groupIndex), name: group.name, itemKeys };
    });

    const seriesItems = [];
    const seriesGroups = (seriesData || []).map((group, groupIndex) => {
      const itemKeys = (group.cards || []).map((card, cardIndex) => {
        const key = pageCardIdentity("series", group, card, groupIndex, cardIndex);
        seriesItems.push({
          key,
          name: card.name || card.pokemonName || card.code || `${group.code} 카드`,
          group: group.code || group.title,
          baselineOwned: Boolean(card.owned),
        });
        return key;
      });
      return {
        key: groupIdentity(group, groupIndex),
        name: `${group.code || ""} ${group.title || ""}`.trim(),
        itemKeys,
      };
    });

    const pokemonItems = [];
    const pokemonGroups = (pokemonData || []).map((group, groupIndex) => {
      const itemKeys = (group.cards || []).map((card, cardIndex) => {
        const key = pageCardIdentity("pokemon", group, card, groupIndex, cardIndex);
        pokemonItems.push({
          key,
          name: card.name || group.name,
          group: group.name,
          baselineOwned: Boolean(card.owned),
        });
        return key;
      });
      return { key: groupIdentity(group, groupIndex), name: group.name, itemKeys };
    });

    const arItems = [];
    const arGroups = (arData || []).map((group, groupIndex) => {
      const itemKeys = (group.cards || []).map((card, cardIndex) => {
        const key = pageCardIdentity("ar", group, card, groupIndex, cardIndex);
        arItems.push({
          key,
          name: card.name || card.code || `${group.code} AR`,
          group: `${group.code} · ${group.title}`,
          baselineOwned: Boolean(card.owned),
        });
        return key;
      });
      return {
        key: groupIdentity(group, groupIndex),
        name: `${group.code} · ${group.title}`,
        itemKeys,
      };
    });

    return {
      national: createCategory("national", nationalItems, nationalGroups),
      pack: createCategory("pack", packItems, packGroups),
      artist: createCategory("artist", artistItems, artistGroups),
      series: createCategory("series", seriesItems, seriesGroups),
      pokemon: createCategory("pokemon", pokemonItems, pokemonGroups),
      ar: createCategory("ar", arItems, arGroups),
    };
  }

  async function loadCatalogs() {
    const [pokedex, artists, series, pokemon, ar, packs] = await Promise.all([
      fetchJson("./data/pokedex.json"),
      fetchJson("./data/artists.json"),
      fetchJson("./data/series.json"),
      fetchJson("./data/pokemon-collections.json"),
      fetchJson("./data/ar.json"),
      fetchPacks(),
    ]);
    return buildCatalogs(pokedex, artists, series, pokemon, ar, packs);
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
    elements.loginCta?.addEventListener("click", signIn);
    updateAuthUi();
  }

  function updateAuthUi(error = null) {
    const panel = document.querySelector("#firebase-auth-panel");
    if (!panel) return;
    const status = panel.querySelector("#firebase-auth-status");
    const login = panel.querySelector("#firebase-login");
    const logout = panel.querySelector("#firebase-logout");
    const shared = window.PokemonDexSharedReadonly;
    sharedViewActive = Boolean(shared?.updateControl?.(currentUser));

    panel.classList.toggle("is-account", Boolean(currentUser));
    panel.classList.toggle("is-owner", isOwner(currentUser));
    if (elements.headerChip) {
      elements.headerChip.textContent = sharedViewActive
        ? "READ ONLY"
        : currentUser
          ? "SIGNED IN"
          : "PUBLIC VIEW";
    }

    if (!configured()) {
      status.textContent = "Firebase 설정 필요 · 공개 도감";
      login.hidden = true;
      logout.hidden = true;
      return;
    }

    if (error) {
      status.textContent = "Firebase 연결 오류 · 공개 도감";
      login.hidden = false;
      logout.hidden = true;
      return;
    }

    if (!currentUser) {
      status.textContent = "방문자";
      login.hidden = false;
      logout.hidden = true;
      return;
    }

    status.textContent = sharedViewActive
      ? `${shared.buttonLabel()} · 읽기 전용`
      : currentUser.displayName || currentUser.email || "내 계정";
    login.hidden = true;
    logout.hidden = false;
  }

  function firstAuthUser(auth, authModule) {
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

  async function signIn() {
    if (!firebase) {
      alert("로그인 기능을 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    const login = document.querySelector("#firebase-login");
    if (login) {
      login.disabled = true;
      login.textContent = "로그인 중…";
    }
    const provider = new firebase.authModule.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    try {
      await firebase.authModule.signInWithPopup(firebase.auth, provider);
      window.location.reload();
    } catch (error) {
      if (login) {
        login.disabled = false;
        login.textContent = "Google 로그인";
      }
      if (error.code === "auth/popup-closed-by-user") return;

      let message = "Google 로그인에 실패했습니다.";
      if (error.code === "auth/popup-blocked") {
        message =
          "로그인 팝업이 차단되었습니다.\nChrome 또는 Safari에서 사이트를 직접 열고 다시 시도하세요.";
      } else if (error.code === "auth/unauthorized-domain") {
        message =
          "Firebase 승인 도메인에 pokemon-dogam.github.io가 등록되지 않았습니다.";
      } else if (error.message) {
        message += `\n${error.message}`;
      }
      alert(message);
    }
  }

  async function signOutUser() {
    if (!firebase) return;
    window.PokemonDexSharedReadonly?.clear?.();
    await firebase.authModule.signOut(firebase.auth);
    window.location.reload();
  }

  async function initializeFirebase() {
    createAuthUi();
    if (!configured()) {
      updateAuthUi();
      return;
    }

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

      try {
        await authModule.setPersistence(auth, authModule.browserLocalPersistence);
      } catch (error) {
        console.warn("로그인 유지 설정에 실패했습니다.", error);
      }

      firebase = { auth, db, authModule, firestoreModule };
      currentUser = await firstAuthUser(auth, authModule);
      await window.PokemonDexSharedReadonly?.ensureOwnerShare?.(
        db,
        firestoreModule,
        currentUser,
      );
      updateAuthUi();
    } catch (error) {
      console.error("대시보드 Firebase 초기화 실패", error);
      updateAuthUi(error);
      elements.error.hidden = false;
    }
  }

  async function loadUserDocuments() {
    documents = Object.fromEntries(CATEGORY_ORDER.map((key) => [key, null]));
    documentReadFailed = false;
    if (!currentUser || !firebase) return;

    if (sharedViewActive) {
      try {
        const ownerDocuments =
          await window.PokemonDexSharedReadonly.loadOwnerDocuments(
            firebase.db,
            firebase.firestoreModule,
          );
        documents = Object.fromEntries(
          CATEGORY_ORDER.map((category) => [
            category,
            ownerDocuments.get(DOCUMENT_IDS[category])?.data || null,
          ]),
        );
      } catch (error) {
        documentReadFailed = true;
        console.warn("읽기 전용 공유 도감을 불러오지 못했습니다.", error);
      }
      return;
    }

    const reads = CATEGORY_ORDER.map(async (category) => {
      const reference = firebase.firestoreModule.doc(
        firebase.db,
        "users",
        currentUser.uid,
        CONFIG.userCollection || "collections",
        DOCUMENT_IDS[category],
      );
      try {
        const snapshot = await firebase.firestoreModule.getDoc(reference);
        return [category, snapshot.exists() ? snapshot.data() || {} : null];
      } catch (error) {
        documentReadFailed = true;
        console.warn(`${DOCUMENT_IDS[category]} 문서를 읽지 못했습니다.`, error);
        return [category, null];
      }
    });

    documents = Object.fromEntries(await Promise.all(reads));
  }

  function subscribeToDocuments() {
    unsubscribeDocuments.forEach((unsubscribe) => unsubscribe());
    unsubscribeDocuments = [];
    if (!currentUser || !firebase || sharedViewActive) return;

    for (const category of CATEGORY_ORDER) {
      const reference = firebase.firestoreModule.doc(
        firebase.db,
        "users",
        currentUser.uid,
        CONFIG.userCollection || "collections",
        DOCUMENT_IDS[category],
      );
      const unsubscribe = firebase.firestoreModule.onSnapshot(
        reference,
        (snapshot) => {
          documents[category] = snapshot.exists() ? snapshot.data() || {} : null;
          if (catalogs) renderDashboard();
        },
        (error) => {
          documentReadFailed = true;
          console.warn(`${DOCUMENT_IDS[category]} 실시간 업데이트 실패`, error);
        },
      );
      unsubscribeDocuments.push(unsubscribe);
    }
  }

  function overrideOwned(value) {
    if (typeof value === "boolean") return value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return Boolean(value.owned);
  }

  function applyOwnership(category) {
    const catalog = catalogs[category];
    const document = documents[category] || {};
    const fallbackMode = isOwner(currentUser) ? "legacy" : "empty";
    const baseMode = currentUser
      ? document.baseMode === "legacy"
        ? "legacy"
        : document.baseMode === "empty"
          ? "empty"
          : fallbackMode
      : "empty";

    if (category === "pack") {
      const sourceCodes = Array.isArray(document.ownedCodes)
        ? document.ownedCodes
        : baseMode === "legacy"
          ? catalog.items.filter((item) => item.baselineOwned).map((item) => item.key)
          : [];
      const ownedCodes = new Set(
        sourceCodes.map((code) => String(code).trim().toLowerCase()),
      );
      catalog.items.forEach((item) => {
        item.owned = ownedCodes.has(item.key.toLowerCase());
      });
      return;
    }

    const overrides =
      document.overrides &&
      typeof document.overrides === "object" &&
      !Array.isArray(document.overrides)
        ? document.overrides
        : {};

    catalog.items.forEach((item) => {
      const explicit = overrideOwned(overrides[item.key]);
      item.owned =
        explicit === null
          ? baseMode === "legacy" && item.baselineOwned
          : explicit;
    });
  }

  function getMetrics() {
    const categoryMetrics = {};
    const allGroups = [];
    let overallOwned = 0;
    let overallTotal = 0;

    for (const category of CATEGORY_ORDER) {
      applyOwnership(category);
      const catalog = catalogs[category];
      const owned = catalog.items.filter((item) => item.owned).length;
      const total = catalog.items.length;
      const groups = catalog.groups.map((group) => {
        const groupItems = group.itemKeys
          .map((key) => catalog.itemMap.get(key))
          .filter(Boolean);
        const groupOwned = groupItems.filter((item) => item.owned).length;
        const groupTotal = groupItems.length;
        return {
          category,
          href: catalog.href,
          name: group.name,
          owned: groupOwned,
          total: groupTotal,
          missing: groupTotal - groupOwned,
          rate: percentage(groupOwned, groupTotal),
        };
      });

      categoryMetrics[category] = {
        ...catalog,
        owned,
        total,
        missing: total - owned,
        rate: percentage(owned, total),
        groups,
      };
      overallOwned += owned;
      overallTotal += total;
      allGroups.push(...groups);
    }

    return {
      categories: categoryMetrics,
      groups: allGroups,
      owned: overallOwned,
      total: overallTotal,
      missing: overallTotal - overallOwned,
      rate: percentage(overallOwned, overallTotal),
      completedGroups: allGroups.filter(
        (group) => group.total > 0 && group.owned === group.total,
      ).length,
    };
  }

  function renderSummary(metrics) {
    elements.rate.textContent = `${metrics.rate.toFixed(1)}%`;
    elements.owned.textContent = formatNumber(metrics.owned);
    elements.total.textContent = formatNumber(metrics.total);
    elements.missing.textContent = formatNumber(metrics.missing);
    elements.ring.style.setProperty("--progress", metrics.rate);
    elements.statOwned.textContent = formatNumber(metrics.owned);
    elements.statMissing.textContent = formatNumber(metrics.missing);
    elements.statCompleteGroups.textContent = formatNumber(metrics.completedGroups);
  }

  function createCollectionCard(metric) {
    const link = document.createElement("a");
    link.className = "dashboard-collection-card";
    link.dataset.category = metric.key;
    link.href = metric.href;
    link.style.setProperty("--rate", metric.rate);
    link.setAttribute(
      "aria-label",
      `${metric.title} ${metric.owned}/${metric.total}${metric.unit}, ${metric.rate.toFixed(1)}%`,
    );
    link.innerHTML = `
      <div>
        <div class="dashboard-card-top">
          <span class="dashboard-card-icon" aria-hidden="true">${metric.number}</span>
          <span class="dashboard-card-rate">${metric.rate.toFixed(1)}%</span>
        </div>
        <div class="dashboard-card-title">
          <strong>${metric.title}</strong>
          <span>${metric.description}</span>
        </div>
        <div class="dashboard-card-count">
          <strong>${formatNumber(metric.owned)}</strong>
          <span>/ ${formatNumber(metric.total)}${metric.unit}</span>
        </div>
      </div>
      <div>
        <div class="dashboard-card-progress" aria-hidden="true"><span></span></div>
        <div class="dashboard-card-footer">
          <span>남은 항목 ${formatNumber(metric.missing)}${metric.unit}</span>
          <span class="dashboard-card-arrow" aria-hidden="true">→</span>
        </div>
      </div>
    `;
    return link;
  }

  function renderCollections(metrics) {
    const fragment = document.createDocumentFragment();
    for (const category of CATEGORY_ORDER) {
      fragment.append(createCollectionCard(metrics.categories[category]));
    }
    elements.collectionGrid.replaceChildren(fragment);
    elements.collectionGrid.setAttribute("aria-busy", "false");
  }

  function renderNearest(metrics) {
    const nearest = metrics.groups
      .filter(
        (group) =>
          group.total > 0 &&
          group.owned > 0 &&
          group.missing > 0,
      )
      .sort(
        (a, b) =>
          a.missing - b.missing ||
          b.rate - a.rate ||
          b.total - a.total ||
          a.name.localeCompare(b.name, "ko-KR"),
      )
      .slice(0, 6);

    elements.nearestCount.textContent = `${nearest.length}개`;
    elements.nearestEmpty.hidden = nearest.length > 0;
    elements.nearestList.hidden = nearest.length === 0;

    const items = nearest.map((group, index) => {
      const item = document.createElement("li");
      item.className = "dashboard-ranking-item";
      item.innerHTML = `
        <a class="dashboard-ranking-link" href="${group.href}">
          <span class="dashboard-rank">${index + 1}</span>
          <span class="dashboard-list-copy">
            <span class="dashboard-list-title">${group.name}</span>
            <span class="dashboard-list-meta">${CATEGORY_META[group.category].title} · ${formatNumber(group.owned)}/${formatNumber(group.total)}</span>
          </span>
          <span class="dashboard-list-progress">
            <strong>${formatNumber(group.missing)}개 남음</strong>
            <span>${group.rate.toFixed(1)}%</span>
          </span>
        </a>
      `;
      return item;
    });
    elements.nearestList.replaceChildren(...items);
  }

  function timestampToDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    if (Number.isFinite(value.seconds)) return new Date(value.seconds * 1000);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatRelativeTime(date) {
    const elapsed = Date.now() - date.getTime();
    if (elapsed < 0) {
      return new Intl.DateTimeFormat("ko-KR", {
        month: "numeric",
        day: "numeric",
      }).format(date);
    }
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return "방금 전";
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}일 전`;
    return new Intl.DateTimeFormat("ko-KR", {
      month: "numeric",
      day: "numeric",
    }).format(date);
  }

  function getRecentEntries() {
    if (!currentUser) return [];
    const entries = [];

    for (const category of CATEGORY_ORDER) {
      const document = documents[category] || {};
      const catalog = catalogs[category];

      if (category === "pack") {
        const date = timestampToDate(document.updatedAt);
        if (date) {
          entries.push({
            category,
            name: "팩 수집 상태 업데이트",
            meta: `${Array.isArray(document.ownedCodes) ? document.ownedCodes.length : 0}팩 수집완료`,
            date,
          });
        }
        continue;
      }

      const overrides =
        document.overrides &&
        typeof document.overrides === "object" &&
        !Array.isArray(document.overrides)
          ? document.overrides
          : {};

      for (const [key, value] of Object.entries(overrides)) {
        if (!value || typeof value !== "object") continue;
        const date = timestampToDate(value.updatedAt);
        if (!date) continue;
        const catalogItem = catalog.itemMap.get(key);
        entries.push({
          category,
          name: catalogItem?.name || "수집 상태 업데이트",
          meta: catalogItem?.group || CATEGORY_META[category].title,
          date,
        });
      }
    }

    return entries
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 6);
  }

  function renderRecent() {
    const recent = getRecentEntries();
    elements.recentEmpty.hidden = recent.length > 0;
    elements.recentList.hidden = recent.length === 0;

    const items = recent.map((entry) => {
      const item = document.createElement("li");
      item.className = "dashboard-recent-item";
      item.innerHTML = `
        <span class="dashboard-recent-icon" aria-hidden="true">${CATEGORY_META[entry.category].number}</span>
        <span class="dashboard-list-copy">
          <span class="dashboard-list-title">${entry.name}</span>
          <span class="dashboard-list-meta">${CATEGORY_META[entry.category].title} · ${entry.meta}</span>
        </span>
        <time class="dashboard-recent-time" datetime="${entry.date.toISOString()}">${formatRelativeTime(entry.date)}</time>
      `;
      return item;
    });
    elements.recentList.replaceChildren(...items);
  }

  function renderAccountNote() {
    if (!currentUser) {
      elements.accountNote.hidden = false;
      elements.accountNote.dataset.state = "";
      return;
    }

    if (documentReadFailed) {
      elements.accountNote.hidden = false;
      elements.accountNote.dataset.state = "warning";
      elements.accountNote.querySelector("strong").textContent =
        "일부 도감 기록을 읽지 못했습니다.";
      elements.accountNote.querySelector("p").textContent =
        "읽지 못한 도감은 계정의 기본 수집 상태로 표시됩니다.";
      elements.loginCta.hidden = true;
      return;
    }

    if (sharedViewActive) {
      elements.accountNote.hidden = false;
      elements.accountNote.dataset.state = "readonly";
      elements.accountNote.querySelector("strong").textContent =
        "드기 도감을 읽기 전용으로 보고 있습니다.";
      elements.accountNote.querySelector("p").textContent =
        "수집 현황은 확인할 수 있지만 카드 상태를 수정하거나 동기화할 수 없습니다.";
      elements.loginCta.hidden = true;
      return;
    }

    elements.accountNote.hidden = true;
  }

  function renderDashboard() {
    if (!catalogs) return;
    const metrics = getMetrics();
    renderSummary(metrics);
    renderCollections(metrics);
    renderNearest(metrics);
    renderRecent();
    renderAccountNote();
  }

  async function initialize() {
    createAuthUi();

    try {
      const [loadedCatalogs] = await Promise.all([
        loadCatalogs(),
        initializeFirebase(),
      ]);
      catalogs = loadedCatalogs;
      await loadUserDocuments();
      renderDashboard();
      subscribeToDocuments();
    } catch (error) {
      console.error("통합 대시보드 초기화 실패", error);
      elements.error.hidden = false;
      if (catalogs) renderDashboard();
    }
  }

  initialize();
})();
