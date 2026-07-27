#!/usr/bin/env python3
"""Add searchable Korean Pokémon names to the series checklist data.

The series checklist follows Japanese expansion codes and local card numbers.
TCGdex supplies the Japanese card titles for those identifiers, Pokellector
fills gaps in a few set lists, and PokeAPI's species translations provide the
corresponding Korean Pokémon names. Existing curated Korean card names are never
changed.
"""

from __future__ import annotations

import csv
import html
import io
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERIES_PATH = ROOT / "data" / "series.json"
SPECIES_NAMES_URL = (
    "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/"
    "data/v2/csv/pokemon_species_names.csv"
)
TCGDEX_SET_URL = "https://api.tcgdex.net/v2/ja/sets/{set_code}"
USER_AGENT = "pokemon-dogam-series-name-builder/1.0"

JAPANESE_LANGUAGE_ID = "1"
KOREAN_LANGUAGE_ID = "3"
ENGLISH_LANGUAGE_ID = "9"

POKELLECTOR_SET_URLS = {
    "sv4a": "https://jp.pokellector.com/Shiny-Treasures-ex-Expansion/",
    "sv5K": "https://jp.pokellector.com/Wild-Force-Expansion/",
    "sv5M": "https://jp.pokellector.com/Cyber-Judge-Expansion/",
    "sv6": "https://jp.pokellector.com/Mask-of-Change-Expansion/",
    "sv6a": "https://jp.pokellector.com/Night-Wanderer-Expansion/",
    "sv8": "https://jp.pokellector.com/Super-Electric-Breaker-Expansion/",
    "sv10": "https://jp.pokellector.com/Glory-of-Team-Rocket-Expansion/",
    "m1L": "https://jp.pokellector.com/Mega-Brave-Expansion/",
    "m5": "https://jp.pokellector.com/Abyss-Eye-Expansion/",
}

MANUAL_POKEMON_NAME_OVERRIDES = {
    "sD:001": "이상해꽃",
    "sD:002": "뿔충이",
    "sD:003": "딱충이",
    "sD:004": "독침붕",
    "sD:005": "식스테일",
    "sD:006": "어흥염",
    "sD:007": "태우지네",
    "sD:008": "다태우지네",
    "sD:009": "샤프니아",
    "sD:010": "샤크니아",
    "sD:011": "고래왕",
    "sD:012": "피카츄",
    "sD:013": "메리프",
    "sD:014": "보송송",
    "sD:015": "전룡",
    "sD:016": "뮤",
    "sD:017": "몸지브림",
    "sD:018": "손지브림",
    "sD:019": "브리무음",
    "sD:020": "루카리오",
    "sD:021": "암멍이",
    "sD:022": "루가루암",
    "sD:023": "아보",
    "sD:024": "아보크",
    "sD:025": "야도란",
    "sD:026": "멜탄",
    "sD:027": "멜메탈",
    "sD:028": "두랄루돈",
    "sD:029": "이브이",
    "sD:030": "파비코",
    "sD:031": "파비코리",
}


def fetch_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def load_species_names() -> dict[str, list[tuple[str, str]]]:
    rows = csv.DictReader(io.StringIO(fetch_text(SPECIES_NAMES_URL)))
    by_species: dict[str, dict[str, str]] = {}

    for row in rows:
        language_id = row["local_language_id"]
        if language_id not in {
            JAPANESE_LANGUAGE_ID,
            KOREAN_LANGUAGE_ID,
            ENGLISH_LANGUAGE_ID,
        }:
            continue
        by_species.setdefault(row["pokemon_species_id"], {})[language_id] = row[
            "name"
        ]

    pairs_by_language = {}
    for language_id, key in (
        (JAPANESE_LANGUAGE_ID, "ja"),
        (ENGLISH_LANGUAGE_ID, "en"),
    ):
        pairs = [
            (names[language_id], names[KOREAN_LANGUAGE_ID])
            for names in by_species.values()
            if names.get(language_id) and names.get(KOREAN_LANGUAGE_ID)
        ]
        pairs_by_language[key] = sorted(
            pairs,
            key=lambda pair: len(normalize_title(pair[0])),
            reverse=True,
        )
    return pairs_by_language


