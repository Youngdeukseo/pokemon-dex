"use strict";

const DATA_URL = "./data/pokedex.json";
const INITIAL_BATCH_SIZE = 48;
const BATCH_SIZE = 48;

const state = {
  data: null,
  query: "",
  generation: "all",
  status: "all",
  sort: "number",
  visibleCount: INITIAL_BATCH_SIZE,
};

const elements = {
  heroRate: document.querySelector("#hero-rate"),
  heroOwned: document.querySelector("#hero-owned"),
  heroTotal: document.querySelector("#hero-total"),
  heroMissing: document.querySelector("#hero-missing"),
  progressRing: document.querySelector("#progress-ring"),
  statOwned: document.querySelector("#stat-owned"),
  statMissing: document.querySelector("#stat-missing"),
  statRate: document.querySelector("#stat-rate"),
  searchInput: document.querySelector("#search-input"),
  generationFilters: document.querySelector("#generation-filters"),
  statusFilters: document.querySelector("#status-filters"),
  sortSelect: document.querySelector("#sort-select"),
  resultCount: document.querySelector("#result-count"),
  activeFilterLabel: document.querySelector("#active-filter-label"),
  resetFilters: document.querySelector("#reset-filters"),
  grid: document.querySelector("#card-grid"),
  emptyState: document.querySelector("#empty-state"),
  loadMore: document.querySelector("#load-more"),
  visibleCount: document.querySelector("#visible-count"),
  cardTemplate: document.querySelector("#card-template"),
  dialog: document.querySelector("#card-dialog"),
  dialogClose: document.querySelector("#dialog-close"),
  dialogImageWrap: document.querySelector(".dialog-card-image"),
  dialogImage: document.querySelector("#dialog-image"),
  dialogNumber: document.querySelector("#dialog-number"),
  dialogStatus: document.querySelector("#dialog-status"),
  dialogNameKo: document.querySelector("#dialog-name-ko"),
  dialogNameEn: document.querySelector("#dialog-name-en"),
  dialogGeneration: document.querySelector("#dialog-generation"),
  appError: document.querySelector("#app-error"),
};

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function normalizeSearch(value) {
  return value.trim().toLocaleLowerCase("ko-KR");
}

function isDefaultFilterState() {
  return (
    !state.query &&
    state.generation === "all" &&
    state.status === "all" &&
    state.sort === "number"
  );
}

function setText(element, value) {
  element.textContent = String(value);
}

function setSummary(meta) {
  setText(elements.heroRate, `${meta.completionRate.toFixed(1)}%`);
  setText(elements.heroOwned, formatNumber(meta.owned));
  setText(elements.heroTotal, formatNumber(meta.recordCount));
  setText(elements.heroMissing, formatNumber(meta.missing));
  setText(elements.statOwned, formatNumber(meta.owned));
  setText(elements.statMissing, formatNumber(meta.missing));
  setText(elements.statRate, meta.completionRate.toFixed(1));
  elements.progressRing.style.setProperty("--progress", meta.completionRate);
}

function createGenerationFilters(generations) {
  const fragment = document.createDocumentFragment();

  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.dataset.generation = "all";
  allButton.className = "is-active";
  allButton.textContent = "전체";
  allButton.setAttribute("aria-pressed", "true");
  fragment.append(allButton);

  for (const generation of generations) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.generation = String(generation.generation);
    button.textContent = `${generation.generation}세대`;
    button.title = `${generation.owned}/${generation.count}종 · ${generation.completionRate.toFixed(1)}%`;
    button.setAttribute("aria-pressed", "false");
    fragment.append(button);
  }

  elements.generationFilters.replaceChildren(fragment);
}

