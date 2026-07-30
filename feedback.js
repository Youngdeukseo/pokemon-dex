"use strict";

(function () {
  const SDK_VERSION = "12.16.0";
  const CONFIG = window.POKEMON_DEX_FIREBASE || {};
  const OWNER_EMAIL = String(CONFIG.ownerEmail || "").trim().toLowerCase();
  const FEEDBACK_COLLECTION = "siteFeedback";
  const TYPE_LABELS = {
    suggestion: "건의사항",
    feature: "기능 요청",
    bug: "오류 제보",
    data: "카드·도감 정보 수정",
    other: "기타",
  };
  const STATUS_LABELS = {
    new: "새 의견",
    reviewed: "확인중",
    completed: "완료",
  };

  const elements = {
    open: document.querySelector("#feedback-open"),
    adminOpen: document.querySelector("#feedback-admin-open"),
    newCount: document.querySelector("#feedback-new-count"),
    dialog: document.querySelector("#feedback-dialog"),
    close: document.querySelector("#feedback-close"),
    cancel: document.querySelector("#feedback-cancel"),
    form: document.querySelector("#feedback-form"),
    type: document.querySelector("#feedback-type"),
    title: document.querySelector("#feedback-title"),
    message: document.querySelector("#feedback-message"),
    messageCount: document.querySelector("#feedback-message-count"),
    account: document.querySelector("#feedback-account"),
    status: document.querySelector("#feedback-status"),
    submit: document.querySelector("#feedback-submit"),
    adminDialog: document.querySelector("#feedback-admin-dialog"),
    adminClose: document.querySelector("#feedback-admin-close"),
    adminStatus: document.querySelector("#feedback-admin-status"),
    adminList: document.querySelector("#feedback-admin-list"),
    adminEmpty: document.querySelector("#feedback-admin-empty"),
    filters: [...document.querySelectorAll("[data-feedback-filter]")],
  };

  let firebase = null;
  let currentUser = null;
  let authReady = false;
  let feedbackItems = [];
  let activeFilter = "all";
  let unsubscribeFeedback = null;

  function configured() {
    const config = CONFIG.config || {};
    return Boolean(
      CONFIG.enabled &&
        config.apiKey &&
        config.authDomain &&
        config.projectId,
    );
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isOwner(user) {
    return Boolean(
      user &&
        OWNER_EMAIL &&
        normalizeEmail(user.email) === OWNER_EMAIL,
    );
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
      return;
    }
    dialog.setAttribute("open", "");
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function") {
      if (dialog.open) dialog.close();
      return;
    }
    dialog.removeAttribute("open");
  }

  function setStatus(message = "", state = "") {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.dataset.state = state;
  }

  function setAdminStatus(message = "", state = "") {
    if (!elements.adminStatus) return;
    elements.adminStatus.textContent = message;
    elements.adminStatus.dataset.state = state;
  }

  function triggerLogin() {
    const login = document.querySelector("#firebase-login");
    if (login && !login.hidden && !login.disabled) {
      login.click();
      return;
    }
    alert("Google 로그인 후 의견을 보낼 수 있습니다.");
  }

  function updateUi() {
    const owner = isOwner(currentUser);
    if (elements.adminOpen) elements.adminOpen.hidden = !owner;
    if (elements.account) {
      elements.account.textContent = currentUser
        ? `${currentUser.email || "로그인 계정"}으로 전달됩니다.`
        : "Google 로그인 후 의견을 보낼 수 있습니다.";
    }
    if (!owner) {
      stopAdminSubscription();
      if (elements.adminDialog?.open) closeDialog(elements.adminDialog);
    }
  }

  function timestampToDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    if (Number.isFinite(value.seconds)) return new Date(value.seconds * 1000);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(value) {
    const date = timestampToDate(value);
    if (!date) return "방금 전";
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function createElement(tagName, className = "", text = "") {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function renderAdminList() {
    if (!elements.adminList || !elements.adminEmpty) return;
    const visible = feedbackItems.filter(
      (item) => activeFilter === "all" || item.status === activeFilter,
    );

    const cards = visible.map((item) => {
      const card = createElement("article", "feedback-item");
      card.dataset.status = item.status;

      const top = createElement("div", "feedback-item-top");
      const badges = createElement("div", "feedback-item-badges");
      badges.append(
        createElement(
          "span",
          "feedback-type-badge",
          TYPE_LABELS[item.type] || TYPE_LABELS.other,
        ),
        createElement(
          "span",
          `feedback-status-badge feedback-status-badge--${item.status}`,
          STATUS_LABELS[item.status] || STATUS_LABELS.new,
        ),
      );
      const time = createElement("time", "feedback-item-time", formatDate(item.createdAt));
      top.append(badges, time);

      const title = createElement("h3", "", item.title || "제목 없음");
      const message = createElement("p", "feedback-item-message", item.message || "");
      const sender = createElement(
        "p",
        "feedback-item-sender",
        `${item.authorName || "이름 없음"} · ${item.authorEmail || "이메일 없음"}`,
      );

      const actions = createElement("div", "feedback-item-actions");
      if (item.status !== "reviewed") {
        const reviewed = createElement("button", "", "확인중으로");
        reviewed.type = "button";
        reviewed.dataset.feedbackId = item.id;
        reviewed.dataset.feedbackStatus = "reviewed";
        actions.append(reviewed);
      }
      if (item.status !== "completed") {
        const completed = createElement("button", "is-complete", "완료 처리");
        completed.type = "button";
        completed.dataset.feedbackId = item.id;
        completed.dataset.feedbackStatus = "completed";
        actions.append(completed);
      }

      card.append(top, title, message, sender);
      if (actions.childElementCount) card.append(actions);
      return card;
    });

    elements.adminList.replaceChildren(...cards);
    elements.adminEmpty.hidden = cards.length > 0;
    elements.adminList.hidden = cards.length === 0;

    const newCount = feedbackItems.filter((item) => item.status === "new").length;
    if (elements.newCount) {
      elements.newCount.textContent = String(newCount);
      elements.newCount.hidden = newCount === 0;
    }
    setAdminStatus(
      `전체 ${feedbackItems.length}건 · 새 의견 ${newCount}건`,
      "",
    );
  }

  function stopAdminSubscription() {
    if (typeof unsubscribeFeedback === "function") unsubscribeFeedback();
    unsubscribeFeedback = null;
    feedbackItems = [];
    if (elements.newCount) elements.newCount.hidden = true;
  }

  function startAdminSubscription() {
    if (!firebase || !isOwner(currentUser) || unsubscribeFeedback) return;
    setAdminStatus("받은 의견을 불러오는 중입니다.");
    const reference = firebase.firestoreModule.collection(
      firebase.db,
      FEEDBACK_COLLECTION,
    );
    unsubscribeFeedback = firebase.firestoreModule.onSnapshot(
      reference,
      (snapshot) => {
        feedbackItems = snapshot.docs
          .map((item) => ({ id: item.id, ...(item.data() || {}) }))
          .sort((a, b) => {
            const aDate = timestampToDate(a.createdAt)?.getTime() || 0;
            const bDate = timestampToDate(b.createdAt)?.getTime() || 0;
            return bDate - aDate;
          });
        renderAdminList();
      },
      (error) => {
        console.warn("받은 의견을 불러오지 못했습니다.", error);
        unsubscribeFeedback = null;
        setAdminStatus("받은 의견을 불러오지 못했습니다.", "error");
      },
    );
  }

  async function submitFeedback(event) {
    event.preventDefault();
    if (!firebase || !currentUser) {
      triggerLogin();
      return;
    }

    const type = String(elements.type?.value || "suggestion");
    const title = String(elements.title?.value || "").trim();
    const message = String(elements.message?.value || "").trim();
    if (!TYPE_LABELS[type] || title.length < 2 || message.length < 5) {
      setStatus("제목과 내용을 조금 더 자세히 입력해주세요.", "error");
      return;
    }

    elements.submit.disabled = true;
    elements.submit.textContent = "보내는 중…";
    setStatus("의견을 전달하고 있습니다.", "loading");

    try {
      await firebase.firestoreModule.addDoc(
        firebase.firestoreModule.collection(
          firebase.db,
          FEEDBACK_COLLECTION,
        ),
        {
          type,
          title,
          message,
          authorUid: currentUser.uid,
          authorEmail: currentUser.email || "",
          authorName: currentUser.displayName || "",
          status: "new",
          createdAt: firebase.firestoreModule.serverTimestamp(),
          updatedAt: firebase.firestoreModule.serverTimestamp(),
        },
      );
      elements.form.reset();
      if (elements.messageCount) elements.messageCount.textContent = "0";
      setStatus("의견을 보냈습니다. 감사합니다.", "success");
    } catch (error) {
      console.warn("의견을 보내지 못했습니다.", error);
      setStatus("의견을 보내지 못했습니다. 잠시 후 다시 시도해주세요.", "error");
    } finally {
      elements.submit.disabled = false;
      elements.submit.textContent = "의견 보내기";
    }
  }

  async function updateFeedbackStatus(id, status, button) {
    if (
      !firebase ||
      !isOwner(currentUser) ||
      !["reviewed", "completed"].includes(status)
    ) {
      return;
    }

    button.disabled = true;
    try {
      await firebase.firestoreModule.updateDoc(
        firebase.firestoreModule.doc(
          firebase.db,
          FEEDBACK_COLLECTION,
          id,
        ),
        {
          status,
          reviewedAt: firebase.firestoreModule.serverTimestamp(),
          reviewedBy: currentUser.uid,
          updatedAt: firebase.firestoreModule.serverTimestamp(),
        },
      );
    } catch (error) {
      console.warn("의견 상태를 변경하지 못했습니다.", error);
      setAdminStatus("의견 상태를 변경하지 못했습니다.", "error");
      button.disabled = false;
    }
  }

  async function initializeFirebase() {
    if (!configured()) {
      authReady = true;
      updateUi();
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
      firebase = { auth, db, authModule, firestoreModule };
      authModule.onAuthStateChanged(
        auth,
        (user) => {
          currentUser = user || null;
          authReady = true;
          updateUi();
          if (isOwner(currentUser)) startAdminSubscription();
        },
        (error) => {
          console.warn("의견함 로그인 상태를 확인하지 못했습니다.", error);
          authReady = true;
          updateUi();
        },
      );
    } catch (error) {
      console.warn("의견함을 초기화하지 못했습니다.", error);
      authReady = true;
      updateUi();
    }
  }

  elements.open?.addEventListener("click", () => {
    if (!authReady) {
      alert("로그인 상태를 확인 중입니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    if (!currentUser) {
      triggerLogin();
      return;
    }
    setStatus();
    updateUi();
    openDialog(elements.dialog);
    elements.title?.focus();
  });
  elements.close?.addEventListener("click", () => closeDialog(elements.dialog));
  elements.cancel?.addEventListener("click", () => closeDialog(elements.dialog));
  elements.form?.addEventListener("submit", submitFeedback);
  elements.message?.addEventListener("input", () => {
    if (elements.messageCount) {
      elements.messageCount.textContent = String(elements.message.value.length);
    }
  });

  elements.adminOpen?.addEventListener("click", () => {
    if (!isOwner(currentUser)) return;
    startAdminSubscription();
    openDialog(elements.adminDialog);
  });
  elements.adminClose?.addEventListener("click", () =>
    closeDialog(elements.adminDialog),
  );
  elements.filters.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.feedbackFilter || "all";
      elements.filters.forEach((item) =>
        item.classList.toggle("is-active", item === button),
      );
      renderAdminList();
    });
  });
  elements.adminList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-feedback-id]");
    if (!button) return;
    updateFeedbackStatus(
      button.dataset.feedbackId,
      button.dataset.feedbackStatus,
      button,
    );
  });

  for (const dialog of [elements.dialog, elements.adminDialog]) {
    dialog?.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  }

  updateUi();
  initializeFirebase();
})();
