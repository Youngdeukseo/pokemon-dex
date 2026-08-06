"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SERIES_PATH = path.join(ROOT, "data", "series.json");
const OUTPUT_PATH = path.join(ROOT, "data", "ar.json");

// 포켓몬코리아 발매 순서와 각 세트의 카드번호 오름차순입니다.
const SETS = Object.freeze([
  { code: "sv1S", title: "스칼렛 ex", start: 79, end: 90, denominator: "078" },
  { code: "sv1V", title: "바이올렛 ex", start: 79, end: 90, denominator: "078" },
  { code: "sv1a", title: "트리플렛비트", start: 74, end: 85, denominator: "073" },
  { code: "sv2D", title: "클레이버스트", start: 72, end: 83, denominator: "071" },
  { code: "sv2P", title: "스노해저드", start: 72, end: 83, denominator: "071" },
  { code: "sv2a", title: "포켓몬 카드 151", start: 166, end: 183, denominator: "165" },
  { code: "sv3", title: "흑염의 지배자", start: 109, end: 120, denominator: "108" },
  { code: "sv3a", title: "레이징서프", start: 63, end: 74, denominator: "062" },
  { code: "sv4M", title: "미래의 일섬", start: 67, end: 78, denominator: "066" },
  { code: "sv4K", title: "고대의 포효", start: 67, end: 78, denominator: "066" },
  { code: "sv4a", title: "샤이니트레져 ex", start: 338, end: 341, denominator: "190" },
  { code: "sv5M", title: "사이버저지", start: 72, end: 83, denominator: "071" },
  { code: "sv5K", title: "와일드포스", start: 72, end: 83, denominator: "071" },
  { code: "sv5a", title: "크림슨헤이즈", start: 67, end: 78, denominator: "066" },
  { code: "sv6", title: "변환의 가면", start: 102, end: 113, denominator: "101" },
  { code: "sv6a", title: "나이트 원더러", start: 65, end: 76, denominator: "064" },
  { code: "sv7", title: "스텔라미라클", start: 103, end: 114, denominator: "102" },
  { code: "sv7a", title: "낙원드래고나", start: 65, end: 76, denominator: "064" },
  { code: "sv8", title: "초전브레이커", start: 107, end: 118, denominator: "106" },
  { code: "sv8a", title: "테라스탈 페스티벌 ex", count: 0 },
  { code: "sv9", title: "배틀파트너즈", start: 101, end: 112, denominator: "100" },
  { code: "sv9a", title: "열풍의 아레나", start: 64, end: 75, denominator: "063" },
  { code: "sv10", title: "로켓단의 영광", start: 99, end: 110, denominator: "098" },
  { code: "sv11B", title: "블랙볼트", start: 87, end: 158, denominator: "086" },
  { code: "sv11W", title: "화이트플레어", start: 87, end: 158, denominator: "086" },
  { code: "m1S", title: "메가심포니아", start: 64, end: 75, denominator: "063" },
  { code: "m1L", title: "메가브레이브", start: 64, end: 75, denominator: "063" },
  { code: "m2", title: "인페르노X", start: 81, end: 92, denominator: "080" },
  { code: "m2a", title: "MEGA 드림 ex", start: 194, end: 213, denominator: "193" },
  { code: "m3", title: "니힐제로", start: 81, end: 92, denominator: "080" },
  { code: "m4", title: "닌자스피너", start: 84, end: 95, denominator: "083" },
  { code: "m5", title: "어비스아이", start: 82, end: 93, denominator: "081" },
]);

const MANUAL_NAMES = Object.freeze({
  sv4a: ["바닥트리오", "돌핀맨", "빠모", "따라큐"],
  sv5a: [
    "쁘사이저",
    "차데스",
    "코터스",
    "초염몽",
    "피오네",
    "윽우지",
    "일레도리자드",
    "러브로스",
    "히스이 가디",
    "대코파스",
    "과사삭벌레",
    "이브이",
  ],
});

