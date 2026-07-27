"use strict";

const $ = (id) => document.getElementById(id);
const mode = document.body.dataset.catalog;
const DATA_URL =
  mode === "series"
    ? "./data/series.json"
    : "./data/pokemon-collections.json";

const SERIES_NAMES = Object.freeze({
  sv1S: "스칼렛 ex",
  sv1V: "바이올렛 ex",
  sv1a: "트리플렛비트",
  sv2D: "클레이버스트",
  sv2P: "스노해저드",
  sv2a: "포켓몬 카드 151",
  sv3: "흑염의 지배자",
  sv3a: "레이징서프",
  sv4K: "고대의 포효",
  sv4M: "미래의 일섬",
  sv4a: "샤이니트레저 ex",
  sv5K: "와일드포스",
  sv5M: "사이버저지",
  sv5a: "크림슨헤이즈",
  sv6: "변환의 가면",
  sv6a: "나이트 원더러",
  sv7: "스텔라미라클",
  sv7a: "낙원드래고나",
  sv8: "초전브레이커",
  sv9: "배틀파트너즈",
  sv9a: "열풍의 아레나",
  sv10: "로켓단의 영광",
  sv11B: "블랙볼트",
  sv11W: "화이트플레어",
  m1S: "메가심포니아",
  m1L: "메가브레이브",
  m2: "인페르노X",
  m2a: "MEGA 드림 ex",
  m3: "니힐제로",
  m4: "닌자스피너",
  m5: "어비스아이",
  sD: "스타터 세트 V",
});

let groups = [];
let selected = null;
let cards = [];
let status = "all";
let query = "";
let activeCard = null;

const pct = (amount, total) =>
  total ? Math.round((amount / total) * 1000) / 10 : 0;

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function imageFor(card) {
  return card.image || "";
}

function displayName(card) {
  return mode === "series"
    ? card.name || card.code
    : card.actualName || card.name || card.code;
}

function actualCardCode(card) {
  if (
    mode !== "series" &&
    card.actualSetCode &&
    card.actualCardNumber
  ) {
    return `${card.actualSetCode}_${card.actualCardNumber}`;
  }
  return card.code || card.meta || "";
}

function groupName(group) {
  if (mode === "series") {
    return SERIES_NAMES[group.code] || group.title || group.name || group.code;
  }
  return group.title || group.name || group.code;
}

function badge(owned) {
  const element = document.createElement("span");
  element.className = `status-badge ${owned ? "is-owned" : "is-missing"}`;
  element.textContent = owned ? "보유" : "미보유";
  return element;
}

function updateSummary() {
  const total = groups.reduce((amount, group) => amount + group.total, 0);
  const owned = groups.reduce((amount, group) => amount + group.owned, 0);
  const rate = pct(owned, total);

  setText("catalog-owned", owned);
  setText("catalog-total", total);
  setText("catalog-missing", total - owned);
  setText("catalog-rate", `${rate}%`);
  setText("stat-catalog-groups", groups.length);
  setText("stat-catalog-total", total);
  setText("stat-catalog-rate", rate);
  $("catalog-progress-ring").style.setProperty("--progress", rate);
}

function updateSelected() {
  const owned = cards.filter((card) => card.owned).length;
  setText("selected-name", groupName(selected));
  setText(
    "selected-progress",
    `${owned} / ${cards.length}장 · ${pct(owned, cards.length)}%`,
  );
}

function setSeriesEditorMessage(message, state = "") {
  const element = $("series-editor-message");
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}

function seriesEditorOwned() {
  return Boolean(
    document.querySelector('input[name="series-owned-status"]:checked')
      ?.value === "owned",
  );
}

function updateSeriesEditorState() {
  const editor = $("series-card-editor");
  if (!editor) return;

  const account = window.PokemonDexPageAccount;
  const canEdit = Boolean(account?.canEdit?.());
  editor
    .querySelectorAll('input[name="series-owned-status"]')
    .forEach((field) => {
      field.disabled = !canEdit;
    });

  const save = $("series-card-save");
  if (save) {
    save.disabled = !canEdit;
    save.textContent = "보유 상태 저장";
  }

  if (!canEdit) {
    setSeriesEditorMessage(
      "Google 로그인 후 이 카드의 보유 상태를 변경할 수 있습니다.",
      "guest",
    );
  } else {
    setSeriesEditorMessage(
      "시리즈와 카드번호는 고정되어 있으며 보유 여부만 저장됩니다.",
    );
  }
}

