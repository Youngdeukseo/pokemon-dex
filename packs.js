"use strict";

const SPRITE_COLUMNS = 10;
const SPRITE_ROWS = 7;
const FIREBASE_SDK_VERSION = "10.12.5";

const packs = [
  ["S","소드","s1W",0],["S","실드","s1H",0],["S","VMAX라이징","s1a",0],["S","반역크래시","s2",0],["S","폭염워커","s2a",0],["S","무한존","s3",0],["S","전설의 고동","s3a",0],["S","앙천의 볼트태클","s4",0],["S","샤이니스타V","s4a",0],["S","일격마스터","s5I",0],["S","연격마스터","s5R",0],["S","쌍벽의 파이터","s5a",0],["S","백은의 랜스","s6H",0],["S","칠흑의 가이스트","s6K",0],["S","이브이 히어로즈","s6a",0],["S","마천퍼펙트","s7D",0],["S","창공스트림","s7R",0],["S","퓨전아츠","s8",0],["S","25th","s8a",0],["S","VMAX 클라이맥스","s8b",0],["S","스타버스","s9",0],["S","배틀리전","s9a",0],["S","스페이스저글러","s10P",0],["S","타임게이저","s10D",0],["S","다크판타스마","s10a",0],["S","Pokémon GO","s10b",0],["S","로스트어비스","s11",0],["S","백열의 아르카나","s11a",0],["S","패러다임트리거","s12",0],["S","VSTAR유니버스","s12a",0],

  ["SV","스칼렛ex","sv1S",1],["SV","바이올렛ex","sv1V",0],["SV","트리플렛비트","sv1a",1],["SV","클레이버스트","sv2D",0],["SV","스노해저드","sv2P",0],["SV","포켓몬카드 151","sv2a",0],["SV","흑염의 지배자","sv3",1],["SV","레이징서프","sv3a",1],["SV","고대의 포효","sv4K",0],["SV","미래의 일섬","sv4M",0],["SV","샤이니트레저ex","sv4a",0],["SV","와일드포스","sv5K",1],["SV","사이버저지","sv5M",0],["SV","크림슨헤이즈","sv5a",1],["SV","변환의 가면","sv6",0],["SV","나이트원더러","sv6a",1],["SV","스텔라미라클","sv7",0],["SV","낙원드래고나","sv7a",1],["SV","초전브레이커","sv8",1],["SV","테라스탈페스ex","sv8a",0],["SV","배틀파트너즈","sv9",1],["SV","열풍의 아레나","sv9a",0],["SV","로켓단의 영광","sv10",1],["SV","블랙볼트","sv11B",0],["SV","화이트플레어","sv11W",0],

  ["M","메가심포니아","m1S",0],["M","메가브레이브","m1L",0],["M","인페르노X","m2",1],["M","MEGA드림ex","m2a",0],["M","니힐제로","m3",0],["M","닌자스피너","m4",1],["M","어비스아이","m5",1]
].map(([era, name, code, owned], i) => ({
  era,
  name,
  code,
  legacyOwned: Boolean(owned),
  owned: false,
  i
}));

const palettes = {
  S: ["#3759b6", "#8a5bd4"],
  SV: ["#d94c60", "#6366c7"],
  M: ["#24314f", "#19a690"]
};

let era = "all";
let status = "all";
let query = "";
let packFirebase = null;
let packUser = null;

const $ = id => document.getElementById(id);
const pct = (n, d) => Math.round(n / d * 1000) / 10;

function getLegacyOwnedCodes() {
  return packs
    .filter(pack => pack.legacyOwned)
    .map(pack => pack.code);
}

function applyOwnedCodes(ownedCodes) {
  const ownedSet = new Set(
    Array.isArray(ownedCodes)
      ? ownedCodes.map(code => String(code).trim().toLowerCase())
      : []
  );

  packs.forEach(pack => {
    pack.owned = ownedSet.has(pack.code.toLowerCase());
  });

  drawSummary();
  render();
}

