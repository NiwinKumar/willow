"""A blurred mask shared by several local means (shine, blemishes, dark spots) gives exactly the
numbers of computing it each time: the speed-up must not move a reading."""

import numpy as np

from app.landmarks import _local_mean, mask_weight
from app.metrics import blemish


def _inputs():
    rng = np.random.default_rng(3)
    values = rng.normal(60, 8, (180, 140)).astype(np.float32)
    mask = rng.random((180, 140)) > 0.3
    mask[40:90, 30:70] = False  # a hole (an eye) the mean must fill from the skin around it
    return values, mask


def test_shared_weight_is_bit_identical():
    values, mask = _inputs()
    sigma = 17.3
    w = mask_weight(mask, sigma)
    assert np.array_equal(_local_mean(values, mask, sigma, w), _local_mean(values, mask, sigma))
    assert np.array_equal(
        blemish._local_mean(values, mask, sigma, w), blemish._local_mean(values, mask, sigma)
    )
