"use strict";

(function () {
  const AGE_CONFIRMATION_KEY = "pokemonDexAge14ConfirmedV1";
  const LOGIN_SELECTOR = "#firebase-login, #dashboard-login-cta";

  function policyLinks(className = "login-policy-links") {
    const wrapper = document.createElement("span");
    wrapper.className = className;
    wrapper.setAttribute("aria-label", "로그인 이용 조건 및 정책");
    wrapper.innerHTML = `
      <span class="login-age-badge" title="Google 로그인은 만 14세 이상만 이용할 수 있습니다.">14+</span>
      <a href="./privacy.html">개인정보</a>
      <span aria-hidden="true">·</span>
      <a href="./terms.html">이용약관</a>
    `;
    return wrapper;
  }

  function decorateAuthPanel(panel) {
    if (!panel) return false;
    if (!panel.querySelector(".login-policy-links")) panel.append(policyLinks());
    return true;
  }

  function decorateDashboardLogin() {
    const note = document.querySelector("#dashboard-account-note > div");
    if (!note || note.querySelector(".dashboard-login-policy")) return;

    const policy = document.createElement("p");
    policy.className = "dashboard-login-policy";
    policy.append("로그인 기능은 만 14세 이상만 이용할 수 있습니다. ");
    policy.append(policyLinks("dashboard-policy-links"));
    note.append(policy);
  }

  function updateCopyrightYears() {
    const year = String(new Date().getFullYear());
    document.querySelectorAll("[data-current-year]").forEach((element) => {
      element.textContent = year;
    });
  }

  function ageConfirmed() {
    try {
      return window.sessionStorage.getItem(AGE_CONFIRMATION_KEY) === "yes";
    } catch (error) {
      return false;
    }
  }

  function rememberAgeConfirmation() {
    try {
      window.sessionStorage.setItem(AGE_CONFIRMATION_KEY, "yes");
    } catch (error) {
      // 세션 저장소를 사용할 수 없어도 현재 로그인 시도는 계속할 수 있습니다.
    }
  }

  function confirmLoginAge(event) {
    const loginButton = event.target.closest?.(LOGIN_SELECTOR);
    if (!loginButton || ageConfirmed()) return;

    const confirmed = window.confirm(
      "Google 로그인은 만 14세 이상만 이용할 수 있습니다.\n\n만 14세 이상이며 이용약관과 개인정보처리방침을 확인하셨나요?",
    );

    if (confirmed) {
      rememberAgeConfirmation();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    window.alert("만 14세 미만은 Google 로그인과 건의 기능을 이용할 수 없습니다.");
  }

  function initialize() {
    updateCopyrightYears();
    decorateDashboardLogin();

    if (decorateAuthPanel(document.querySelector("#firebase-auth-panel"))) return;

    const authObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          const panel = node.matches?.("#firebase-auth-panel")
            ? node
            : node.querySelector?.("#firebase-auth-panel");
          if (!decorateAuthPanel(panel)) continue;
          authObserver.disconnect();
          return;
        }
      }
    });
    authObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  document.addEventListener("click", confirmLoginAge, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
