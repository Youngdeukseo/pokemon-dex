"use strict";

const $ = (id) => document.getElementById(id);
const DATA_URL = "./data/ar.json";
const EXPECTED_GROUPS = 32;
const EXPECTED_TOTAL = 498;

let groups = [];
let allCards = [];
let selectedCode = "all";
let status = "all";
let query = "";
let activeCard = null;

const pct = (amount, total) =>
  total ? Math.round((amount / total) * 1000) / 10 : 0;

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function pad(number) {
  return String(number).padStart(3, "0");
}

function visibleCards() {
  return selectedCode === "all"
    ? allCards
    : groups.find((group) => group.code === selectedCode)?.cards || [];
}

function selectedLabel() {
  if (selectedCode === "all") return "전체 AR 모음";
  const group = groups.find((item) => item.code === selectedCode);
  return group ? `${group.code} · ${group.title}` : "전체 AR 모음";
}

function badge(owned) {
  const element = document.createElement("span");
  element.className = `status-badge ${owned ? "is-owned" : "is-missing"}`;
  element.textContent = owned ? "보유" : "미보유";
  return element;
}

function refreshCounts() {
  groups.forEach((group) => {
    group.total = group.cards.length;
    group.owned = group.cards.filter((card) => card.owned).length;
  });

  const total = allCards.length;
  const owned = allCards.filter((card) => card.owned).length;
  const rate = pct(owned, total);
  const selectedCards = visibleCards();
  const selectedOwned = selectedCards.filter((card) => card.owned).length;

  setText("catalog-owned", owned);
  setText("catalog-total", total);
  setText("catalog-missing", total - owned);
  setText("catalog-rate", `${rate}%`);
  setText("stat-catalog-groups", groups.length);
  setText("stat-catalog-total", total);
  setText("stat-catalog-rate", rate);
  setText("selected-name", selectedLabel());
  setText(
    "selected-progress",
    `${selectedOwned} / ${selectedCards.length}장 · ${pct(selectedOwned, selectedCards.length)}%`,
  );
  $("catalog-progress-ring").style.setProperty("--progress", rate);
}

function updateDialog(card) {
  const image = $("catalog-dialog-image");
  const imageWrap = $("catalog-dialog-image-wrap");
  const imageFallback = $("catalog-dialog-image-fallback");
  imageWrap.classList.remove("has-image-error");
  image.onload = () => imageWrap.classList.remove("has-image-error");
  image.onerror = () => imageWrap.classList.add("has-image-error");
  image.src = card.image;
  image.alt = `${card.name} 카드`;
  imageWrap.classList.toggle("is-missing", !card.owned);
  imageFallback.textContent =
    card.setCode.toLowerCase() === "m5"
      ? "포켓몬코리아 공식 AR 이미지 준비 중"
      : "이미지를 불러오지 못했습니다";

  setText("dialog-code", card.code);
  setText("dialog-name", card.name);
  setText("dialog-meta", `${card.setCode.toUpperCase()} ART RARE`);
  setText("dialog-group", `${card.setCode} · ${card.setTitle}`);
  setText("dialog-number", `${pad(card.number)} / ${card.denominator}`);

  const statusBadge = $("dialog-status");
  statusBadge.className = `status-badge ${card.owned ? "is-owned" : "is-missing"}`;
  statusBadge.textContent = card.owned ? "보유" : "미보유";

  const toggle = $("dialog-toggle");
  toggle.classList.toggle("is-complete", card.owned);
  toggle.disabled = false;
  toggle.textContent = card.owned ? "✓ 수집완료" : "수집완료로 표시";
}

