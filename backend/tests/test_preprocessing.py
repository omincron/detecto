"""utils/preprocessing.py pure functions."""

import base64

import cv2
import numpy as np
import pytest

from backend.tests.helpers import encode, make_image, png_bytes
from backend.utils.preprocessing import decode_image, encode_image_base64, preprocess_image


@pytest.mark.parametrize("ext", [".jpg", ".png"])
def test_decode_jpeg_and_png(ext):
    """M1-prep-01"""
    image = decode_image(encode(make_image(80, 50, value=120), ext))

    assert isinstance(image, np.ndarray)
    assert image.shape == (50, 80, 3)
    assert image.dtype == np.uint8


@pytest.mark.parametrize("channels", [1, 4], ids=["grayscale", "rgba"])
def test_decode_normalizes_to_three_channels(channels):
    """M1-prep-02"""
    image = decode_image(png_bytes(10, 10, channels=channels))

    assert image.shape == (10, 10, 3)
    assert image.dtype == np.uint8


@pytest.mark.parametrize(
    "data", [b"notanimage", png_bytes()[:30]], ids=["garbage", "truncated-png"]
)
def test_decode_rejects_undecodable_bytes(data):
    """M1-prep-03"""
    with pytest.raises(ValueError):
        decode_image(data)


def test_decode_rejects_empty_bytes():
    """M1-prep-04"""
    with pytest.raises(ValueError):
        decode_image(b"")


@pytest.mark.parametrize("shape", [(50, 80, 3), (720, 1280, 3), (1280, 720, 3), (2, 2, 3)])
def test_preprocess_keeps_small_images(shape):
    """M1-prep-05"""
    assert preprocess_image(np.zeros(shape, np.uint8)).shape == shape


@pytest.mark.parametrize(
    "height, width, expected_heights, expected_width",
    [
        (1000, 3000, {425, 426, 427}, 1280),
        (4000, 2000, {1280}, 640),
        (10, 1281, {9, 10}, 1280),
    ],
    ids=["landscape", "portrait", "just-over"],
)
def test_preprocess_downscales_long_edge(height, width, expected_heights, expected_width):
    """M1-prep-06"""
    out = preprocess_image(np.zeros((height, width, 3), np.uint8))

    assert out.shape[0] in expected_heights
    assert out.shape[1] == expected_width
    assert out.shape[2] == 3


@pytest.mark.parametrize(
    "height, width, expected",
    [(1, 4000, (1, 1280, 3)), (4000, 1, (1280, 1, 3)), (2, 5000, (1, 1280, 3))],
    ids=["1x4000", "4000x1", "2x5000"],
)
def test_preprocess_never_below_one_pixel(height, width, expected):
    """M1-prep-06b"""
    assert preprocess_image(np.zeros((height, width, 3), np.uint8)).shape == expected


def test_preprocess_returns_uint8_and_leaves_input():
    """M1-prep-07"""
    rng = np.random.default_rng(0)
    image = rng.integers(0, 256, (100, 120, 3), dtype=np.uint8)
    original = image.copy()

    out = preprocess_image(image)

    assert out.dtype == np.uint8
    assert out.ndim == 3 and out.shape[2] == 3
    assert np.array_equal(image, original)


def test_preprocess_increases_local_contrast():
    """M1-prep-08"""
    row = np.linspace(100, 115, 200).astype(np.uint8)
    gray = np.tile(row, (200, 1))
    image = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

    out = preprocess_image(image)

    out_gray = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)
    assert out_gray.std() > gray.std()


def test_encode_image_base64_is_jpeg():
    """M1-prep-09"""
    encoded = encode_image_base64(make_image(80, 50, value=60))

    assert isinstance(encoded, str)
    raw = base64.b64decode(encoded)
    assert raw[:3] == b"\xff\xd8\xff"
    decoded = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == (50, 80, 3)