function ensurePackAuthControls() {
  if (document.getElementById("pack-auth-controls")) {
    return;
  }

  const header = document.querySelector(".site-header");

  if (!header) {
    return;
  }

  const controls = document.createElement("div");
  controls.id = "pack-auth-controls";
  controls.innerHTML = `
    <span id="pack-auth-label">로그인 상태 확인 중…</span>
    <button id="pack-auth-button" type="button">Google 로그인</button>
  `;

  header.append(controls);

  const style = document.createElement("style");
  style.textContent = `
    #pack-auth-controls {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
    }

    #pack-auth-label {
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: rgba(255, 255, 255, 0.78);
    }

    #pack-auth-button {
      border: 1px solid rgba(255, 255, 255, 0.24);
      border-radius: 999px;
      padding: 8px 13px;
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    #pack-auth-button:hover {
      background: rgba(255, 255, 255, 0.18);
    }

    #pack-auth-button:disabled {
      cursor: wait;
      opacity: 0.55;
    }

    @media (max-width: 760px) {
      .site-header {
        flex-wrap: wrap;
      }

      #pack-auth-controls {
        width: 100%;
        justify-content: flex-end;
        margin-left: 0;
      }

      #pack-auth-label {
        max-width: 170px;
      }
    }
  `;

  document.head.append(style);

  document
    .getElementById("pack-auth-button")
    .addEventListener("click", async () => {
      if (packUser) {
        await signOutPackUser();
      } else {
        await signInPackUser();
      }
    });
}

function updatePackAuthControls(user, message = "") {
  ensurePackAuthControls();

  const label = $("pack-auth-label");
  const button = $("pack-auth-button");

  if (!label || !button) {
    return;
  }

  const headerChip = document.querySelector(".header-chip");

if (headerChip) {
  headerChip.textContent = user
    ? "SIGNED IN · PRIVATE COLLECTION"
    : "GUEST · PUBLIC VIEW";
}
  
  if (user) {
    const account =
      user.displayName ||
      user.email ||
      "로그인 사용자";

    label.textContent = message
      ? `${account} · ${message}`
      : account;

    button.textContent = "로그아웃";
  } else {
    label.textContent =
      message || "게스트 · 전체 미보유";

    button.textContent = "Google 로그인";
  }

  button.disabled = false;
}

async function applyPackUserState(user) {
  packUser = user;

  if (!user) {
    applyOwnedCodes([]);
    updatePackAuthControls(null);
    return;
  }

  const email = String(user.email || "")
    .trim()
    .toLowerCase();

  const ownerEmail = String(
    window.POKEMON_DEX_FIREBASE?.ownerEmail ||
    "onesmemory@gmail.com"
  )
    .trim()
    .toLowerCase();

  const baseMode =
    email === ownerEmail
      ? "legacy"
      : "empty";

  const defaultOwnedCodes =
    baseMode === "legacy"
      ? getLegacyOwnedCodes()
      : [];

  const {
    db,
    firestoreModule
  } = packFirebase;

  const docRef = firestoreModule.doc(
    db,
    "users",
    user.uid,
    "collections",
    "packDex"
  );

  try {
    const snapshot =
      await firestoreModule.getDoc(docRef);

    if (!snapshot.exists()) {
      await firestoreModule.setDoc(docRef, {
        baseMode,
        ownedCodes: defaultOwnedCodes,
        updatedAt:
          firestoreModule.serverTimestamp()
      });

      applyOwnedCodes(defaultOwnedCodes);
      updatePackAuthControls(user);
      return;
    }

    const data = snapshot.data() || {};

    const ownedCodes =
      Array.isArray(data.ownedCodes)
        ? data.ownedCodes
        : defaultOwnedCodes;

    applyOwnedCodes(ownedCodes);
    updatePackAuthControls(user);
  } catch (error) {
    console.warn(
      "팩도감 정보를 불러오지 못했습니다.",
      error
    );

    applyOwnedCodes(defaultOwnedCodes);

    updatePackAuthControls(
      user,
      "저장 정보를 불러오지 못해 기본 상태로 표시 중"
    );
  }
}