function fillSeriesEditor(card) {
  if (mode !== "series" || !card) return;

  const ownedValue = card.owned ? "owned" : "missing";
  const statusInput = document.querySelector(
    `input[name="series-owned-status"][value="${ownedValue}"]`,
  );
  if (statusInput) statusInput.checked = true;
  updateSeriesEditorState();
}

function createSeriesEditor() {
  if (mode !== "series" || $("series-card-editor")) return;

  const details = document.querySelector("#catalog-dialog .dialog-details");
  if (!details) return;

  const editor = document.createElement("section");
  editor.id = "series-card-editor";
  editor.className = "collection-editor series-card-editor";
  editor.innerHTML = `
    <div class="collection-editor-heading">
      <div><span>MY COLLECTION</span><strong>이 카드의 보유 상태</strong></div>
      <div class="series-status-toggle" role="radiogroup" aria-label="보유 상태">
        <label><input name="series-owned-status" type="radio" value="owned"><span>보유</span></label>
        <label><input name="series-owned-status" type="radio" value="missing"><span>미보유</span></label>
      </div>
    </div>
    <p id="series-editor-message" class="series-editor-message"></p>
    <div class="collection-editor-actions">
      <span></span>
      <button id="series-card-save" class="primary-button" type="button">보유 상태 저장</button>
    </div>
    <p class="collection-save-hint">카드 이미지는 시리즈 원본으로 고정되며, 보유 상태만 로그인한 계정에 반영됩니다.</p>
  `;
  details.after(editor);

  editor
    .querySelectorAll('input[name="series-owned-status"]')
    .forEach((input) => input.addEventListener("change", updateSeriesEditorState));
  $("series-card-save")?.addEventListener("click", saveSeriesCard);
  updateSeriesEditorState();
}

function refreshCounts() {
  groups.forEach((group) => {
    group.total = group.cards.length;
    group.owned = group.cards.filter((card) => card.owned).length;
  });
  updateSummary();
  updateSelected();
}

async function saveSeriesCard() {
  const account = window.PokemonDexPageAccount;
  if (!activeCard || !account?.canEdit?.()) {
    setSeriesEditorMessage(
      "Google 로그인 후 보유 상태를 저장할 수 있습니다.",
      "error",
    );
    return;
  }

  const owned = seriesEditorOwned();
  const save = $("series-card-save");

  save.disabled = true;
  save.textContent = "저장 중…";

  try {
    const saved = await account.saveOverride(activeCard.accountKey, {
      owned,
    });

    activeCard.owned = saved.owned;
    activeCard.actualSetCode = "";
    activeCard.actualCardNumber = "";
    activeCard.actualName = "";
    activeCard.actualImage = "";
    activeCard.image = activeCard.originalImage || "";

    refreshCounts();
    render();
    updateDialog(activeCard);
    fillSeriesEditor(activeCard);
    setSeriesEditorMessage(
      owned ? "보유 카드로 저장되었습니다." : "미보유 카드로 저장되었습니다.",
      "success",
    );
  } catch (error) {
    console.error(error);
    setSeriesEditorMessage(error.message || "저장하지 못했습니다.", "error");
  } finally {
    save.disabled = false;
    save.textContent = "보유 상태 저장";
  }
}

function updateDialog(card) {
  const image = $("catalog-dialog-image");
  const imageWrap = $("catalog-dialog-image-wrap");

  image.src = imageFor(card);
  image.alt = `${displayName(card)} 카드`;
  imageWrap.classList.toggle("is-missing", !card.owned);
  setText("dialog-code", actualCardCode(card));

  const statusBadge = $("dialog-status");
  statusBadge.className = `status-badge ${
    card.owned ? "is-owned" : "is-missing"
  }`;
  statusBadge.textContent = badge(card.owned).textContent;

  setText("dialog-name", displayName(card));
  setText("dialog-meta", card.code || card.meta);
  setText("dialog-group", groupName(selected));
}

