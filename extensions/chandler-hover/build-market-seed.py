"""Build a compact, explicitly dated fallback from ArzMarket's public archives.

Run with --source-dir pointing at downloaded items.json and four info_users files.
Without it the script downloads the public files to a temporary directory.
"""
import argparse
import json
import re
import unicodedata
import urllib.request
from pathlib import Path

BASE = "https://raw.githubusercontent.com/FREYM1337/forumnick/main/"
SOURCES = {
    "buy": "avg_price/info_users_buy_chandler.json",
    "sell": "avg_price/info_users_sell_chandler.json",
    "vcBuy": "avg_price/info_users_buy_vc.json",
    "vcSell": "avg_price/info_users_sell_vc.json",
}


def normalize(name):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", name).strip()).casefold()


def load_file(path, source_dir):
    if source_dir:
        return (source_dir / Path(path).name).read_bytes()
    request = urllib.request.Request(BASE + path, headers={"User-Agent": "Kalus-market-seed/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def newest_average(data):
    rows = data.get("list", []) if isinstance(data, dict) else []
    valid = [row for row in rows if isinstance(row, list) and len(row) >= 5
             and isinstance(row[0], str) and re.fullmatch(r"20\d\d-\d\d-\d\d", row[0])
             and isinstance(row[4], (int, float)) and row[4] > 0]
    if not valid:
        return None
    row = max(valid, key=lambda value: value[0])
    return {"date": row[0], "price": round(row[4]), "count": row[1]}


def build(source_dir):
    names = json.loads(load_file("ArzMarketV3/items.json", source_dir).decode("utf-8"))
    archive = {}
    for field, path in SOURCES.items():
        archive[field] = {
            normalize(name): newest_average(value)
            for name, value in json.loads(load_file(path, source_dir).decode("cp1251")).items()
        }
    mapped = {}
    for item_id, name in names.items():
        if not item_id.isdigit() or not name or name.strip().upper() == "DELETED":
            continue
        key = normalize(name)
        entry = {field: archive[field][key] for field in SOURCES if archive[field].get(key)}
        if entry:
            mapped[item_id] = {"name": name.strip(), **entry}
    return {"source": "FREYM1337/forumnick avg_price", "items": mapped}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("market-seed.json"))
    args = parser.parse_args()
    payload = build(args.source_dir)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("Market archive:", len(payload["items"]), "items; ID 1766:", payload["items"].get("1766"))
