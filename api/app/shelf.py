"""Shelf vs results (Willow Proof, retailer workspace, Market -> Categories).

Per category, every measured product's share of the category against its share of the results:
- share of use: its users / all users of the category's measured products (Willow knows what
  people use, not what a store stocks, so this stands in for shelf share);
- share of stock: the retailer's own facings or stock units, from an uploaded CSV, when given
  (shelf/{uid}); it is checked against share of use (`agreement`) and then used as the shelf;
- share of results: its people with a visible change held to week 8 / all such people in the
  category (k = rate x n, as the Market view's brand shares).
`gap` = results - shelf: below zero a product takes more of the shelf than it delivers, above zero
it delivers more than its shelf. Products under 10 people at week 8 are left out.

Gemini reads this through tools and writes the flags (app/shelf_agent.py), in the background once
per filter, data version and upload; until then (and when Gemini can't be reached) the fixed flags
below are shown. Labels and the shares are code's; Gemini writes titles and reasons, checked.
"""

import csv
import hashlib
import io
import logging
import threading
import time
from datetime import UTC, datetime
from typing import Any

from app import catalog, retail_intel, retailer
from app.store import Doc, iso

log = logging.getLogger("willow.shelf")

MIN = retailer.MIN_GROUP
MAX_ROWS = 500
GAP = 0.05  # fixed flags: this far between shelf and results
MIN_SHELF = 0.08  # fixed "taking space" flags only for products with this much of the shelf
MISMATCH = 0.10  # stock vs use this far apart: the upload and Willow disagree on the product

KIND_LABEL = {
    "taking_space": "Taking space, not delivering",
    "under_shelved": "Delivers, under-shelved",
    "stocked_unused": "Stocked, little used",
    "used_understocked": "Used, under-stocked",
}
STOCK_COLUMNS = ("facings", "stock_units", "stock", "units")
NOTE_USE = (
    "Shelf = share of use: how much of the category's Willow users use the product. Willow has no "
    "stock data; upload your facings or stock to compare with your real shelf."
)
NOTE_STOCK = (
    "Shelf = your uploaded facings or stock where a product is in the file, else share of use. "
    "Results are measured visible changes held to week 8, not sales."
)


def _r2(x: float) -> float:
    return round(x, 2)


# -- the stock upload ---------------------------------------------------------------------------


class BadUpload(ValueError):
    """The CSV can't be used; the message says why."""


def _key(s: str) -> str:
    return " ".join(s.lower().replace("’", "'").split())


def parse_stock(text: str) -> tuple[list[dict[str, Any]], list[str], str]:
    """CSV with a header: `product_id` (or `product`, "Brand Name" as in the catalog) and one of
    facings / stock_units / stock / units. Returns ([{product_id, qty}], unmatched names, the
    quantity column)."""
    try:
        reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
        fields = [(f or "").strip().lower() for f in reader.fieldnames or []]
    except csv.Error as exc:
        raise BadUpload(f"That file isn't a readable CSV: {exc}.") from exc
    qty_col = next((c for c in STOCK_COLUMNS if c in fields), None)
    id_col = "product_id" if "product_id" in fields else "product" if "product" in fields else None
    if not id_col or not qty_col:
        raise BadUpload(
            "The CSV needs a header with product_id (or product) and facings (or stock_units)."
        )
    by_id = {p["product_id"]: p for p in catalog.products()}
    by_name = {_key(f"{p['brand']} {p['name']}"): p["product_id"] for p in catalog.products()}
    rows: dict[str, float] = {}
    unmatched: list[str] = []
    for i, raw in enumerate(reader, start=2):
        if i - 1 > MAX_ROWS:
            raise BadUpload(f"Keep it to {MAX_ROWS} rows.")
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        ident, q = r.get(id_col, ""), r.get(qty_col, "")
        if not ident and not q:
            continue
        try:
            qty = float(q.replace(",", ""))
        except ValueError as exc:
            raise BadUpload(f"Row {i}: {qty_col} should be a number.") from exc
        if qty < 0:
            raise BadUpload(f"Row {i}: {qty_col} can't be negative.")
        pid = ident if ident in by_id else by_name.get(_key(ident))
        if pid is None:
            unmatched.append(ident)
            continue
        rows[pid] = rows.get(pid, 0.0) + qty
    if not rows:
        raise BadUpload("No row matched a catalog product (use product_id from the template).")
    return [{"product_id": p, "qty": q} for p, q in rows.items()], unmatched[:20], qty_col


