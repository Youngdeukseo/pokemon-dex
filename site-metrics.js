"use strict";

(function () {
  const SDK_VERSION = "12.16.0";
  const CONFIG = window.POKEMON_DEX_FIREBASE || {};
  const OWNER_EMAIL = String(CONFIG.ownerEmail || "").trim().toLowerCase();
  const KNOWN_VIEWER_UID = "9K11y6y4U4dlVmmi9bkxaT4Ci8u2";
  const VISITOR_STORAGE_KEY = "pokemonDexVisitorIdV1";
  const METRICS_COLLECTION = "siteMetrics";
  const METRICS_DOCUMENT = "public";
  const DAILY_COLLECTION = "siteDailyMetrics";
  const USER_COLLECTION = "siteUserRegistry";

  const elements = {
    panel: document.querySelector("#dashboard-traffic"),
    total: document.querySelector("#metric-total-visits"),
    today: document.querySelector("#metric-today-visits"),
    users: document.querySelector("#metric-users"),
    status: document.querySelector("#dashboard-traffic-status"),
  };

  function configured() {
    const config = CONFIG.config || {};
    return Boolean(
      CONFIG.enabled &&
        config.apiKey &&
        config.authDomain &&
        config.projectId,
    );
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("ko-KR").format(Math.max(0, Number(value) || 0));
  }

  function counter(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  }

  function updateMetric(element, value) {
    if (element) element.textContent = value === null ? "—" : formatNumber(value);
  }

  function updateStatus(message, state = "") {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.dataset.state = state;
  }

  function renderMetrics(summary = null, daily = null) {
    updateMetric(
      elements.total,
      summary ? counter(summary.cumulativeVisits) : null,
    );
    updateMetric(elements.today, daily ? counter(daily.visits) : 0);
    updateMetric(elements.users, summary ? counter(summary.userCount) : null);
    elements.panel?.setAttribute("aria-busy", "false");
  }

  function dateKeyInKorea(date = new Date()) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(date);
      const values = Object.fromEntries(
        parts
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, part.value]),
      );
      return `${values.year}-${values.month}-${values.day}`;
    } catch (error) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
  }

  function createVisitorId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    if (window.crypto?.getRandomValues) {
      const values = new Uint8Array(16);
      window.crypto.getRandomValues(values);
      return Array.from(values, (value) =>
        value.toString(16).padStart(2, "0"),
      ).join("");
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function validVisitorId(value) {
    return /^[A-Za-z0-9-]{24,64}$/.test(String(value || ""));
  }

  function visitorId() {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        const stored = storage.getItem(VISITOR_STORAGE_KEY);
        if (validVisitorId(stored)) return stored;
      } catch (error) {
        // Continue with the next browser storage option.
      }
    }

    const created = createVisitorId();
    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        storage.setItem(VISITOR_STORAGE_KEY, created);
        return created;
      } catch (error) {
        // Continue with the next browser storage option.
      }
    }
    return created;
  }

  function isOwner(user) {
    return Boolean(
      user &&
        OWNER_EMAIL &&
        String(user.email || "").trim().toLowerCase() === OWNER_EMAIL,
    );
  }

  function firstAuthUser(auth, authModule) {
    return new Promise((resolve) => {
      let unsubscribe = () => {};
      unsubscribe = authModule.onAuthStateChanged(
        auth,
        (user) => {
          unsubscribe();
          resolve(user || null);
        },
        () => {
          unsubscribe();
          resolve(null);
        },
      );
    });
  }

  function summaryPayload(data, changes, firestoreModule) {
    return {
      cumulativeVisits: counter(
        changes.cumulativeVisits ?? data.cumulativeVisits,
      ),
      userCount: counter(changes.userCount ?? data.userCount),
      lastVisitDate: String(
        changes.lastVisitDate ?? data.lastVisitDate ?? "",
      ),
      lastVisitorId: String(
        changes.lastVisitorId ?? data.lastVisitorId ?? "",
      ),
      updatedAt: firestoreModule.serverTimestamp(),
    };
  }

  async function ensureDailyVisit(db, firestoreModule, day, id) {
    const summaryRef = firestoreModule.doc(
      db,
      METRICS_COLLECTION,
      METRICS_DOCUMENT,
    );
    const dailyRef = firestoreModule.doc(db, DAILY_COLLECTION, day);
    const visitorRef = firestoreModule.doc(
      db,
      DAILY_COLLECTION,
      day,
      "visitors",
      id,
    );

    await firestoreModule.runTransaction(db, async (transaction) => {
      const visitorSnapshot = await transaction.get(visitorRef);
      const summarySnapshot = await transaction.get(summaryRef);
      const dailySnapshot = await transaction.get(dailyRef);

      if (visitorSnapshot.exists()) return;

      const summary = summarySnapshot.exists()
        ? summarySnapshot.data() || {}
        : {};
      const daily = dailySnapshot.exists() ? dailySnapshot.data() || {} : {};

      transaction.set(visitorRef, {
        visitorId: id,
        date: day,
        createdAt: firestoreModule.serverTimestamp(),
      });
      transaction.set(
        summaryRef,
        summaryPayload(
          summary,
          {
            cumulativeVisits: counter(summary.cumulativeVisits) + 1,
            lastVisitDate: day,
            lastVisitorId: id,
          },
          firestoreModule,
        ),
      );
      transaction.set(dailyRef, {
        date: day,
        visits: counter(daily.visits) + 1,
        lastVisitorId: id,
        updatedAt: firestoreModule.serverTimestamp(),
      });
    });
  }

  async function registerUser(
    db,
    firestoreModule,
    userId,
    source = "login",
  ) {
    const summaryRef = firestoreModule.doc(
      db,
      METRICS_COLLECTION,
      METRICS_DOCUMENT,
    );
    const userRef = firestoreModule.doc(db, USER_COLLECTION, userId);

    await firestoreModule.runTransaction(db, async (transaction) => {
      const userSnapshot = await transaction.get(userRef);
      const summarySnapshot = await transaction.get(summaryRef);

      if (userSnapshot.exists() || !summarySnapshot.exists()) return;

      const summary = summarySnapshot.data() || {};
      transaction.set(userRef, {
        createdAt: firestoreModule.serverTimestamp(),
        source,
      });
      transaction.set(
        summaryRef,
        summaryPayload(
          summary,
          { userCount: counter(summary.userCount) + 1 },
          firestoreModule,
        ),
      );
    });
  }

  async function loadMetrics(db, firestoreModule, day) {
    const [summarySnapshot, dailySnapshot] = await Promise.all([
      firestoreModule.getDoc(
        firestoreModule.doc(db, METRICS_COLLECTION, METRICS_DOCUMENT),
      ),
      firestoreModule.getDoc(
        firestoreModule.doc(db, DAILY_COLLECTION, day),
      ),
    ]);
    renderMetrics(
      summarySnapshot.exists() ? summarySnapshot.data() || {} : {},
      dailySnapshot.exists() ? dailySnapshot.data() || {} : {},
    );
  }

  async function initialize() {
    if (!configured()) {
      renderMetrics();
      updateStatus("집계 기능을 연결하지 못했습니다.", "error");
      return;
    }

    const day = dateKeyInKorea();
    const id = visitorId();
    let writeFailed = false;

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
        await ensureDailyVisit(db, firestoreModule, day, id);
      } catch (error) {
        writeFailed = true;
        console.warn("사이트 접속 집계를 저장하지 못했습니다.", error);
      }

      const user = await firstAuthUser(auth, authModule);
      if (user) {
        try {
          await registerUser(db, firestoreModule, user.uid, "login");
          if (isOwner(user)) {
            await registerUser(
              db,
              firestoreModule,
              KNOWN_VIEWER_UID,
              "seeded",
            );
          }
        } catch (error) {
          writeFailed = true;
          console.warn("사이트 사용 인원을 저장하지 못했습니다.", error);
        }
      }

      await loadMetrics(db, firestoreModule, day);
      updateStatus(
        writeFailed
          ? "현재 수치를 표시하고 있습니다. 새 접속 반영은 잠시 지연될 수 있습니다."
          : "같은 기기에서는 하루에 한 번만 집계됩니다.",
        writeFailed ? "warning" : "",
      );
    } catch (error) {
      console.warn("사이트 이용 현황을 불러오지 못했습니다.", error);
      renderMetrics();
      updateStatus("이용 현황을 불러오지 못했습니다.", "error");
    }
  }

  window.PokemonDexSiteMetrics = {
    dateKeyInKorea,
  };

  initialize();
})();
