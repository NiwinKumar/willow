"""Rectangular ROIs (forearm squares, white paper) and the skin mask inside them."""

from dataclasses import dataclass

import numpy as np

from app import config


@dataclass(frozen=True)
class Box:
    x: int
    y: int
    w: int
    h: int

    @classmethod
    def parse(cls, text: str) -> "Box":
        """'x,y,w,h' in pixels of the upright photo."""
        parts = [int(v) for v in text.split(",")]
        if len(parts) != 4 or parts[2] <= 0 or parts[3] <= 0:
            raise ValueError(f"ROI must be x,y,w,h with positive w,h: {text!r}")
        return cls(*parts)

    def crop(self, img: np.ndarray) -> np.ndarray:
        h, w = img.shape[:2]
        if self.x < 0 or self.y < 0 or self.x + self.w > w or self.y + self.h > h:
            raise ValueError(f"ROI {self} is outside the {w}x{h} image")
        return img[self.y : self.y + self.h, self.x : self.x + self.w]

    def polygon(self) -> list[list[float]]:
        x0, y0, x1, y1 = self.x, self.y, self.x + self.w, self.y + self.h
        return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def skin_mask(lab: np.ndarray) -> np.ndarray:
    """Keep pixels between the ROI's own 1st and 99th L* percentiles.

    Relative to this person's skin, not an absolute cut-off, so it works for every tone.
    """
    L = lab[..., 0]
    lo, hi = np.percentile(L, [config.SKIN_LOW_PCT, config.SKIN_HIGH_PCT])
    return (L >= lo) & (L <= hi)