def stock_doc(filename: str, rows: list[dict[str, Any]], unmatched: list[str], column: str) -> Doc:
    digest = hashlib.sha256(repr(sorted((r["product_id"], r["qty"]) for r in rows)).encode())
    return {
        "filename": filename[:120],
        "uploaded_at": datetime.now(UTC),
        "rows": rows,
        "unmatched": unmatched,
        "column": column,
        "version": digest.hexdigest()[:16],
    }


def stock_view(doc: Doc | None) -> dict[str, Any] | None:
    if not doc:
        return None
    return {
        "filename": doc.get("filename"),
        "uploaded_at": iso(doc.get("uploaded_at")),
        "matched": len(doc.get("rows") or []),
        "unmatched": doc.get("unmatched") or [],
        "column": doc.get("column"),
    }


# -- the shares ---------------------------------------------------------------------------------


def categories(rows: list[dict[str, Any]], stock: Doc | None) -> list[dict[str, Any]]:
    """Per category, its measured products with share of use, of stock (when uploaded), of
    results, the shelf used and the gap; plus how far the upload agrees with share of use."""
    qty = {r["product_id"]: float(r["qty"]) for r in (stock or {}).get("rows") or []}
    out = []
    cats = sorted({r["category"] for r in rows})
    for cat in cats:
        prods = [
            r
            for r in rows
            if r["category"] == cat
            and r.get("n")
            and r.get("rate") is not None
            and (r.get("users") or 0) >= MIN
        ]
        if len(prods) < 2:
            continue
        users = sum(r["users"] for r in prods)
        changed = {r["product_id"]: round(r["rate"] * r["n"]) for r in prods}
        total = sum(changed.values())
        if not users or not total:
            continue
        stocked = [r for r in prods if r["product_id"] in qty]
        stock_total = sum(qty[r["product_id"]] for r in stocked)
        use_stocked = sum(r["users"] for r in stocked)
        has_stock = len(stocked) >= 2 and stock_total > 0
        items = []
        for r in prods:
            pid = r["product_id"]
            use = r["users"] / users
            res = changed[pid] / total
            stock_share = qty[pid] / stock_total if has_stock and pid in qty else None
            # stock shares are of the stocked products; rescale to the category so they compare
            shelf = stock_share * (use_stocked / users) if stock_share is not None else use
            items.append(
                {
                    "product_id": pid,
                    "product": r["product"],
                    "brand": r["brand"],
                    "image_url": r.get("image_url"),
                    "users": r["users"],
                    "n": r["n"],
                    "changed": changed[pid],
                    "tier": r.get("tier"),
                    "lift": r.get("lift"),
                    "lift_lo": r.get("lift_lo"),
                    "cont8": r.get("cont8"),
                    "use_share": _r2(use),
                    "stock_share": _r2(shelf) if stock_share is not None else None,
                    "results_share": _r2(res),
                    "shelf_share": _r2(shelf),
                    "basis": "stock" if stock_share is not None else "use",
                    "gap": _r2(res - shelf),
                }
            )
        items.sort(key=lambda x: (-x["shelf_share"], x["product_id"]))
        agreement = None
        if has_stock:
            # 1 - total variation distance between stock and use, over the stocked products
            diff = sum(
                abs(qty[r["product_id"]] / stock_total - r["users"] / use_stocked) for r in stocked
            )
            agreement = _r2(1 - diff / 2)
        out.append(
            {
                "category": cat,
                "label": retailer.CATEGORY_LABEL.get(cat, cat),
                "users": users,
                "changed": total,
                "basis": "stock" if has_stock else "use",
                "stocked": len(stocked) if has_stock else 0,
                "agreement": agreement,
                "products": items,
            }
        )
    return out


def kind_ok(p: dict[str, Any], kind: str, margin: float) -> bool:
    """Whether the numbers point this way (code's check on every flag, Gemini's or fixed)."""
    if kind == "taking_space":
        return p["gap"] <= -margin
    if kind == "under_shelved":
        return p["gap"] >= margin and p.get("tier") in ("proven", "promising")
    if p.get("stock_share") is None:
        return False
    if kind == "stocked_unused":
        return p["stock_share"] - p["use_share"] >= margin
    if kind == "used_understocked":
        return p["use_share"] - p["stock_share"] >= margin
    return False


def _pts(x: float) -> str:
    return f"{round(abs(x) * 100)}%"


