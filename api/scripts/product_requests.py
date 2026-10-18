"""The product request queue (app/product_requests.py), most asked-for first.

    uv run python scripts/product_requests.py list [--all]
    uv run python scripts/product_requests.py photo <key> [out_dir]  # the pack photos
    uv run python scripts/product_requests.py added <key> <product_id>
    uv run python scripts/product_requests.py declined <key>

Add the product to the catalog first (docs/CATALOG_SPEC.md: INCI from the official page), deploy
the api so it is live, then mark the request `added` with its product_id: everyone who asked sees
it in the app and gets a push on devices with reminders on. Their photos are deleted.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import product_requests, storage  # noqa: E402
from app.routes.reminders_routes import _deliver  # noqa: E402
from app.settings import get_settings  # noqa: E402
from app.store import FirestoreStore  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    ls = sub.add_parser("list")
    ls.add_argument("--all", action="store_true", help="answered requests too")
    ph = sub.add_parser("photo")
    ph.add_argument("key")
    ph.add_argument("out_dir", nargs="?", default=".")
    for status in ("added", "declined"):
        p = sub.add_parser(status)
        p.add_argument("key")
        if status == "added":
            p.add_argument("product_id")
    args = ap.parse_args()
    store = FirestoreStore()

    if args.cmd == "list":
        rows = [r for r in store.product_wishes() if args.all or r[1].get("status") == "pending"]
        rows.sort(key=lambda r: (-int(r[1].get("count") or 0), str(r[1].get("first_at"))))
        for key, w in rows:
            label = " ".join(x for x in (w.get("brand"), w.get("name")) if x) or "(photo only)"
            print(f"{w.get('count', 0):>4}  {w.get('status', 'pending'):<9} {key}  {label}")
        print(f"{len(rows)} request(s)")
        return 0

    wish = store.product_wish_get(args.key)
    if wish is None:
        print(f"no request {args.key}")
        return 1
    if args.cmd == "photo":
        out = Path(args.out_dir)
        for uid in wish.get("requesters", []):
            for _rid, doc in store.product_requests_of(uid):
                if doc.get("key") == args.key and doc.get("photo_name"):
                    dest = out / Path(doc["photo_name"]).name
                    dest.write_bytes(storage.read_bytes(doc["photo_name"]))
                    print(dest)
        return 0

    product_id = getattr(args, "product_id", None)
    uids = product_requests.resolve(store, args.key, args.cmd, product_id)
    settings = get_settings()
    note = product_requests.message(args.cmd, wish.get("brand") or "", wish.get("name") or "")
    sent = 0
    for uid in uids:
        sent += _deliver(store, uid, note, settings)["sent"]
    print(f"{args.key}: {args.cmd} for {len(uids)} person(s); {sent} push(es) sent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