async function initializePackFirebase() {
  ensurePackAuthControls();

  const firebaseConfig =
    window.POKEMON_DEX_FIREBASE;

  if (
    !firebaseConfig ||
    !firebaseConfig.enabled ||
    !firebaseConfig.config
  ) {
    applyOwnedCodes([]);

    updatePackAuthControls(
      null,
      "Firebase 설정 없음 · 전체 미보유"
    );

    return;
  }

  try {
    const [
      appModule,
      authModule,
      firestoreModule
    ] = await Promise.all([
      import(
        `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`
      ),
      import(
        `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`
      ),
      import(
        `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`
      )
    ]);

    const app = appModule.getApps().length
      ? appModule.getApp()
      : appModule.initializeApp(
          firebaseConfig.config
        );

    const auth =
      authModule.getAuth(app);

    const db =
      firestoreModule.getFirestore(app);

    try {
      await authModule.setPersistence(
        auth,
        authModule.browserLocalPersistence
      );
    } catch (error) {
      console.warn(
        "로그인 유지 설정에 실패했습니다.",
        error
      );
    }

    packFirebase = {
      auth,
      db,
      authModule,
      firestoreModule
    };

    authModule.onAuthStateChanged(
      auth,
      user => {
        void applyPackUserState(user);
      },
      error => {
        console.warn(
          "팩도감 로그인 확인 실패",
          error
        );

        applyOwnedCodes([]);

        updatePackAuthControls(
          null,
          "로그인 확인 실패 · 전체 미보유"
        );
      }
    );
  } catch (error) {
    console.warn(
      "팩도감 Firebase 초기화 실패",
      error
    );

    applyOwnedCodes([]);

    updatePackAuthControls(
      null,
      "연결 실패 · 전체 미보유"
    );
  }
}

async function signInPackUser() {
  if (!packFirebase) {
    alert("로그인 기능을 불러오지 못했습니다.");
    return;
  }

  const {
    auth,
    authModule
  } = packFirebase;

  const button =
    $("pack-auth-button");

  if (button) {
    button.disabled = true;
    button.textContent = "로그인 중…";
  }

  const provider =
    new authModule.GoogleAuthProvider();

  provider.setCustomParameters({
    prompt: "select_account"
  });

  try {
    await authModule.signInWithPopup(
      auth,
      provider
    );
  } catch (error) {
    console.error(
      "팩도감 Google 로그인 오류",
      error
    );

    if (
      error.code !==
      "auth/popup-closed-by-user"
    ) {
      let message =
        "Google 로그인에 실패했습니다.";

      if (
        error.code === "auth/popup-blocked"
      ) {
        message =
          "로그인 팝업이 차단되었습니다.\nChrome 또는 Safari에서 사이트를 직접 열고 다시 시도하세요.";
      } else if (
        error.code ===
        "auth/unauthorized-domain"
      ) {
        message =
          "Firebase 승인 도메인에 pokemon-dogam.github.io가 등록되지 않았습니다.";
      } else if (error.message) {
        message += `\n${error.message}`;
      }

      alert(message);
    }

    updatePackAuthControls(packUser);
  }
}

async function signOutPackUser() {
  if (!packFirebase) {
    return;
  }

  const button =
    $("pack-auth-button");

  if (button) {
    button.disabled = true;
    button.textContent = "로그아웃 중…";
  }

  try {
    await packFirebase.authModule.signOut(
      packFirebase.auth
    );
  } catch (error) {
    console.error(
      "팩도감 로그아웃 오류",
      error
    );

    alert("로그아웃에 실패했습니다.");
    updatePackAuthControls(packUser);
  }
}

