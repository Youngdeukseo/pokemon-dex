"use strict";

(function () {
  const STORAGE_KEY = "pokemonDexCollectionOverridesV1";
  let active = false;

  function readOverrides() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function cardNumber(card) {
    const text = card.querySelector(".number-badge")?.textContent || "";
    const number = Number(text.replace(/\D/g, ""));
    return Number.isInteger(number) ? number : null;
  }

  function clear() {
    document
      .querySelectorAll("#card-grid .collection-manager-hidden")
      .forEach((card) => card.classList.remove("collection-manager-hidden"));
  }

  function apply() {
    if (!active) {
      clear();
      return;
    }

    const loadMore = document.querySelector("#load-more");
    let guard = 0;
    while (loadMore && !loadMore.hidden && guard < 100) {
      loadMore.click();
      guard += 1;
    }

    const overrides = readOverrides();
    let count = 0;
    for (const card of document.querySelectorAll("#card-grid .pokemon-card")) {
      const item = overrides[String(cardNumber(card))];
      const visible = item && ["trade", "sale"].includes(item.tradeStatus);
      card.classList.toggle("collection-manager-hidden", !visible);
      if (visible) count += 1;
    }

    const result = document.querySelector("#result-count");
    const label = document.querySelector("#active-filter-label");
    if (result) result.textContent = String(count);
    if (label) label.textContent = "· 교환·판매 가능";
  }

  document.addEventListener("DOMContentLoaded", () => {
    const tradeButton = [...document.querySelectorAll(".manager-button")].find(
      (button) => button.textContent.trim() === "교환 가능",
    );

    tradeButton?.addEventListener("click", () => {
      active = true;
      setTimeout(apply, 0);
    });

    document.addEventListener("click", (event) => {
      if (
        event.target.closest(
          "#status-filters, #generation-filters, #reset-filters, [data-reset]",
        )
      ) {
        active = false;
        clear();
      }
    });

    document.querySelector("#search-input")?.addEventListener("input", () => {
      active = false;
      clear();
    });
    document.querySelector("#sort-select")?.addEventListener("change", () => {
      active = false;
      clear();
    });

    const grid = document.querySelector("#card-grid");
    if (grid) {
      new MutationObserver(() => {
        if (active) setTimeout(apply, 0);
      }).observe(grid, { childList: true });
    }
  });
})();