function openDialog(card) {
  activeCard = card;
  updateDialog(card);
  const dialog = $("catalog-dialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function updateCompletionButton(button, card) {
  const owned = Boolean(card.owned);
  button.classList.toggle("is-complete", owned);
  button.classList.remove("is-saving");
  button.disabled = false;
  button.setAttribute("aria-pressed", String(owned));
  button.setAttribute(
    "aria-label",
    owned ? `${card.name} 수집완료 취소` : `${card.name} 수집완료로 표시`,
  );
  button.title = owned
    ? "다시 누르면 미보유로 변경됩니다."
    : "로그인한 내 도감에 수집완료로 저장합니다.";
  button.textContent = owned ? "✓ 수집완료" : "수집완료";
}

async function toggleCard(card, button) {
  const account = window.PokemonDexPageAccount;
  if (!account?.canEdit?.()) {
    alert("Google 로그인 후 내 수집 상태를 저장할 수 있습니다.");
    return;
  }

  const nextOwned = !card.owned;
  if (button) {
    button.disabled = true;
    button.classList.add("is-saving");
    button.textContent = "저장 중…";
  }

  const dialogToggle = $("dialog-toggle");
  if (activeCard === card) {
    dialogToggle.disabled = true;
    dialogToggle.textContent = "저장 중…";
  }

  try {
    const saved = await account.saveOwned(card.accountKey, nextOwned);
    card.owned = saved.owned;
    refreshCounts();
    render();
    if (activeCard === card) updateDialog(card);
  } catch (error) {
    console.error(error);
    alert(error.message || "수집 상태를 저장하지 못했습니다.");
    if (button) updateCompletionButton(button, card);
    if (activeCard === card) updateDialog(card);
  }
}

function makeCard(card) {
  const article = document.createElement("article");
  article.className = `pokemon-card ar-card catalog-card has-completion-action${
    card.owned ? "" : " is-missing"
  }`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pokemon-card-button";
  button.addEventListener("click", () => openDialog(card));

  const imageWrap = document.createElement("span");
  imageWrap.className = "card-image-wrap";

  const image = document.createElement("img");
  image.className = "card-image";
  image.loading = "lazy";
  image.src = card.image;
  image.alt = `${card.name} 카드`;
  image.onerror = () => article.classList.add("has-image-error");

  const missing = document.createElement("span");
  missing.className = "missing-overlay";
  missing.textContent = "미보유";

  const rarity = document.createElement("span");
  rarity.className = "ar-rarity-badge";
  rarity.textContent = "AR";

  const fallback = document.createElement("span");
  fallback.className = "image-fallback";
  const fallbackBall = document.createElement("span");
  fallbackBall.className = "fallback-ball";
  fallbackBall.append(document.createElement("span"));
  const fallbackCopy = document.createElement("span");
  fallbackCopy.textContent =
    card.setCode.toLowerCase() === "m5"
      ? "포켓몬코리아 공식 AR 이미지 준비 중"
      : "이미지를 불러오지 못했습니다";
  fallback.append(fallbackBall, fallbackCopy);
  imageWrap.append(image, missing, rarity, fallback);

  const body = document.createElement("span");
  body.className = "card-body";

  const top = document.createElement("span");
  top.className = "card-topline";
  const number = document.createElement("span");
  number.className = "number-badge";
  number.textContent = card.code;
  top.append(number, badge(card.owned));

  const name = document.createElement("strong");
  name.className = "card-name-ko";
  name.textContent = card.name;

  const setName = document.createElement("span");
  setName.className = "ar-card-set";
  setName.textContent = `${card.setCode} · ${card.setTitle}`;

  const meta = document.createElement("span");
  meta.className = "card-meta";
  meta.textContent = `${pad(card.number)} / ${card.denominator} · ART RARE`;

  body.append(top, name, setName, meta);
  button.append(imageWrap, body);

  const complete = document.createElement("button");
  complete.type = "button";
  complete.className = "collection-complete-button";
  updateCompletionButton(complete, card);
  complete.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void toggleCard(card, complete);
  });

  article.append(button, complete);
  return article;
}

function render() {
  const normalizedQuery = query.trim().toLowerCase();
  const baseCards = visibleCards();
  const shown = baseCards.filter((card) => {
    const matchesStatus =
      status === "all" || (status === "owned") === card.owned;
    const haystack = [
      card.name,
      card.code,
      card.setCode,
      card.setTitle,
      card.number,
    ]
      .join(" ")
      .toLowerCase();
    return matchesStatus && (!normalizedQuery || haystack.includes(normalizedQuery));
  });

  $("catalog-grid").replaceChildren(...shown.map(makeCard));
  setText("result-count", shown.length);

  const empty = $("catalog-empty");
  empty.hidden = shown.length !== 0;
  if (!shown.length && selectedCode === "sv8a" && !normalizedQuery) {
    setText("empty-title", "이 세트에는 AR이 없습니다");
    setText("empty-copy", "테라스탈 페스티벌 ex는 AR 0종으로 확인되었습니다.");
  } else {
    setText("empty-title", "검색 결과가 없습니다");
    setText("empty-copy", "다른 세트나 검색어를 선택해 보세요.");
  }
}

function buildSelect() {
  const select = $("catalog-select");
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = `전체 AR 모음 · ${EXPECTED_TOTAL}장`;
  select.append(all);

  groups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group.code;
    option.textContent = `${group.code} · ${group.title} · ${group.cards.length}장`;
    select.append(option);
  });
}

function normalizeGroups(sourceGroups) {
  groups = sourceGroups.map((group) => ({
    ...group,
    cards: (group.cards || []).map((card) => ({
      ...card,
      setCode: group.code,
      setTitle: group.title,
      owned: Boolean(card.owned),
    })),
  }));

  allCards = groups.flatMap((group) => group.cards);
  if (groups.length !== EXPECTED_GROUPS || allCards.length !== EXPECTED_TOTAL) {
    throw new Error(
      `AR 데이터가 ${groups.length}세트 ${allCards.length}장입니다.`,
    );
  }
}

async function init() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status);
    normalizeGroups(await response.json());

    const account = window.PokemonDexPageAccount;
    if (account) {
      await account.ready;
      account.applyGroups(groups);
    }

    buildSelect();
    refreshCounts();
    render();

    $("catalog-select").addEventListener("change", (event) => {
      selectedCode = event.target.value;
      refreshCounts();
      render();
    });

    $("catalog-search").addEventListener("input", (event) => {
      query = event.target.value;
      render();
    });

    $("catalog-status").addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      status = button.dataset.status;
      event.currentTarget
        .querySelectorAll("button")
        .forEach((item) => item.classList.toggle("is-active", item === button));
      render();
    });

    $("dialog-close").addEventListener("click", () => {
      const dialog = $("catalog-dialog");
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    });

    $("dialog-toggle").addEventListener("click", () => {
      if (activeCard) void toggleCard(activeCard, $("dialog-toggle"));
    });
  } catch (error) {
    console.error(error);
    $("catalog-error").hidden = false;
  }
}

init();