function getFilteredRecords() {
  const query = normalizeSearch(state.query);
  const numericQuery = query.replace(/^#?0+/, "");

  const filtered = state.data.records.filter((record) => {
    if (
      state.generation !== "all" &&
      record.generation !== Number(state.generation)
    ) {
      return false;
    }

    if (state.status === "owned" && !record.owned) {
      return false;
    }

    if (state.status === "missing" && record.owned) {
      return false;
    }

    if (!query) {
      return true;
    }

    const searchable = [
      record.nameKo,
      record.nameEn,
      record.numberLabel,
      String(record.number),
    ]
      .join(" ")
      .toLocaleLowerCase("ko-KR");

    return (
      searchable.includes(query) ||
      (numericQuery && String(record.number).includes(numericQuery))
    );
  });

  return filtered.sort((a, b) => {
    if (state.sort === "nameKo") {
      return a.nameKo.localeCompare(b.nameKo, "ko-KR");
    }

    if (state.sort === "missingFirst") {
      return Number(a.owned) - Number(b.owned) || a.number - b.number;
    }

    return a.number - b.number;
  });
}

function statusLabel(record) {
  return record.owned ? "✓ 보유" : "○ 미보유";
}

function applyStatusBadge(badge, owned) {
  badge.classList.toggle("is-owned", owned);
  badge.classList.toggle("is-missing", !owned);
  badge.textContent = owned ? "✓ 보유" : "○ 미보유";
}

function createCard(record) {
  const node = elements.cardTemplate.content.firstElementChild.cloneNode(true);
  const button = node.querySelector(".pokemon-card-button");
  const image = node.querySelector(".card-image");
  const number = node.querySelector(".number-badge");
  const badge = node.querySelector(".status-badge");
  const nameKo = node.querySelector(".card-name-ko");
  const nameEn = node.querySelector(".card-name-en");
  const generation = node.querySelector(".card-generation");

  node.classList.toggle("is-missing", !record.owned);
  image.src = record.imageUrl;
  image.alt = `${record.nameKo} 포켓몬 카드`;
  image.addEventListener(
    "error",
    () => {
      node.classList.add("has-image-error");
    },
    { once: true },
  );

  number.textContent = record.numberLabel;
  applyStatusBadge(badge, record.owned);
  nameKo.textContent = record.nameKo;
  nameEn.textContent = record.nameEn;
  generation.textContent = `${record.generation}세대`;
  button.setAttribute(
    "aria-label",
    `${record.numberLabel} ${record.nameKo}, ${statusLabel(record)}, 상세 보기`,
  );
  button.addEventListener("click", () => openCardDialog(record));

  return node;
}

function getActiveFilterLabel() {
  const labels = [];

  if (state.generation !== "all") {
    labels.push(`${state.generation}세대`);
  }

  if (state.status === "owned") {
    labels.push("보유");
  } else if (state.status === "missing") {
    labels.push("미보유");
  }

  if (state.query) {
    labels.push(`“${state.query}”`);
  }

  return labels.length ? `· ${labels.join(" · ")}` : "";
}

function render() {
  const records = getFilteredRecords();
  const visibleRecords = records.slice(0, state.visibleCount);
  const fragment = document.createDocumentFragment();

  for (const record of visibleRecords) {
    fragment.append(createCard(record));
  }

  elements.grid.replaceChildren(fragment);
  elements.grid.setAttribute("aria-busy", "false");
  setText(elements.resultCount, formatNumber(records.length));
  setText(elements.activeFilterLabel, getActiveFilterLabel());

  const hasResults = records.length > 0;
  elements.grid.hidden = !hasResults;
  elements.emptyState.hidden = hasResults;
  elements.loadMore.hidden =
    !hasResults || visibleRecords.length >= records.length;
  elements.visibleCount.textContent = hasResults
    ? `${formatNumber(visibleRecords.length)} / ${formatNumber(records.length)}종 표시 중`
    : "";
  elements.resetFilters.hidden = isDefaultFilterState();
}

function resetFilters() {
  state.query = "";
  state.generation = "all";
  state.status = "all";
  state.sort = "number";
  state.visibleCount = INITIAL_BATCH_SIZE;

  elements.searchInput.value = "";
  elements.sortSelect.value = "number";

  for (const button of elements.generationFilters.querySelectorAll("button")) {
    const isActive = button.dataset.generation === "all";
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }

  for (const button of elements.statusFilters.querySelectorAll("button")) {
    button.classList.toggle("is-active", button.dataset.status === "all");
  }

  render();
}

function openCardDialog(record) {
  elements.dialogImage.src = record.imageUrl;
  elements.dialogImage.alt = `${record.nameKo} 포켓몬 카드 크게 보기`;
  elements.dialogImageWrap.classList.toggle("is-missing", !record.owned);
  elements.dialogNumber.textContent = record.numberLabel;
  applyStatusBadge(elements.dialogStatus, record.owned);
  elements.dialogNameKo.textContent = record.nameKo;
  elements.dialogNameEn.textContent = record.nameEn;
  elements.dialogGeneration.textContent = `${record.generation}세대`;
  elements.dialog.showModal();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.query = event.currentTarget.value;
    state.visibleCount = INITIAL_BATCH_SIZE;
    render();
  });

  elements.generationFilters.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-generation]");
    if (!button) {
      return;
    }

    state.generation = button.dataset.generation;
    state.visibleCount = INITIAL_BATCH_SIZE;

    for (const candidate of elements.generationFilters.querySelectorAll(
      "button",
    )) {
      const isActive = candidate === button;
      candidate.classList.toggle("is-active", isActive);
      candidate.setAttribute("aria-pressed", String(isActive));
    }

    render();
  });

  elements.statusFilters.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-status]");
    if (!button) {
      return;
    }

    state.status = button.dataset.status;
    state.visibleCount = INITIAL_BATCH_SIZE;

    for (const candidate of elements.statusFilters.querySelectorAll("button")) {
      candidate.classList.toggle("is-active", candidate === button);
    }

    render();
  });

  elements.sortSelect.addEventListener("change", (event) => {
    state.sort = event.currentTarget.value;
    state.visibleCount = INITIAL_BATCH_SIZE;
    render();
  });

  elements.loadMore.addEventListener("click", () => {
    state.visibleCount += BATCH_SIZE;
    render();
  });

  elements.resetFilters.addEventListener("click", resetFilters);

  for (const button of document.querySelectorAll("[data-reset]")) {
    button.addEventListener("click", resetFilters);
  }

  elements.dialogClose.addEventListener("click", () => {
    elements.dialog.close();
  });

  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) {
      elements.dialog.close();
    }
  });

  document.addEventListener("keydown", (event) => {
    const isShortcut =
      (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
    if (!isShortcut) {
      return;
    }

    event.preventDefault();
    elements.searchInput.focus();
  });
}

async function init() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`Data request failed with ${response.status}`);
    }

    state.data = await response.json();
    setSummary(state.data.meta);
    createGenerationFilters(state.data.generations);
    bindEvents();
    render();

    const requestedNumber = Number(
      new URLSearchParams(window.location.search).get("pokemon"),
    );
    if (requestedNumber) {
      const record = state.data.records.find(
        (candidate) => candidate.number === requestedNumber,
      );
      if (record) {
        openCardDialog(record);
      }
    }
  } catch (error) {
    console.error(error);
    elements.grid.setAttribute("aria-busy", "false");
    elements.appError.hidden = false;
  }
}

init();
