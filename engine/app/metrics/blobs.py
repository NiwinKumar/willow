"""Laplacian-of-Gaussian blob search: skimage.feature.blob_log's maths with OpenCV filters.

skimage builds its scale space with scipy.ndimage.gaussian_laplace, which runs on one core
and was most of the blob search's time (pores, blemishes, dark spots). This is the same
scale-normalised LoG (second derivative of a Gaussian along each axis, the kernels scipy
uses: radius int(4 * sigma + 0.5), mirrored edges), the same peak search and the same
overlap pruning, so it finds the same blobs (tests/test_blobs.py).
"""

import cv2
import numpy as np
from skimage._shared.utils import _supported_float_type
from skimage.feature import peak_local_max
from skimage.feature.blob import _format_exclude_border, _prune_blobs
from skimage.util import img_as_float

TRUNCATE = 4.0  # scipy.ndimage's default kernel reach, in sigmas


def _kernels(sigma: float) -> tuple[np.ndarray, np.ndarray]:
    """(Gaussian, its second derivative) as column vectors, as scipy's _gaussian_kernel1d."""
    radius = int(TRUNCATE * sigma + 0.5)
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    g = np.exp(-0.5 / (sigma * sigma) * x**2)
    g /= g.sum()
    d2 = (x**2 / sigma**4 - 1.0 / sigma**2) * g
    return g[:, None], d2[:, None]


def gaussian_laplace(image: np.ndarray, sigma: float) -> np.ndarray:
    """ndimage.gaussian_laplace(image, sigma) for a 2-D float32 / float64 image (mode
    'reflect'), in the image's float type."""
    g, d2 = _kernels(sigma)
    depth = cv2.CV_32F if image.dtype == np.float32 else cv2.CV_64F
    border = cv2.BORDER_REFLECT  # scipy 'reflect': d c b a | a b c d | d c b a
    yy = cv2.sepFilter2D(image, depth, g, d2, borderType=border)
    xx = cv2.sepFilter2D(image, depth, d2, g, borderType=border)
    return yy + xx


def blob_log_fast(
    image: np.ndarray,
    min_sigma: float = 1,
    max_sigma: float = 50,
    num_sigma: int = 10,
    threshold: float = 0.2,
    overlap: float = 0.5,
) -> np.ndarray:
    """skimage.feature.blob_log for a 2-D image with scalar sigmas (linear sigma steps, no
    border exclusion, no relative threshold): (N, 3) rows of (row, col, sigma)."""
    if image.ndim != 2:
        raise ValueError("blob_log_fast takes a 2-D image")
    # as skimage: the image and the sigmas (one per axis) in the image's float type
    image = img_as_float(image)
    float_dtype = _supported_float_type(image.dtype)
    image = np.ascontiguousarray(image, dtype=float_dtype)
    min_s = np.full(image.ndim, min_sigma, dtype=float_dtype)
    max_s = np.full(image.ndim, max_sigma, dtype=float_dtype)
    sigma_list = np.linspace(min_s, max_s, num_sigma)
    cube = np.empty(image.shape + (len(sigma_list),), dtype=float_dtype)
    for i, s in enumerate(sigma_list):
        cube[..., i] = -gaussian_laplace(image, float(s[0])) * np.mean(s) ** 2
    local_maxima = peak_local_max(
        cube,
        threshold_abs=threshold,
        threshold_rel=None,
        exclude_border=_format_exclude_border(image.ndim, False),
        footprint=np.ones((3,) * (image.ndim + 1)),
    )
    if local_maxima.size == 0:
        return np.empty((0, image.ndim + 1))
    lm = local_maxima.astype(float_dtype)
    sigmas_of_peaks = sigma_list[local_maxima[:, -1]][:, 0:1]
    lm = np.hstack([lm[:, :-1], sigmas_of_peaks])
    return _prune_blobs(lm, overlap, sigma_dim=1)