function drawSummary() {
  const owned =
    packs.filter(pack => pack.owned).length;

  const total = packs.length;
  const rate = pct(owned, total);

  $("pack-owned").textContent = owned;
  $("pack-total").textContent = total;
  $("pack-missing").textContent =
    total - owned;

  $("pack-rate").textContent =
    `${rate}%`;

  $("stat-pack-owned").textContent =
    owned;

  $("stat-pack-missing").textContent =
    total - owned;

  $("stat-pack-rate").textContent =
    rate;

  $("pack-progress-ring")
    .style
    .setProperty("--progress", rate);
}

function spritePosition(index) {
  const col =
    index % SPRITE_COLUMNS;

  const row =
    Math.floor(index / SPRITE_COLUMNS);

  return {
    x: SPRITE_COLUMNS === 1
      ? 0
      : (
          col /
          (SPRITE_COLUMNS - 1)
        ) * 100,

    y: SPRITE_ROWS === 1
      ? 0
      : (
          row /
          (SPRITE_ROWS - 1)
        ) * 100
  };
}

function openPackDialog(pack) {
  const dialog =
    $("pack-dialog");

  const image =
    $("pack-dialog-image");

  const imageWrap =
    $("pack-dialog-image-wrap");

  const pos =
    spritePosition(pack.i);

  image.style.setProperty(
    "--sprite-x",
    `${pos.x}%`
  );

  image.style.setProperty(
    "--sprite-y",
    `${pos.y}%`
  );

  image.style.setProperty(
    "--pack-a",
    palettes[pack.era][0]
  );

  image.style.setProperty(
    "--pack-b",
    palettes[pack.era][1]
  );

  image.setAttribute(
    "aria-label",
    `${pack.name} 팩 이미지`
  );

  imageWrap.classList.toggle(
    "is-missing",
    !pack.owned
  );

  $("pack-dialog-code").textContent =
    pack.code;

  $("pack-dialog-status").textContent =
    pack.owned
      ? "수집완료"
      : "미수집";

  $("pack-dialog-status").className =
    `status-badge ${
      pack.owned
        ? "is-owned"
        : "is-missing"
    }`;

  $("pack-dialog-name").textContent =
    pack.name;

  $("pack-dialog-era").textContent =
    `${pack.era} 시리즈`;

  $("pack-dialog-ownership").textContent =
    pack.owned
      ? "보유 중"
      : "아직 미수집";

  if (
    typeof dialog.showModal === "function"
  ) {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function closePackDialog() {
  const dialog =
    $("pack-dialog");

  if (
    typeof dialog.close === "function"
  ) {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}

function createCard(pack) {
  const element =
    document.createElement("article");

  element.className =
    `pack-card${
      pack.owned
        ? ""
        : " is-missing"
    }`;

  element.style.setProperty(
    "--pack-a",
    palettes[pack.era][0]
  );

  element.style.setProperty(
    "--pack-b",
    palettes[pack.era][1]
  );

  element.tabIndex = 0;
  element.setAttribute(
    "role",
    "button"
  );

  element.setAttribute(
    "aria-label",
    `${pack.name} 상세 보기`
  );

  const art =
    document.createElement("div");

  art.className = "pack-art";

  const image =
    document.createElement("span");

  image.className = "pack-image";
  image.setAttribute("role", "img");

  image.setAttribute(
    "aria-label",
    `${pack.name} 팩 이미지`
  );

  const pos =
    spritePosition(pack.i);

  image.style.setProperty(
    "--sprite-x",
    `${pos.x}%`
  );

  image.style.setProperty(
    "--sprite-y",
    `${pos.y}%`
  );

  art.append(image);

  const body =
    document.createElement("div");

  body.className =
    "pack-card-body";

  const top =
    document.createElement("div");

  top.className =
    "pack-card-top";

  const code =
    document.createElement("span");

  code.className = "pack-code";
  code.textContent = pack.code;

  const state =
    document.createElement("span");

  state.className = "pack-status";

  state.textContent =
    pack.owned
      ? "수집완료"
      : "미수집";

  top.append(code, state);

  const name =
    document.createElement("strong");

  name.className = "pack-name";
  name.textContent = pack.name;

  body.append(top, name);
  element.append(art, body);

  element.addEventListener(
    "click",
    () => openPackDialog(pack)
  );

  element.addEventListener(
    "keydown",
    event => {
      if (
        event.key !== "Enter" &&
        event.key !== " "
      ) {
        return;
      }

      event.preventDefault();
      openPackDialog(pack);
    }
  );

  return element;
}

function render() {
  const normalizedQuery =
    query.trim().toLowerCase();

  const shown = packs.filter(pack => {
    const eraMatches =
      era === "all" ||
      pack.era === era;

    const statusMatches =
      status === "all" ||
      (
        status === "owned"
      ) === pack.owned;

    const queryMatches =
      !normalizedQuery ||
      `${pack.name} ${pack.code}`
        .toLowerCase()
        .includes(normalizedQuery);

    return (
      eraMatches &&
      statusMatches &&
      queryMatches
    );
  });

  const host =
    $("pack-groups");

  host.replaceChildren();

  ["S", "SV", "M"].forEach(key => {
    const items =
      shown.filter(
        pack => pack.era === key
      );

    if (!items.length) {
      return;
    }

    const section =
      document.createElement("section");

    section.className =
      "pack-series";

    const heading =
      document.createElement("div");

    heading.className =
      "pack-series-heading";

    const title =
      document.createElement("h3");

    title.textContent =
      `${key} 시리즈`;

    const summary =
      document.createElement("p");

    summary.textContent =
      `${
        items.filter(
          pack => pack.owned
        ).length
      } / ${items.length}팩 수집완료`;

    heading.append(title, summary);

    const grid =
      document.createElement("div");

    grid.className = "pack-grid";

    items.forEach(pack => {
      grid.append(
        createCard(pack)
      );
    });

    section.append(heading, grid);
    host.append(section);
  });

  $("pack-result-count").textContent =
    shown.length;

  $("pack-empty").hidden =
    shown.length !== 0;
}

function initFilters() {
  const host =
    $("era-filters");

  [
    ["all", "전체"],
    ["S", "S"],
    ["SV", "SV"],
    ["M", "M"]
  ].forEach(([value, label]) => {
    const button =
      document.createElement("button");

    button.type = "button";
    button.textContent = label;
    button.dataset.era = value;

    button.className =
      value === "all"
        ? "is-active"
        : "";

    button.addEventListener(
      "click",
      () => {
        era = value;

        host
          .querySelectorAll("button")
          .forEach(item => {
            item.classList.toggle(
              "is-active",
              item === button
            );
          });

        render();
      }
    );

    host.append(button);
  });

  $("pack-status-filters")
    .addEventListener(
      "click",
      event => {
        const button =
          event.target.closest("button");

        if (!button) {
          return;
        }

        status =
          button.dataset.status;

        event.currentTarget
          .querySelectorAll("button")
          .forEach(item => {
            item.classList.toggle(
              "is-active",
              item === button
            );
          });

        render();
      }
    );

  $("pack-search")
    .addEventListener(
      "input",
      event => {
        query = event.target.value;
        render();
      }
    );
}

function initDialog() {
  const dialog =
    $("pack-dialog");

  $("pack-dialog-close")
    .addEventListener(
      "click",
      closePackDialog
    );

  dialog.addEventListener(
    "click",
    event => {
      if (event.target === dialog) {
        closePackDialog();
      }
    }
  );
}

function bootstrapPackDex() {
  initFilters();
  initDialog();

  // 로그인 확인 전에는 전부 미보유로 표시
  applyOwnedCodes([]);

  void initializePackFirebase();
}

bootstrapPackDex();
