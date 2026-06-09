#!/usr/bin/env python3
"""Build a trimmed Kaggle enrichment JSON for games in collection.csv."""

from __future__ import annotations

import csv
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

WIKIPEDIA_UA = "PatchworkBoardgame/1.0 (kaggle metadata bootstrap)"
WIKIPEDIA_DELAY_SEC = 0.2

ROOT = Path(__file__).resolve().parents[1]
COLLECTION_CSV = ROOT / "collection.csv"
OUTPUT_JSON = ROOT / "src" / "kaggle-enrichment.json"
KAGGLE_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/kaggle-bgg")


def load_lookup(path: Path, id_field: str = "bgg_id", name_field: str = "name") -> dict[str, str]:
    lookup: dict[str, str] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            key = (row.get(id_field) or "").strip()
            value = (row.get(name_field) or "").strip()
            if key and value:
                lookup[key] = value
    return lookup


def split_ids(raw: str | None) -> list[str]:
    if not raw or not raw.strip():
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def resolve_ids(raw: str | None, lookup: dict[str, str]) -> list[str]:
    names: list[str] = []
    for token in split_ids(raw):
        if token.isdigit() and token in lookup:
            names.append(lookup[token])
        elif token:
            names.append(token)
    return names


def resolve_categories(raw: str | None, lookup: dict[str, str]) -> list[str]:
    return resolve_ids(raw, lookup)


def row_to_enrichment(
    row: dict[str, str],
    categories: dict[str, str],
    mechanics: dict[str, str],
    people: dict[str, str],
    publishers: dict[str, str],
) -> dict[str, object]:
    enrichment: dict[str, object] = {}
    mechanics_list = resolve_ids(row.get("mechanic"), mechanics)
    categories_list = resolve_ids(row.get("category"), categories)
    designers = resolve_ids(row.get("designer"), people)
    artists = resolve_ids(row.get("artist"), people)
    publisher_list = resolve_ids(row.get("publisher"), publishers)

    if mechanics_list:
        enrichment["mechanics"] = mechanics_list
    if categories_list:
        enrichment["categories"] = categories_list
    if designers:
        enrichment["designers"] = designers
    if artists:
        enrichment["artists"] = artists
    if publisher_list:
        enrichment["publishers"] = publisher_list

    return enrichment


def load_game_rows(path: Path) -> dict[int, dict[str, str]]:
    games: dict[int, dict[str, str]] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            raw_id = (row.get("bgg_id") or "").strip()
            if not raw_id.isdigit():
                continue
            games[int(raw_id)] = row
    return games


def load_collection_games() -> dict[int, str]:
    games: dict[int, str] = {}
    with COLLECTION_CSV.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            raw_id = (row.get("objectid") or "").strip()
            name = (row.get("objectname") or "").strip().strip('"')
            if raw_id.isdigit() and name:
                games[int(raw_id)] = name
    return games


def fetch_wikipedia_thumbnail(title: str) -> str | None:
    encoded = urllib.parse.quote(title.replace(" ", "_"))
    url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{encoded}"
    request = urllib.request.Request(url, headers={"User-Agent": WIKIPEDIA_UA})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.load(response)
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError):
        return None

    thumbnail = payload.get("thumbnail") or {}
    return thumbnail.get("source") or payload.get("originalimage", {}).get("source")


def main() -> None:
    if not KAGGLE_DIR.exists():
        raise SystemExit(f"Kaggle directory not found: {KAGGLE_DIR}")

    categories = load_lookup(KAGGLE_DIR / "bgg_Category.csv")
    mechanics = load_lookup(KAGGLE_DIR / "bgg_Mechanic.csv")
    people = load_lookup(KAGGLE_DIR / "bgg_Person.csv")
    publishers = load_lookup(KAGGLE_DIR / "bgg_Publisher.csv")

    bgg_games = load_game_rows(KAGGLE_DIR / "bgg_GameItem.csv")
    wikidata_games = load_game_rows(KAGGLE_DIR / "wikidata_GameItem.csv")

    collection_games = load_collection_games()
    collection_ids = list(collection_games.keys())
    games_out: dict[str, dict[str, object]] = {}
    matched_bgg = 0
    matched_wikidata = 0
    with_thumbnails = 0

    for bgg_id in collection_ids:
        bgg_row = bgg_games.get(bgg_id)
        wiki_row = wikidata_games.get(bgg_id)

        if bgg_row is None and wiki_row is None:
            continue

        enrichment = (
            row_to_enrichment(bgg_row, categories, mechanics, people, publishers)
            if bgg_row
            else {}
        )
        if wiki_row:
            wiki_enrichment = row_to_enrichment(
                wiki_row, categories, mechanics, people, publishers
            )
            for key, value in wiki_enrichment.items():
                if key not in enrichment:
                    enrichment[key] = value

        if not enrichment:
            continue

        if bgg_row and wiki_row:
            enrichment["source"] = "bgg_GameItem+wikidata_GameItem"
            matched_bgg += 1
        elif bgg_row:
            enrichment["source"] = "bgg_GameItem"
            matched_bgg += 1
        else:
            enrichment["source"] = "wikidata_GameItem"
            matched_wikidata += 1

        games_out[str(bgg_id)] = enrichment

    for bgg_id, enrichment in games_out.items():
        title = collection_games.get(int(bgg_id))
        if not title:
            continue
        thumbnail = fetch_wikipedia_thumbnail(title)
        if thumbnail:
            enrichment["thumbnailUrl"] = thumbnail
            with_thumbnails += 1
        time.sleep(WIKIPEDIA_DELAY_SEC)

    payload = {
        "dataset": "kaggle/mshepherd/board-games",
        "datasetUpdatedAt": "2023-06-20",
        "builtAt": __import__("datetime").datetime.now(__import__("datetime").UTC)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "notes": (
            "Metadata bootstrap from the recommend.games Kaggle snapshot. "
            "Includes mechanics, categories, designers, artists, and publishers. "
            "Cover art is fetched separately from Wikipedia where a matching article exists."
        ),
        "stats": {
            "collectionGames": len(collection_ids),
            "enriched": len(games_out),
            "fromBgg": matched_bgg,
            "fromWikidata": matched_wikidata,
            "withThumbnails": with_thumbnails,
            "missing": len(collection_ids) - len(games_out),
        },
        "games": games_out,
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT_JSON}")
    print(json.dumps(payload["stats"], indent=2))


if __name__ == "__main__":
    main()
