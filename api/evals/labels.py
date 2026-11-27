"""Pack labels drawn in code for the label-scan cases (no photos are kept in the repo).

A clean printed label is the easy case for a real pack photo; what these cases test is the part
the validators cannot: whether the model transcribes only what is printed (no added ingredients,
no percentages that are not on the pack) and ignores instructions printed on the label.
"""

import io
import textwrap
from typing import Any

from PIL import Image, ImageDraw, ImageFont

WIDTH = 900
MARGIN = 40


def lines_of(label: dict[str, Any]) -> list[tuple[str, int]]:
    """(text, font size) per printed line, top to bottom."""
    out: list[tuple[str, int]] = []
    if label.get("brand"):
        out.append((label["brand"].upper(), 44))
    if label.get("name"):
        out += [(t, 34) for t in textwrap.wrap(label["name"], 40)]
    for claim in label.get("claims") or []:
        out.append((claim, 26))
    if label.get("inci"):
        out.append(("", 12))
        text = "INGREDIENTS: " + ", ".join(label["inci"]) + "."
        out += [(t, 22) for t in textwrap.wrap(text, 70)]
    for extra in label.get("extra_lines") or []:
        out.append(("", 12))
        out += [(t, 22) for t in textwrap.wrap(extra, 70)]
    return out


def render(label: dict[str, Any]) -> bytes:
    """A PNG of the label; an empty label draws a blank card (the "no label" case)."""
    rows = lines_of(label)
    height = max(400, MARGIN * 2 + sum(size + 10 for _, size in rows))
    img = Image.new("RGB", (WIDTH, height), (250, 248, 244))
    draw = ImageDraw.Draw(img)
    y = MARGIN
    for text, size in rows:
        font = ImageFont.load_default(size=size)
        draw.text((MARGIN, y), text, fill=(20, 20, 20), font=font)
        y += size + 10
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