def normalize_title(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9ぁ-んァ-ヶ一-龠♀♂]", "", value or "").lower()


def local_card_id(card: dict) -> str:
    match = re.search(r"_(\d{3,})/", str(card.get("code", "")))
    return match.group(1) if match else ""


def load_set_titles(set_code: str) -> dict[str, str]:
    url = TCGDEX_SET_URL.format(set_code=urllib.parse.quote(set_code))
    try:
        payload = json.loads(fetch_text(url))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
        print(f"warning: {set_code}: {error}", file=sys.stderr)
        return {}

    cards = payload.get("cards")
    if not isinstance(cards, list):
        return {}

    return {
        str(card.get("localId", "")): str(card.get("name", "")).strip()
        for card in cards
        if card.get("localId") and card.get("name")
    }


def load_pokellector_titles(set_code: str) -> dict[str, str]:
    url = POKELLECTOR_SET_URLS.get(set_code)
    if not url:
        return {}
    try:
        page = fetch_text(url)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
        print(f"warning: {set_code} fallback: {error}", file=sys.stderr)
        return {}

    return {
        number.zfill(3): html.unescape(re.sub(r"\s+", " ", title)).strip()
        for number, title in re.findall(
            r'<div\s+class="plaque">\s*#(\d+)\s*-\s*([^<]+)</div>',
            page,
            flags=re.IGNORECASE,
        )
    }


def pokemon_name_for_title(
    title: str, species_names: list[tuple[str, str]]
) -> str:
    normalized_title = normalize_title(title)
    if not normalized_title:
        return ""

    for source_name, korean_name in species_names:
        if normalize_title(source_name) in normalized_title:
            return korean_name
    return ""


def main() -> int:
    groups = json.loads(SERIES_PATH.read_text(encoding="utf-8"))
    species_names = load_species_names()
    title_maps: dict[str, dict[str, str]] = {}
    fallback_title_maps: dict[str, dict[str, str]] = {}
    with ThreadPoolExecutor(max_workers=12) as executor:
        jobs = {
            executor.submit(load_set_titles, group["code"]): (
                "primary",
                group["code"],
            )
            for group in groups
        }
        jobs.update(
            {
                executor.submit(load_pokellector_titles, group["code"]): (
                    "fallback",
                    group["code"],
                )
                for group in groups
                if group["code"] in POKELLECTOR_SET_URLS
            }
        )
        for future in as_completed(jobs):
            source, set_code = jobs[future]
            if source == "primary":
                title_maps[set_code] = future.result()
            else:
                fallback_title_maps[set_code] = future.result()

    total_cards = 0
    named_cards = 0
    missing_titles: list[str] = []

    for group in groups:
        titles = title_maps.get(group["code"], {})
        fallback_titles = fallback_title_maps.get(group["code"], {})
        for card in group.get("cards", []):
            total_cards += 1
            card_id = local_card_id(card)
            title = titles.get(card_id, "")
            pokemon_name = pokemon_name_for_title(title, species_names["ja"])
            if not pokemon_name:
                pokemon_name = pokemon_name_for_title(
                    fallback_titles.get(card_id, ""),
                    species_names["en"],
                )
            pokemon_name = MANUAL_POKEMON_NAME_OVERRIDES.get(
                f"{group['code']}:{card_id}",
                pokemon_name,
            )

            if pokemon_name:
                card["pokemonName"] = pokemon_name
                named_cards += 1
            elif str(card.get("pokemonName", "")).strip():
                # Keep names reviewed from the Korean card image when an
                # external set listing does not contain this local card ID.
                named_cards += 1
            else:
                card.pop("pokemonName", None)
                if not str(card.get("name", "")).strip():
                    missing_titles.append(f"{group['code']}:{card.get('code', '')}")

    SERIES_PATH.write_text(
        json.dumps(groups, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "cards": total_cards,
                "pokemonNames": named_cards,
                "withoutPokemonNameOrCuratedName": len(missing_titles),
                "missingExamples": missing_titles[:20],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
