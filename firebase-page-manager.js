"use strict";

(function () {
  const SDK_VERSION = "12.16.0";
  const CONFIG = window.POKEMON_DEX_FIREBASE || {};
  const PAGE_CONFIG = {
    artist: { documentId: "artistDex" },
    series: { documentId: "seriesDex" },
    pokemon: { documentId: "pokemonCollectionsDex" },
  };

  const mode = document.body?.dataset.catalog || "";
  const page = PAGE_CONFIG[mode];
  if (!page) return;

  let firebase = null;
  let currentUser = null;
  let accountProfile = { baseMode: "empty" };
  let remoteOverrides = {};
  let resolveReady;

  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

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

  function normalizeOverride(value) {
    if (typeof value === "boolean") return { owned: value };
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return { owned: Boolean(value.owned) };
  }

  function sanitizeOverrides(source) {
    const cleaned = {};
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return cleaned;
    }

    for (const [key, value] of Object.entries(source)) {
      const item = normalizeOverride(value);
      if (key && item) cleaned[key] = item;
    }
    return cleaned;
  }

  function groupIdentity(group, groupIndex) {
    return String(group.code || group.name || group.title || groupIndex);
  }

  function cardIdentity(group, card, groupIndex, cardIndex) {
    const groupId = groupIdentity(group, groupIndex);

    if (mode === "artist") {
      return [
        groupId,
        card.set || "",
        card.cardNumber || "",
        card.order ?? cardIndex,
      ].join("::");
    }

    if (mode === "series") {
      return [groupId, card.code || card.meta || cardIndex, cardIndex].join("::");
    }

    return [
      groupId,
      card.meta || card.code || card.name || cardIndex,
      cardIndex,
    ].join("::");
  }

  function applyGroups(groups) {
    const useLegacy = Boolean(
      currentUser && accountProfile.baseMode === "legacy",
    );

    groups.forEach((group, groupIndex) => {
      (group.cards || []).forEach((card, cardIndex) => {
        if (!Object.prototype.hasOwnProperty.call(card, "legacyOwned")) {
          card.legacyOwned = Boolean(card.owned);
        }

        const key = cardIdentity(group, card, groupIndex, cardIndex);
        const override = normalizeOverride(remoteOverrides[key]);
        card.owned = override ? override.owned : useLegacy && card.legacyOwned;
        card.accountKey = key;
      });
    });

    return groups;
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
    const headerChip = document.querySelector(".header-chip");

    panel.classList.toggle("is-account", Boolean(currentUser));
    panel.classList.toggle("is-owner", isOwnerAccount(currentUser));
    if (headerChip) {
      headerChip.textContent = currentUser ? "SIGNED IN" : "PUBLIC VIEW";
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

    const name = currentUser.displayName || currentUser.email || "내 계정";
    const startLabel =
      accountProfile.baseMode === "legacy"
        ? "기존 도감 유지"
        : "0장부터 시작";
    status.textContent = `${name} · ${startLabel}`;
    login.hidden = true;
    logout.hidden = false;
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

  async function loadAccountDocument(user) {
    const fallbackMode = isOwnerAccount(user) ? "legacy" : "empty";
    accountProfile = { baseMode: fallbackMode };
    remoteOverrides = {};

    const { db, firestoreModule } = firebase;
    const documentRef = firestoreModule.doc(
      db,
      "users",
      user.uid,
      CONFIG.userCollection || "collections",
      page.documentId,
    );

    try {
      const snapshot = await firestoreModule.getDoc(documentRef);
      if (snapshot.exists()) {
        const data = snapshot.data() || {};
        accountProfile = {
          baseMode: data.baseMode === "legacy" ? "legacy" : "empty",
        };
        remoteOverrides = sanitizeOverrides(data.overrides || {});
        return;
      }

      await firestoreModule.setDoc(documentRef, {
        baseMode: fallbackMode,
        email: user.email || "",
        displayName: user.displayName || "",
        overrides: {},
        createdAt: firestoreModule.serverTimestamp(),
        updatedAt: firestoreModule.serverTimestamp(),
      });
    } catch (error) {
      console.warn(
        `${page.documentId} 계정 데이터를 불러오지 못해 기본 상태로 표시합니다.`,
        error,
      );
    }
  }

  async function initializeFirebase() {
    createAuthUi();

    if (!configured()) {
      updateAuthUi();
      resolveReady();
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
        await authModule.setPersistence(
          auth,
          authModule.browserLocalPersistence,
        );
      } catch (error) {
        console.warn("로그인 유지 설정에 실패했습니다.", error);
      }

      firebase = { auth, db, authModule, firestoreModule };
      currentUser = await firstAuthUser(auth, authModule);
      if (currentUser) await loadAccountDocument(currentUser);
      updateAuthUi();
      resolveReady();
    } catch (error) {
      console.error("Firebase 초기화에 실패했습니다.", error);
      updateAuthUi(error);
      resolveReady();
    }
  }

  async function signIn() {
    if (!firebase) return;

    const { auth, authModule } = firebase;
    const login = document.querySelector("#firebase-login");
    if (login) {
      login.disabled = true;
      login.textContent = "로그인 중…";
    }

    const provider = new authModule.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    try {
      await authModule.signInWithPopup(auth, provider);
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
          "로그인 팝업이 차단되었습니다.\n팝업을 허용한 뒤 다시 시도하세요.";
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
    await firebase.authModule.signOut(firebase.auth);
    window.location.reload();
  }

  window.PokemonDexPageAccount = {
    ready,
    applyGroups,
    get currentUser() {
      return currentUser;
    },
    get baseMode() {
      return accountProfile.baseMode;
    },
  };

  initializeFirebase();
})();