function openDialog(card) {
  const dialog = $("catalog-dialog");
  activeCard = card;
  updateDialog(card);
  fillSeriesEditor(card);

  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function makeCard(card) {
  const article = document.createElement("article");
  article.className = `pokemon-card catalog-card${
    card.owned ? "" : " is-missing"
  }`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pokemon-card-button";

  const imageWrap = document.createElement("span");
  imageWrap.className = "card-image-wrap";

  const image = document.createElement("img");
  image.className = "card-image";
  image.loading = "lazy";
  image.src = imageFor(card);
  image.alt = `${displayName(card)} 카드`;
  image.onerror = () => article.classList.add("has-image-error");

  const missing = document.createElement("span");
  missing.className = "missing-overlay";
  missing.textContent = "미보유";

  const fallback = document.createElement("span");
  fallback.className = "image-fallback";
  fallback.innerHTML =
    '<span class="fallback-ball"><span></span></span>이미지를 불러오지 못했습니다';
  imageWrap.append(image, missing, fallback);

  const body = document.createElement("span");
  body.className = "card-body";

  const top = document.createElement("span");
  top.className = "card-topline";
  const number = document.createElement("span");
  number.className = "number-badge";
  number.textContent = card.code || card.meta;
  top.append(number, badge(card.owned));

  const name = document.createElement("strong");
  name.className = "card-name-ko";
  name.textContent = displayName(card);

  const group = document.createElement("span");
  group.className = "card-name-en";
  group.textContent = groupName(selected);

  const meta = document.createElement("span");
  meta.className = "card-meta";
  meta.textContent = actualCardCode(card);

  body.append(top, name, group, meta);
  button.append(imageWrap, body);
  button.onclick = () => openDialog(card);
  article.append(button);
  return article;
}

function render() {
  const normalizedQuery = query.trim().toLowerCase();
  const selectedGroupName = groupName(selected).toLowerCase();
  const shown = cards.filter((card) => {
    const matchesStatus =
      status === "all" || (status === "owned") === card.owned;
    const haystack = [
      card.name,
      card.actualName,
      card.actualSetCode,
      card.actualCardNumber,
      card.code,
      card.meta,
      selected?.code,
      selectedGroupName,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return matchesStatus && (!normalizedQuery || haystack.includes(normalizedQuery));
  });

  $("catalog-grid").replaceChildren(...shown.map(makeCard));
  setText("result-count", shown.length);
  $("catalog-empty").hidden = shown.length !== 0;
}

function loadGroup(value) {
  selected =
    groups.find((group) => (group.code || group.name) === value) || groups[0];
  cards = selected.cards;
  updateSelected();
  render();
}

async function init() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status);
    groups = await response.json();

    const account = window.PokemonDexPageAccount;
    if (account) {
      await account.ready;
      account.applyGroups(groups);
    }

    groups.forEach((group) => {
      group.total = group.cards.length;
      group.owned = group.cards.filter((card) => card.owned).length;
    });

    createSeriesEditor();
    updateSummary();

    const select = $("catalog-select");
    groups.forEach((group) => {
      const option = document.createElement("option");
      option.value = group.code || group.name;
      option.textContent = `${groupName(group)} · ${group.total}장`;
      select.append(option);
    });

    select.onchange = () => loadGroup(select.value);
    $("catalog-search").oninput = (event) => {
      query = event.target.value;
      render();
    };
    $("catalog-status").onclick = (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      status = button.dataset.status;
      event.currentTarget
        .querySelectorAll("button")
        .forEach((item) => item.classList.toggle("is-active", item === button));
      render();
    };
    $("dialog-close").onclick = () => {
      const dialog = $("catalog-dialog");
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    };

    loadGroup(select.value || groups[0].code || groups[0].name);
  } catch (error) {
    console.error(error);
    $("catalog-error").hidden = false;
  }
}

init();
