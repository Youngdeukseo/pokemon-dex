#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(scriptDirectory, "../data/pokemon-collections.json");
const officialRoot =
  "https://cards.image.pokemonkorea.co.kr/data/wmimages/";

const unavailableImages = new Set([
  `${officialRoot}M/M-P/M-P_040.png`,
  `${officialRoot}S/ST1/ST1_019.png`,
  `${officialRoot}SV/SVI/SVI_002.png`,
  `${officialRoot}SV/SVI/SVI_006.png`,
  `${officialRoot}SV/SVA/SVA_002.png`,
  `${officialRoot}SV/SVA/SVA_004.png`,
  `${officialRoot}XY/XY30/XY30_003.png`,
  `${officialRoot}BW/BW2/BW2_030.png`,
  `${officialRoot}BW/BW2/BW2_031.png`,
  `${officialRoot}S/S7/S7_030.png`,
  `${officialRoot}S/S7/S7_031.png`,
  `${officialRoot}S/S7/S7_072.png`,
]);

const directImageFixes = new Map([
  [
    `${officialRoot}XY/XY5/XY5_039.png`,
    `${officialRoot}XY/XY5/XY5_GV_039.jpg`,
  ],
  [
    `${officialRoot}XY/XY5/XY5_040.png`,
    `${officialRoot}XY/XY5/XY5_GV_040.jpg`,
  ],
  [
    `${officialRoot}XY/XY5/XY5_046.png`,
    `${officialRoot}XY/XY5/XY5_TS_046.jpg`,
  ],
  [
    `${officialRoot}XY/XY5/XY5_073.png`,
    `${officialRoot}XY/XY5/XY5_GV_073.jpg`,
  ],
  [
    `${officialRoot}XY/XY5/XY5_074.png`,
    `${officialRoot}XY/XY5/XY5_GV_074.jpg`,
  ],
  [
    `${officialRoot}XY/XY8/XY8_045.png`,
    `${officialRoot}XY/XY8/XY8_RED_045.jpg`,
  ],
  [
    `${officialRoot}BW/BW5/BW5_027.png`,
    `${officialRoot}BW/BW5/bw5_blast_027.jpg`,
  ],
  [
    `${officialRoot}BW/BW5/BW5_028.png`,
    `${officialRoot}BW/BW5/bw5_blast_028.jpg`,
  ],
  [
    `${officialRoot}BW/BW8/BW8_011.png`,
    `${officialRoot}BW/BW8/bw8_vn_011.jpg`,
  ],
  [
    `${officialRoot}BW/BW8/BW8_023.png`,
    `${officialRoot}BW/BW8/bw8_sf_023.jpg`,
  ],
  [
    `${officialRoot}S/S5/S5_020.png`,
    `${officialRoot}S/S5/S5R_020.png`,
  ],
]);

function correctedImage(image) {
  if (directImageFixes.has(image)) return directImageFixes.get(image);

  return image
    .replace(`${officialRoot}M/`, `${officialRoot}MEGA/`)
    .replace("/SM/SM2+/SM2+_", "/SM/SM2+/SM2plus_")
    .replace("/SM/SM4+/SM4+_", "/SM/SM4+/SM4plus_")
    .replace("/SM/SM8B/SM8B_", "/SM/SM8B/SM8b_")
    .replace("/SM/SM9A/SM9A_", "/SM/SM9A/SM9a_")
    .replace("/SM/SML_/SML__", "/SM/SML_/SML_")
    .replace("/XY/XY2/XY2_058.png", "/XY/XY2/XY2_058.jpg")
    .replace(/\/XY\/XY7\/(XY7_[0-9]+)\.png$/, "/XY/XY7/$1.jpg")
    .replace("/BW/BW7/BW7_036.png", "/BW/BW7/bw7_036.jpg");
}

const source = JSON.parse(readFileSync(dataPath, "utf8"));
const removed = [];
const fixed = [];

const cleaned = source.map((group) => {
  const cards = [];

  group.cards.forEach((card, cardIndex) => {
    const originalImage = String(card.image || "").trim();
    if (!originalImage || unavailableImages.has(originalImage)) {
      removed.push({ group: group.name, name: card.name, meta: card.meta });
      return;
    }

    const image = correctedImage(originalImage);
    if (image !== originalImage) {
      fixed.push({ group: group.name, meta: card.meta, from: originalImage, to: image });
    }

    cards.push({
      ...card,
      image,
      accountIndex: Number.isInteger(card.accountIndex)
        ? card.accountIndex
        : cardIndex,
    });
  });

  if (!cards.length) throw new Error(`${group.name}: 남은 카드가 없습니다.`);
  return { ...group, cards };
});

for (const group of cleaned) {
  for (const card of group.cards) {
    if (!String(card.image || "").startsWith(officialRoot)) {
      throw new Error(`${group.name} ${card.meta}: 공식 이미지 주소가 아닙니다.`);
    }
  }
}

writeFileSync(dataPath, `${JSON.stringify(cleaned)}\n`);
console.log(
  JSON.stringify(
    {
      groups: cleaned.length,
      cards: cleaned.reduce((total, group) => total + group.cards.length, 0),
      removed: removed.length,
      fixed: fixed.length,
    },
    null,
    2,
  ),
);