def rules_flags(cats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The fixed flags: the biggest mismatches, one sentence each from the shares."""
    found = []
    for c in cats:
        shelf_word = "of stock" if c["basis"] == "stock" else "of use"
        for p in c["products"]:
            name = f"{p['brand']} {p['product']}"
            cat = c["label"].lower()
            if (
                kind_ok(p, "taking_space", GAP)
                and p["shelf_share"] >= MIN_SHELF
                and p["tier"] != "proven"
            ):
                found.append(
                    (
                        abs(p["gap"]),
                        flag(
                            p,
                            c,
                            "taking_space",
                            f"Review the space for {name}",
                            f"{_pts(p['shelf_share'])} {shelf_word} in {cat}, but "
                            f"{_pts(p['results_share'])} of the visible changes (n={p['n']}).",
                        ),
                    )
                )
            if kind_ok(p, "under_shelved", GAP):
                found.append(
                    (
                        abs(p["gap"]),
                        flag(
                            p,
                            c,
                            "under_shelved",
                            f"Give {name} more room",
                            f"{_pts(p['results_share'])} of the visible changes in {cat} from "
                            f"{_pts(p['shelf_share'])} {shelf_word} (n={p['n']}).",
                        ),
                    )
                )
            for kind, a, b in (
                ("stocked_unused", "stock_share", "use_share"),
                ("used_understocked", "use_share", "stock_share"),
            ):
                if kind_ok(p, kind, MISMATCH):
                    found.append(
                        (
                            abs(p[a] - p[b]),
                            flag(
                                p,
                                c,
                                kind,
                                "Check the stock against use"
                                if kind == "stocked_unused"
                                else "Stock more of it",
                                f"{name}: {_pts(p['stock_share'])} of your {cat} stock, "
                                f"{_pts(p['use_share'])} of use among Willow users.",
                            ),
                        )
                    )
    found.sort(key=lambda x: -x[0])
    return [f for _, f in found[:6]]


def flag(p: dict[str, Any], c: dict[str, Any], kind: str, title: str, reason: str) -> dict:
    return {
        "product_id": p["product_id"],
        "product": p["product"],
        "brand": p["brand"],
        "image_url": p.get("image_url"),
        "category": c["category"],
        "category_label": c["label"],
        "kind": kind,
        "label": KIND_LABEL[kind],
        "title": title,
        "reason": reason,
    }


# -- the list and its background agent ---------------------------------------------------------

_cache: dict[tuple, tuple[float, dict[str, Any]]] = {}
_inflight: dict[tuple, threading.Thread] = {}
_lock = threading.Lock()
CACHE_S = 6 * 3600
RETRY_S = 60
WAIT_S = 1.5


def _agent(key: tuple, cats: list[dict], cohort_: str, range_: str, has_stock: bool) -> None:
    from app import shelf_agent

    try:
        flags, summary = shelf_agent.run(cats, cohort_, range_, has_stock)
        out, ttl = {"flags": flags, "summary": summary, "source": "gemini"}, CACHE_S
    except Exception as exc:  # Gemini unreachable, or it flagged nothing usable
        log.info("shelf flags without Gemini: %s", exc)
        out, ttl = {"flags": rules_flags(cats), "summary": None, "source": "rules"}, RETRY_S
    with _lock:
        _cache[key] = (time.time() + ttl, out)


def view(cohort_: str, range_: str, stock: Doc | None) -> dict[str, Any]:
    """The shares and the flags. Gemini's flags are written in the background; until they are
    ready the fixed flags come with `pending: true`. Raises when the rows are unavailable."""
    rows = retail_intel.products(cohort_, range_)
    _, version = retailer._rows()
    cats = categories(rows["products"], stock)
    has_stock = any(c["basis"] == "stock" for c in cats)
    head = {
        "filters": rows.get("filters"),
        "cohort": rows.get("cohort"),
        "categories": cats,
        "stock": stock_view(stock),
        "note": NOTE_STOCK if has_stock else NOTE_USE,
        "kind_labels": KIND_LABEL,
    }
    key = (cohort_, range_, version, (stock or {}).get("version"))
    with _lock:
        hit = _cache.get(key)
    if hit and time.time() < hit[0]:
        return head | hit[1] | {"pending": False}
    if not cats:
        return head | {"flags": [], "summary": None, "source": "rules", "pending": False}
    with _lock:
        t = _inflight.get(key)
        if t is None or not t.is_alive():
            t = threading.Thread(
                target=_agent, args=(key, cats, cohort_, range_, has_stock), daemon=True
            )
            _inflight[key] = t
            t.start()
    t.join(WAIT_S)
    with _lock:
        hit = _cache.get(key)
    if hit and time.time() < hit[0]:
        return head | hit[1] | {"pending": False}
    return head | {"flags": rules_flags(cats), "summary": None, "source": "rules", "pending": True}