const NAME_FIXES = Object.freeze({
  "sv6-104": "눈여아",
  "sv10-102": "진주몽",
  "m2a-197": "심향의 마그카르고",
  "m2a-204": "호브의 대로트",
  "m2a-205": "로켓단의 따라큐",
  "m2a-206": "로켓단의 닥트리오",
  "m2a-208": "난천의 화강돌",
  "m2a-210": "N의 제크로무",
});

const EXPECTED_TOTAL = 498;

function pad(value) {
  return String(value).padStart(3, "0");
}

function sourceKey(setCode, number) {
  return `${String(setCode).toLowerCase()}-${number}`;
}

function imageUrl(setCode, number) {
  if (/^m/i.test(setCode)) {
    const imageCode = String(setCode).replace(/^m/i, "M");
    return `https://cards.image.pokemonkorea.co.kr/data/wmimages/MEGA/${imageCode}/${imageCode}_${pad(number)}.png?w=400`;
  }
  const imageCode = `SV${String(setCode).slice(2)}`;
  return `https://cards.image.pokemonkorea.co.kr/data/wmimages/SV/${imageCode}/${imageCode}_${pad(number)}.png?w=400`;
}

function buildSourceMap(seriesGroups) {
  const sourceMap = new Map();

  seriesGroups.forEach((group) => {
    (group.cards || []).forEach((card) => {
      const match = String(card.code || "").match(/_(\d{3})\//);
      if (!match) return;
      sourceMap.set(sourceKey(group.code, Number(match[1])), card);
    });
  });

  return sourceMap;
}

function buildCard(set, number, source) {
  const key = sourceKey(set.code, number);
  const manualName = MANUAL_NAMES[set.code]?.[number - set.start];
  const name =
    manualName ||
    NAME_FIXES[key] ||
    source?.name ||
    source?.pokemonName ||
    "";

  if (!name) {
    throw new Error(`${set.code}_${pad(number)} 카드명이 없습니다.`);
  }

  return {
    code: `${set.code}_${pad(number)}/${set.denominator} AR`,
    number,
    denominator: set.denominator,
    name,
    image: source?.image
      ? `${String(source.image).split("?")[0]}?w=400`
      : imageUrl(set.code, number),
    owned: false,
  };
}

function buildData() {
  const seriesGroups = JSON.parse(fs.readFileSync(SERIES_PATH, "utf8"));
  const sourceMap = buildSourceMap(seriesGroups);

  const groups = SETS.map((set) => {
    const cards = [];
    if (set.count !== 0) {
      for (let number = set.start; number <= set.end; number += 1) {
        const source = sourceMap.get(sourceKey(set.code, number));
        if (!source && !MANUAL_NAMES[set.code]) {
          throw new Error(`${set.code}_${pad(number)} 공식 카드 원본이 없습니다.`);
        }
        cards.push(buildCard(set, number, source));
      }
    }

    return {
      code: set.code,
      title: set.title,
      cards,
    };
  });

  const total = groups.reduce((sum, group) => sum + group.cards.length, 0);
  if (total !== EXPECTED_TOTAL) {
    throw new Error(`AR 총합이 ${total}장입니다. ${EXPECTED_TOTAL}장이 필요합니다.`);
  }

  groups.forEach((group) => {
    const numbers = group.cards.map((card) => card.number);
    const sorted = [...numbers].sort((a, b) => a - b);
    if (numbers.some((number, index) => number !== sorted[index])) {
      throw new Error(`${group.code} 카드가 번호순이 아닙니다.`);
    }
    if (new Set(numbers).size !== numbers.length) {
      throw new Error(`${group.code} 카드번호가 중복되었습니다.`);
    }
  });

  return groups;
}

const data = buildData();
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(data, null, 2)}\n`);
console.log(
  `AR data: ${data.length} sets, ${data.reduce((sum, group) => sum + group.cards.length, 0)} cards`,
);
