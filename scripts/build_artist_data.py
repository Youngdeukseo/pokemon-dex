#!/usr/bin/env python3
"""Build the artist-dex JSON from the public Google Sheet."""

from __future__ import annotations

import csv
import io
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

SHEET_ID = "182YRnjIvZ64whQv6hMNrM5NoSfzY3T-oggvSB143S2I"
ARTISTS = [
    "Narumi Sato",
    "OKACHEKE",
    "Shinji Kanda",
    "Asako Ito",
    "Gapao",
    "Yukihiro Tada",
    "Tetsu Kayama",
    "Jerky",
    "Pani kobayashi",
    "Ounishi",
    "Sachiko Adachi",
    "Yuka Morii",
    "Tomokazu Komiya",
    "AKIRA EGAWA",
    "OOYAMA",
    "HYOGONOSUKE",
    "miki kudo",
    "Miki Tanaka",
    "sui",
    "Atsuko Nishida",
    "Aya Kusube",
    "Shibuzoh",
    "Saya Tsuruta",
    "ryoma uratsuka",
    "Tika Matsuno",
    "sowsow",
    "Yukiko Baba",
    "Sekio",
    "Naoyo Kimura",
]


def download_csv(sheet_name: str) -> str:
    query = urllib.parse.urlencode({"tqx": "out:csv", "sheet": sheet_name})
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": "pokemon-dex-builder/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8-sig")


def to_bool(value: str) -> bool:
    return value.strip().lower() in {"true", "1", "yes", "y", "보유"}


def build() -> dict:
    artists: list[dict] = []
    total_cards = 0
    total_owned = 0

    for artist_name in ARTISTS:
        csv_text = download_csv(f"{artist_name}_데이터")
        reader = csv.DictReader(io.StringIO(csv_text))
        cards: list[dict] = []

        for row in reader:
            order_text = (row.get("순서") or "").strip()
            pokemon_name = (row.get("포켓몬(한글)") or "").strip()
            if not order_text or not pokemon_name:
                continue

            status = (row.get("현재 상태") or "").strip()
            owned = status == "보유" or to_bool(row.get("원본 수집 유무") or "")
            try:
                order = int(float(order_text))
            except ValueError:
                order = order_text

            cards.append(
                {
                    "order": order,
                    "name": pokemon_name,
                    "status": status or ("보유" if owned else "미보유"),
                    "owned": owned,
                    "set": (row.get("수록박스번호") or "").strip(),
                    "rarity": (row.get("홀로그램") or "").strip(),
                    "image": (row.get("컬러 이미지 URL") or "").strip(),
                    "imageBw": (row.get("흑백 이미지 URL") or "").strip(),
                    "source": (row.get("이미지/작가 출처") or "").strip(),
                    "cardNumber": (row.get("카드번호/검수") or "").strip(),
                }
            )

        total_cards += len(cards)
        total_owned += sum(card["owned"] for card in cards)
        artists.append({"name": artist_name, "cards": cards})

    if len(artists) != 29 or total_cards != 451:
        raise RuntimeError(
            f"Unexpected artist data size: artists={len(artists)}, cards={total_cards}"
        )

    return {
        "source": "[최종]작가도감",
        "sourceId": SHEET_ID,
        "artistCount": len(artists),
        "cardCount": total_cards,
        "ownedCount": total_owned,
        "artists": artists,
    }


def main() -> None:
    output = Path(sys.argv[1] if len(sys.argv) > 1 else "data/artists.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = build()
    output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"Wrote {payload['artistCount']} artists and {payload['cardCount']} cards to {output}"
    )


if __name__ == "__main__":
    main()
