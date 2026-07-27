"use strict";

(function () {
  const SDK_VERSION = "12.16.0";
  const CONFIG = window.POKEMON_DEX_FIREBASE || {};
  const previousFetch = window.fetch.bind(window);

  let resolveAuth;
  const authReady = new Promise((resolve) => {
    resolveAuth = resolve;
  });

  function configured() {
    const config = CONFIG.config || {};
    return Boolean(
      CONFIG.enabled &&
        config.apiKey &&
        config.authDomain &&
        config.projectId,
    );
  }

  async function resolveCurrentUser() {
    if (!configured()) {
      resolveAuth(null);
      return;
    }

    try {
      const [appModule, authModule] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
      ]);

      let app;
      if (appModule.getApps().length) {
        app = appModule.getApp();
      } else {
        try {
          app = appModule.initializeApp(CONFIG.config);
        } catch (error) {
          app = appModule.getApp();
        }
      }

      const auth = authModule.getAuth(app);
      const user = await new Promise((resolve) => {
        let unsubscribe = () => {};
        unsubscribe = authModule.onAuthStateChanged(auth, (nextUser) => {
          unsubscribe();
          resolve(nextUser || null);
        });
      });

      resolveAuth(user);
      updateGuestLabel(user);
    } catch (error) {
      console.warn("로그인 상태를 확인하지 못해 미보유 도감으로 표시합니다.", error);
      resolveAuth(null);
      updateGuestLabel(null);
    }
  }

  function makeGuestData(data) {
    const records = Array.isArray(data.records) ? data.records : [];

    for (const record of records) {
      record.owned = false;
      record.quantity = 0;
      record.actualSet = "";
      record.actualCardNumber = "";
      record.actualRarity = "";
      record.tradeStatus = "none";
      record.collectionNote = "";
    }

    data.meta = data.meta || {};
    data.meta.total = records.length;
    data.meta.owned = 0;
    data.meta.missing = records.length;
    data.meta.completionRate = 0;

    for (const generation of data.generations || []) {
      const total = records.filter(
        (record) => record.generation === generation.generation,
      ).length;
      generation.total = total;
      generation.owned = 0;
      generation.missing = total;
      generation.completionRate = 0;
    }

    return data;
  }

  window.fetch = async function guestManagedFetch(input, init) {
    const response = await previousFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";

    if (!response.ok || !/data\/pokedex\.json(?:$|[?#])/.test(url)) {
      return response;
    }

    try {
      const user = await Promise.race([
        authReady,
        new Promise((resolve) => window.setTimeout(() => resolve(null), 9000)),
      ]);

      if (user) return response;

      const data = makeGuestData(await response.clone().json());
      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      headers.delete("content-length");

      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.warn("비로그인 미보유 도감을 적용하지 못했습니다.", error);
      return response;
    }
  };

    function updateGuestLabel(user) {
    const apply = () => {
      const headerChip = document.querySelector(".header-chip");

      if (headerChip) {
        headerChip.textContent = user
          ? "SIGNED IN"
          : "PUBLIC VIEW";
      }

      const status = document.querySelector("#firebase-auth-status");

      if (!user && status) {
        status.textContent = "방문자";
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", apply, {
        once: true
      });
    } else {
      apply();
    }
  }

  resolveCurrentUser();
})();
