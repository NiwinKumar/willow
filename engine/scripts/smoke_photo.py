"""Day-1 smoke test: can the engine open a photo from the phone?

Usage (from engine/):  uv run python -m scripts.smoke_photo ../data/<file>.(heic|jpg|dng)
Prints basic facts and saves a preview PNG with a pixel grid to ../data/out/, so regions
(e.g. the taped forearm squares and the white paper) can be read off as x,y,w,h.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from app.decode import decode_dng, decode_photo, load_photo_srgb8, quicklook_dng

OUT_DIR = Path(__file__).resolve().parents[2] / "data" / "out"
GRID_PX = 250  # grid line spacing in full-resolution pixels


def draw_grid(img: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(img)
    w, h = img.size
    for x in range(0, w, GRID_PX):
        draw.line([(x, 0), (x, h)], fill=(0, 255, 255), width=2)
        draw.text((x + 4, 4), str(x), fill=(255, 255, 0))
    for y in range(0, h, GRID_PX):
        draw.line([(0, y), (w, y)], fill=(0, 255, 255), width=2)
        draw.text((4, y + 4), str(y), fill=(255, 255, 0))
    return img


def main(path: str) -> None:
    print(f"file          {path}")
    if Path(path).suffix.lower() == ".dng":
        linear, info = decode_dng(path)
        preview = quicklook_dng(path)
        print(f"raw type      {info.raw_type}   colour order {info.color_desc}")
        print(f"black levels  {info.black_levels}   white level {info.white_level}")
    else:
        linear, info = decode_photo(path)
        preview, _ = load_photo_srgb8(path)
        print(f"format        {info.format}   colour profile {info.color_profile}")
        print(f"camera        {info.camera}   ISO {info.iso}   exposure {info.exposure_s} s")
    h, w = linear.shape[:2]
    print(f"size          {w} x {h} px")
    print(f"mean linear RGB {np.round(linear.reshape(-1, 3).mean(axis=0), 4).tolist()}")
    print(f"clipped pixels {float(np.mean(linear.max(axis=2) >= 0.999)) * 100:.2f}%  (pure white)")
    print(f"dark pixels    {float(np.mean(linear.max(axis=2) <= 0.002)) * 100:.2f}%  (pure black)")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{Path(path).stem}_preview.png"
    draw_grid(Image.fromarray(preview)).save(out)
    print(f"preview       {out}  (grid every {GRID_PX} px)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
