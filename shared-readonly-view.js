"use strict";

(function () {
  const CONFIG = window.POKEMON_DEX_FIREBASE || {};
  const VIEWER_UID = "9K11y6y4U4dlVmmi9bkxaT4Ci8u2";
  const SHARED_BUTTON_LABEL = "드기 도감 보기";
  const STORAGE_KEY = "pokemonDexSharedReadonly";
  const SHARE_COLLECTION = "sharedDexViews";
  const OWNER_DOCUMENT_IDS = [
    CONFIG.userDocument || "nationalDex",
    "packDex",
    "artistDex",
    "seriesDex",
    "pokemonCollectionsDex",
    "arDex",
  ];

  let ownerDocumentsPromise = null;
  let ownerSharePromise = null;

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isViewer(user) {
    return Boolean(user && user.uid === VIEWER_UID);
  }

  function readStoredMode() {
    try {
      return window.sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch (error) {
      console.warn("읽기 전용 보기 상태를 확인하지 못했습니다.", error);
      return false;
    }
  }

  function setStoredMode(active) {
    try {
      if (active) {
        window.sessionStorage.setItem(STORAGE_KEY, "1");
      } else {
        window.sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      console.warn("읽기 전용 보기 상태를 저장하지 못했습니다.", error);
    }
  }

  function isActive(user) {
    return isViewer(user) && readStoredMode();
  }

  function setActive(active) {
    setStoredMode(Boolean(active));
  }

  function clear() {
    setStoredMode(false);
    document.documentElement.classList.remove("shared-readonly-view");
  }

  function buttonLabel() {
    return SHARED_BUTTON_LABEL;
  }

  function updateControl(user) {
    const panel = document.querySelector("#firebase-auth-panel");
    const eligible = isViewer(user);
    const active = isActive(user);

    if (user && !eligible) {
      clear();
    }

    document.documentElement.classList.toggle(
      "shared-readonly-view",
      active,
    );

    if (!panel) return active;

    let button = panel.querySelector("#shared-readonly-toggle");
    if (!button) {
      button = document.createElement("button");
      button.id = "shared-readonly-toggle";
      button.type = "button";
      button.className = "shared-readonly-toggle";
      panel.querySelector("#firebase-logout")?.before(button);
    }

    button.hidden = !eligible;
    button.dataset.active = active ? "true" : "false";
    button.textContent = active ? "내 도감 보기" : buttonLabel();
    button.title = active
      ? "내 계정의 도감으로 돌아갑니다."
      : "드기의 도감을 읽기 전용으로 봅니다.";
    button.setAttribute("aria-pressed", String(active));
    button.onclick = () => {
      setActive(button.dataset.active !== "true");
      window.location.reload();
    };

    panel.classList.toggle("is-shared-readonly", active);
    return active;
  }

  async function ensureOwnerShare(db, firestoreModule, user) {
    const ownerEmail = normalizeEmail(CONFIG.ownerEmail);
    if (
      !user ||
      !ownerEmail ||
      normalizeEmail(user.email) !== ownerEmail
    ) {
      return false;
    }

    if (!ownerSharePromise) {
      ownerSharePromise = (async () => {
        const ref = firestoreModule.doc(
          db,
          SHARE_COLLECTION,
          VIEWER_UID,
        );
        const snapshot = await firestoreModule.getDoc(ref);
        const data = snapshot.exists() ? snapshot.data() || {} : {};
        if (
          data.ownerUid === user.uid &&
          normalizeEmail(data.ownerEmail) === ownerEmail &&
          data.viewerUid === VIEWER_UID &&
          data.mode === "read-only"
        ) {
          return true;
        }

        await firestoreModule.setDoc(
          ref,
          {
            ownerUid: user.uid,
            ownerEmail,
            viewerUid: VIEWER_UID,
            mode: "read-only",
            updatedAt: firestoreModule.serverTimestamp(),
          },
          { merge: true },
        );
        return true;
      })().catch((error) => {
        ownerSharePromise = null;
        console.warn("읽기 전용 공유 설정을 저장하지 못했습니다.", error);
        return false;
      });
    }

    return ownerSharePromise;
  }

  async function loadOwnerDocuments(db, firestoreModule) {
    if (!ownerDocumentsPromise) {
      ownerDocumentsPromise = (async () => {
        const ownerEmail = normalizeEmail(CONFIG.ownerEmail);
        if (!ownerEmail) {
          throw new Error("공유할 소유자 계정이 설정되지 않았습니다.");
        }

        const shareRef = firestoreModule.doc(
          db,
          SHARE_COLLECTION,
          VIEWER_UID,
        );
        const shareSnapshot = await firestoreModule.getDoc(shareRef);
        const share = shareSnapshot.exists()
          ? shareSnapshot.data() || {}
          : {};
        const ownerUid = String(share.ownerUid || "").trim();

        if (
          !ownerUid ||
          normalizeEmail(share.ownerEmail) !== ownerEmail ||
          share.viewerUid !== VIEWER_UID ||
          share.mode !== "read-only"
        ) {
          throw new Error("공유 소유자 설정을 확인하지 못했습니다.");
        }

        const reads = await Promise.all(
          OWNER_DOCUMENT_IDS.map(async (documentId) => {
            const ref = firestoreModule.doc(
              db,
              "users",
              ownerUid,
              CONFIG.userCollection || "collections",
              documentId,
            );
            const item = await firestoreModule.getDoc(ref);
            return item.exists()
              ? [
                  documentId,
                  {
                    data: item.data() || {},
                    path: item.ref.path,
                    ref: item.ref,
                  },
                ]
              : [documentId, null];
          }),
        );
        const documents = new Map();

        reads.forEach(([documentId, item]) => {
          if (item) documents.set(documentId, item);
        });

        return documents;
      })().catch((error) => {
        ownerDocumentsPromise = null;
        throw error;
      });
    }

    return ownerDocumentsPromise;
  }

  async function loadOwnerDocument(db, firestoreModule, documentId) {
    const documents = await loadOwnerDocuments(db, firestoreModule);
    return documents.get(documentId) || null;
  }

  window.PokemonDexSharedReadonly = {
    buttonLabel,
    clear,
    ensureOwnerShare,
    isActive,
    isViewer,
    loadOwnerDocument,
    loadOwnerDocuments,
    setActive,
    updateControl,
  };
})();
