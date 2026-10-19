"""blob_log_fast finds exactly the blobs skimage.feature.blob_log finds."""

import numpy as np
import pytest
from skimage.feature import blob_log

from app.metrics.blobs import blob_log_fast


def _spotty(seed: int, shape=(240, 320)) -> np.ndarray:
    """Noise plus dark-on-light-style round bumps of several sizes (as a z map / 10)."""
    rng = np.random.default_rng(seed)
    img = rng.normal(0, 0.02, shape)
    yy, xx = np.ogrid[: shape[0], : shape[1]]
    for _ in range(60):
        y, x = rng.uniform(0, shape[0]), rng.uniform(0, shape[1])
        r = rng.uniform(1.0, 9.0)
        img += rng.uniform(0.1, 0.6) * np.exp(-((yy - y) ** 2 + (xx - x) ** 2) / (2 * r * r))
    return np.clip(img, 0, None).astype(np.float32)


@pytest.mark.parametrize(
    ("seed", "kw"),
    [
        (
            0,
            {"min_sigma": 0.5, "max_sigma": 5.3, "num_sigma": 6, "threshold": 0.15, "overlap": 0.3},
        ),
        (
            1,
            {
                "min_sigma": 3.5,
                "max_sigma": 17.7,
                "num_sigma": 8,
                "threshold": 0.05,
                "overlap": 0.3,
            },
        ),
        (
            2,
            {"min_sigma": 1.2, "max_sigma": 7.0, "num_sigma": 8, "threshold": 0.05, "overlap": 0.3},
        ),
    ],
)
def test_same_blobs_as_skimage(seed, kw):
    img = _spotty(seed)
    ref = blob_log(img, **kw)
    got = blob_log_fast(img, **kw)
    assert len(ref) > 5
    assert got.dtype == ref.dtype
    np.testing.assert_array_equal(got, ref)


def test_no_blobs_on_flat_image():
    flat = np.zeros((50, 60), np.float32)
    kw = {"min_sigma": 1, "max_sigma": 3, "num_sigma": 3, "threshold": 0.05, "overlap": 0.3}
    assert blob_log_fast(flat, **kw).shape == blob_log(flat, **kw).shape == (0, 3)
