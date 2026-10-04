#!/usr/bin/env python3
import json
import time
import urllib.request
from pathlib import Path

RAW = "https://raw.githubusercontent.com/FREYM1337/forumnick/main/"
FILES = {
    "buy": "avg_price/info_users_buy_chandler.json",
    "sell": "avg_price/info_users_sell_chandler.json",
    "vcBuy": "avg_price/info_users_buy_vc.json",
    "vcSell": "avg_price/info_users_sell_vc.json",
}
OUT = Path("extensions/chandler-hover/market-live.json")
UA = {"User-Agent": "Kalus-Chandler-Nightly/1.0 (+https://github.com/imvana122008/Kalus)"}


def get(path, encoding="utf-8"):
    req = urllib.request.Request(RAW + path, headers=UA)
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.loads(response.read().decode(encoding, errors="replace"))


def norm(value):
    return " ".join(str(value).strip().lower().split())


def recent(record):
    rows = record.get("list", []) if isinstance(record, dict) else []
    good = []
    for row in rows:
        if not isinstance(row, list) or len(row) < 5:
            continue
        date = str(row[0])
        try:
            price = float(row[4])
        except (TypeError, ValueError):
            continue
        if len(date) == 10 and date[4] == "-" and date[7] == "-" and price > 0:
            good.append((date, round(price), int(row[1] or 0)))
    if not good:
        return None
    date, price, count = max(good, key=lambda x: x[0])
    return {"date": date, "price": price, "count": count}


def main():
    catalog = get("ArzMarketV3/items.json")
    archives = {key: get(path, "cp1251") for key, path in FILES.items()}
    lookup = {
        key: {norm(name): recent(record) for name, record in rows.items()}
        for key, rows in archives.items()
    }
    items = {}
    for item_id, name in catalog.items():
        if not str(item_id).isdigit() or not isinstance(name, str) or not name.strip() or name.strip().upper() == "DELETED":
            continue
        entry = {"name": name.strip()}
        n = norm(name)
        for field in FILES:
            value = lookup[field].get(n)
            if value:
                entry[field] = value
        if len(entry) > 1:
            items[str(item_id)] = entry
    if len(items) < 100:
        raise SystemExit(f"Refusing incomplete snapshot: {len(items)} items")
    payload = {
        "checkedAt": int(time.time() * 1000),
        "source": "GitHub nightly · fallback archives",
        "items": items,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(items)} items to {OUT}")


if __name__ == "__main__":
    main()
