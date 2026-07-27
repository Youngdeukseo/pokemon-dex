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
  return card.actualName || card.name || card.code;
}

function baseCardNumber(card) {
  const value = String(card.cardNumber || card.code || card.meta || "");
  const separator = value.lastIndexOf("_");
  return separator >= 0 ? value.slice(separator + 1) : value;
}

function actualCardCode(card) {
  if (card.actualSetCode && card.actualCardNumber) {
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

function normalizeSetCode(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9-]/gi, "")
    .toUpperCase();
}

function normalizedCardNumber(value) {
  const numerator = String(value || "").split("/")[0].match(/\d{1,4}/)?.[0];
  return numerator ? numerator.padStart(3, "0") : "";
}

function lookupImageInCatalog(setCode, cardNumber) {
  const normalizedSet = normalizeSetCode(setCode);
  const normalizedNumber = normalizedCardNumber(cardNumber);
  if (!normalizedSet || !normalizedNumber) return "";

  for (const group of groups) {
    if (normalizeSetCode(group.code || group.name) !== normalizedSet) continue;
    for (const card of group.cards || []) {
      const code = String(card.code || card.meta || "");
      const codeSet = code.includes("_") ? code.split("_")[0] : group.code;
      if (
        normalizeSetCode(codeSet) === normalizedSet &&
        normalizedCardNumber(baseCardNumber(card)) === normalizedNumber
      ) {
        return card.originalImage || card.image || "";
      }
    }
  }
  return "";
}

function officialImageCandidates(setCode, cardNumber) {
  const code = normalizeSetCode(setCode);
  const number = normalizedCardNumber(cardNumber);
  if (!code || !number) return [];

  let primaryRoot = "";
  if (code.startsWith("SV")) primaryRoot = "SV";
  else if (code.startsWith("SM")) primaryRoot = "SM";
  else if (code.startsWith("XY")) primaryRoot = "XY";
  else if (code.startsWith("BW")) primaryRoot = "BW";
  else if (/^M\d/.test(code)) primaryRoot = "MEGA";
  else if (code.startsWith("S")) primaryRoot = "S";

  const roots = [
    primaryRoot,
    "SV",
    "S",
    "MEGA",
    "SM",
    "XY",
    "BW",
  ].filter((root, index, values) => root && values.indexOf(root) === index);
  const base = "https://cards.image.pokemonkorea.co.kr/data/wmimages";
  return roots.map((root) => `${base}/${root}/${code}/${code}_${number}.png`);
}

function imageLoads(url, timeout = 5000) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(false);
      return;
    }

    const probe = new Image();
    let settled = false;
    const finish = (success) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      probe.onload = null;
      probe.onerror = null;
      resolve(success);
    };
    const timer = window.setTimeout(() => finish(false), timeout);
    probe.onload = () => finish(probe.naturalWidth > 0);
    probe.onerror = () => finish(false);
    probe.src = url;
  });
}

