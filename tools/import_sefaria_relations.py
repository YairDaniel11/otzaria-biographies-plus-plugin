"""Merge non-biblical person relationships from Sefaria into BIO_RELATIONS.

Only relationships whose two Sefaria topics each match exactly one `sage` entry in
bio-data.js are imported.  This deliberately leaves the biblical entries intact.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import unicodedata
from collections import defaultdict
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA_FILE = HERE / "data" / "bio-data.js"
RELATIONS_FILE = HERE / "data" / "bio-relations.js"

# The direction is (label for from_id, label for to_id).
RELATION_LABELS = {
    "taught": ("תלמיד/ה", "רבו/מורו"),
    "child-of": ("הורה", "בן/בת"),
    "spouse-of": ("בן/בת זוג", "בן/בת זוג"),
    "sibling-of": ("אח/אחות", "אח/אחות"),
    "corresponded-with": ("התכתבות עם", "התכתבות עם"),
    "descendant-of": ("אב קדמון", "צאצא/ית"),
    "grandchild-of": ("אב קדמון", "צאצא/ית"),
    "child-in-law-of": ("חותן/חותנת", "חתן/כלה"),
    "cousin-of": ("בן/בת דוד/ה", "בן/בת דוד/ה"),
}

SEFARIA_ERAS = {"A": "אמורא", "T": "תנא", "Z": "זוג"}
HEBREW_ORDINALS = {
    "ראשון": 1, "ראשונה": 1, "שני": 2, "שנייה": 2, "שניה": 2,
    "שלישי": 3, "שלישית": 3, "רביעי": 4, "רביעית": 4,
    "חמישי": 5, "חמישית": 5, "שישי": 6, "ששית": 6,
    "שביעי": 7, "שביעית": 7,
}


def load_js_assignment(path: Path, variable: str):
    content = path.read_text(encoding="utf-8")
    match = re.search(rf"window\.{variable}\s*=\s*(.+?)\s*;?\s*$", content, re.S)
    if not match:
        raise ValueError(f"Could not read {variable} from {path}")
    return json.loads(match.group(1))


def normalize_hebrew(value: str) -> str:
    """Normalize spelling-only differences, preserving the actual Hebrew words."""
    value = unicodedata.normalize("NFKD", value)
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = value.replace("״", '"').replace("׳", "'").replace("־", "-")
    value = re.sub(r"\s*\([^)]*\)", "", value)  # e.g. disambiguating numbers
    value = re.sub(r"[^\u05D0-\u05EA ]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def select_source(path: Path | None) -> Path:
    if path:
        return path
    candidates = [db for db in ROOT.glob("*.db") if db.stat().st_size > 0]
    if not candidates:
        raise FileNotFoundError("No SQLite database found beside the biographies folder")
    return max(candidates, key=lambda db: db.stat().st_size)


def sefaria_generation(properties_json: str | None) -> tuple[str | None, int | None]:
    properties = json.loads(properties_json or "{}")
    value = properties.get("generation", {})
    if isinstance(value, dict):
        value = value.get("value")
    match = re.fullmatch(r"([A-Z]+)(\d+)", value or "")
    if not match:
        return None, None
    return SEFARIA_ERAS.get(match.group(1)), int(match.group(2))


def bio_generation(entry: dict, enrichment: dict) -> tuple[str | None, int | None]:
    extra = enrichment.get(str(entry["i"]), {})
    era = extra.get("type")
    generation = extra.get("dor")
    if generation:
        number = re.search(r"\d+", generation)
        if number:
            return era, int(number.group())

    # The external biographies generally begin by stating the period and generation.
    prefix = entry.get("b", "")[:800]
    if era is None:
        type_match = re.search(r"(תנא|אמורא|זוג)", prefix)
        if type_match:
            era = type_match.group(1)
    ordinal_match = re.search(
        r"דור\s+(" + "|".join(HEBREW_ORDINALS) + r")", prefix
    )
    return era, HEBREW_ORDINALS.get(ordinal_match.group(1)) if ordinal_match else None


def topic_matches(connection: sqlite3.Connection, entries: list[dict], enrichment: dict) -> dict[int, dict]:
    """Map each Sefaria topic to its best matching biography entry.

    Matching starts from the biography entry and uses every Hebrew alternative name
    in Sefaria.  This means a duplicate name in the plugin does not hide the
    Sefaria topic; its generation chooses the appropriate external biography.
    """
    entries_by_name: dict[str, list[dict]] = defaultdict(list)
    for entry in entries:
        if entry.get("cat") == "sage":
            entries_by_name[normalize_hebrew(entry["n"])].append(entry)

    matched: dict[int, dict] = {}
    for topic_id, titles_json, properties_json in connection.execute(
        "SELECT id, titles_json, properties_json FROM topics"
    ):
        candidates: dict[int, dict] = {}
        for title in json.loads(titles_json or "[]"):
            if title.get("lang") != "he":
                continue
            for entry in entries_by_name.get(normalize_hebrew(title["text"]), []):
                candidates[entry["i"]] = entry
        if not candidates:
            continue

        source_era, source_generation = sefaria_generation(properties_json)

        def score(entry: dict) -> tuple[int, int]:
            entry_era, entry_generation = bio_generation(entry, enrichment)
            generation_score = 0
            if source_era and entry_era == source_era:
                generation_score += 10
            if source_generation and entry_generation == source_generation:
                generation_score += 100
            elif source_generation and entry_generation is not None:
                generation_score -= 10
            # Prefer the full external biography when name and generation tie.
            return generation_score, len(entry.get("b", ""))

        ranked = sorted(candidates.values(), key=score, reverse=True)
        if len(ranked) == 1 or score(ranked[0]) > score(ranked[1]):
            matched[topic_id] = ranked[0]
    return matched


def merge(source: Path, write: bool) -> tuple[int, int, int]:
    entries = load_js_assignment(DATA_FILE, "BIO_DATA")
    relations = load_js_assignment(RELATIONS_FILE, "BIO_RELATIONS")
    enrichment = load_js_assignment(HERE / "data" / "bio-enrich.js", "BIO_ENRICH")

    with sqlite3.connect(source) as connection:
        matches = topic_matches(connection, entries, enrichment)
        placeholders = ",".join("?" for _ in RELATION_LABELS)
        links = connection.execute(
            f"SELECT from_id, to_id, link_type FROM links WHERE link_type IN ({placeholders})",
            tuple(RELATION_LABELS),
        )
        additions = 0
        matched_links = 0
        for from_id, to_id, link_type in links:
            from_entry = matches.get(from_id)
            to_entry = matches.get(to_id)
            if not from_entry or not to_entry:
                continue
            matched_links += 1
            from_key, to_key = str(from_entry["i"]), str(to_entry["i"])
            from_label, to_label = RELATION_LABELS[link_type]
            candidates = (
                (from_key, {"label": from_label, "name": to_entry["n"], "id": to_entry["i"]}),
                (to_key, {"label": to_label, "name": from_entry["n"], "id": from_entry["i"]}),
            )
            for key, relation in candidates:
                bucket = relations.setdefault(key, [])
                if not any(
                    item.get("label") == relation["label"] and item.get("id") == relation["id"]
                    for item in bucket
                ):
                    bucket.append(relation)
                    additions += 1

    if write:
        payload = json.dumps(relations, ensure_ascii=False, separators=(",", ": "))
        RELATIONS_FILE.write_text(f"window.BIO_RELATIONS = {payload};\n", encoding="utf-8")
    return len(matches), matched_links, additions


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Source SQLite database (defaults to the largest .db)")
    parser.add_argument("--write", action="store_true", help="Write the merged data to bio-relations.js")
    args = parser.parse_args()
    source = select_source(args.source)
    topics, links, additions = merge(source, args.write)
    action = "Updated" if args.write else "Dry run — would update"
    print(f"{action} {RELATIONS_FILE.name}: {topics} matched topics, {links} matched links, {additions} new relation entries")


if __name__ == "__main__":
    main()