async function findSeriesCardImage(setCode, cardNumber) {
  const candidates = [
    lookupImageInCatalog(setCode, cardNumber),
    ...officialImageCandidates(setCode, cardNumber),
  ].filter((url, index, values) => url && values.indexOf(url) === index);

  if (!candidates.length) return "";
  if (await imageLoads(candidates[0])) return candidates[0];

  const results = await Promise.all(
    candidates.slice(1).map(async (url) => ({
      url,
      loaded: await imageLoads(url),
    })),
  );
  return results.find((result) => result.loaded)?.url || "";
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
  const owned = seriesEditorOwned();
  editor.querySelectorAll("[data-series-card-field]").forEach((field) => {
    field.disabled = !canEdit || !owned;
  });
  editor
    .querySelectorAll('input[name="series-owned-status"]')
    .forEach((field) => {
      field.disabled = !canEdit;
    });

  const save = $("series-card-save");
  if (save) {
    save.disabled = !canEdit;
    save.textContent = owned ? "이미지 찾아 저장" : "미보유로 저장";
  }

  if (!canEdit) {
    setSeriesEditorMessage(
      "Google 로그인 후 실제 보유 카드 정보를 입력할 수 있습니다.",
      "guest",
    );
  } else if (owned) {
    setSeriesEditorMessage(
      "세트 코드와 카드번호로 공식 카드 이미지를 자동으로 찾습니다.",
    );
  } else {
    setSeriesEditorMessage(
      "저장하면 이 카드는 미보유로 표시되고 기본 이미지로 돌아갑니다.",
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

  const setValue = (id, value) => {
    const field = $(id);
    if (field) field.value = value || "";
  };
  setValue("series-edit-set", card.actualSetCode || selected?.code || "");
  setValue(
    "series-edit-number",
    card.actualCardNumber || baseCardNumber(card),
  );
  setValue("series-edit-name", card.actualName || card.name || "");

  const actual = card.actualSetCode && card.actualCardNumber
    ? `${card.actualSetCode} ${card.actualCardNumber}${
        card.actualName ? ` · ${card.actualName}` : ""
      }`
    : "—";
  setText("dialog-actual-card", actual);
  updateSeriesEditorState();
}

function createSeriesEditor() {
  if (mode !== "series" || $("series-card-editor")) return;

  const details = document.querySelector("#catalog-dialog .dialog-details");
  if (!details) return;

  const actualRow = document.createElement("div");
  actualRow.innerHTML =
    '<dt>실제 보유 카드</dt><dd id="dialog-actual-card">—</dd>';
  details.append(actualRow);

  const editor = document.createElement("section");
  editor.id = "series-card-editor";
  editor.className = "collection-editor series-card-editor";
  editor.innerHTML = `
    <div class="collection-editor-heading">
      <div><span>MY CARD RECORD</span><strong>내 실제 보유 카드 입력</strong></div>
      <div class="series-status-toggle" role="radiogroup" aria-label="보유 상태">
        <label><input name="series-owned-status" type="radio" value="owned"><span>보유</span></label>
        <label><input name="series-owned-status" type="radio" value="missing"><span>미보유</span></label>
      </div>
    </div>
    <div class="collection-editor-grid">
      <label><span>세트 코드</span><input id="series-edit-set" data-series-card-field type="text" placeholder="예: sv2a"></label>
      <label><span>카드번호</span><input id="series-edit-number" data-series-card-field type="text" placeholder="예: 025/165"></label>
      <label class="collection-editor-wide"><span>카드명</span><input id="series-edit-name" data-series-card-field type="text" placeholder="예: 피카츄"></label>
    </div>
    <p id="series-editor-message" class="series-editor-message"></p>
    <div class="collection-editor-actions">
      <span></span>
      <button id="series-card-save" class="primary-button" type="button">이미지 찾아 저장</button>
    </div>
    <p class="collection-save-hint">이미지 URL은 입력하지 않아도 됩니다. 저장 내용은 로그인한 계정에만 반영됩니다.</p>
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
      "Google 로그인 후 실제 보유 카드 정보를 저장할 수 있습니다.",
      "error",
    );
    return;
  }

  const owned = seriesEditorOwned();
  const setCode = $("series-edit-set")?.value.trim() || "";
  const cardNumber = $("series-edit-number")?.value.trim() || "";
  const cardName = $("series-edit-name")?.value.trim() || "";
  const save = $("series-card-save");
  let imageUrl = "";

  if (owned && (!normalizeSetCode(setCode) || !normalizedCardNumber(cardNumber))) {
    setSeriesEditorMessage(
      "보유 카드의 세트 코드와 카드번호를 입력해주세요.",
      "error",
    );
    return;
  }

  save.disabled = true;
  save.textContent = owned ? "카드 찾는 중…" : "저장 중…";

  try {
    if (owned) {
      setSeriesEditorMessage("공식 카드 이미지를 찾고 있습니다.", "loading");
      imageUrl = await findSeriesCardImage(setCode, cardNumber);
      if (!imageUrl) {
        throw new Error(
          "해당 카드를 찾지 못했습니다. 세트 코드와 카드번호를 다시 확인해주세요.",
        );
      }
    }

    const saved = await account.saveOverride(activeCard.accountKey, {
      owned,
      setCode: owned ? setCode : "",
      cardNumber: owned ? cardNumber : "",
      cardName: owned ? cardName : "",
      imageUrl: owned ? imageUrl : "",
    });

    activeCard.owned = saved.owned;
    activeCard.actualSetCode = saved.setCode;
    activeCard.actualCardNumber = saved.cardNumber;
    activeCard.actualName = saved.cardName;
    activeCard.actualImage = saved.imageUrl;
    activeCard.image = saved.imageUrl || activeCard.originalImage || "";

    refreshCounts();
    render();
    updateDialog(activeCard);
    fillSeriesEditor(activeCard);
    setSeriesEditorMessage(
      owned
        ? "카드 이미지와 보유 정보가 저장되었습니다."
        : "미보유로 저장되었습니다.",
      "success",
    );
  } catch (error) {
    console.error(error);
    setSeriesEditorMessage(error.message || "저장하지 못했습니다.", "error");
  } finally {
    save.disabled = false;
    save.textContent = seriesEditorOwned()
      ? "이미지 찾아 저장"
      : "미보유로 저장";
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
