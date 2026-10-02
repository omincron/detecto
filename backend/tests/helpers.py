"""Test helpers: in-memory images (no binary fixtures) and /detect requests."""

import cv2
import numpy as np


def make_image(width: int, height: int, channels: int = 3, value: int = 0) -> np.ndarray:
    """Solid-colour uint8 image. channels=1 gives a 2D grayscale array."""
    shape = (height, width) if channels == 1 else (height, width, channels)
    return np.full(shape, value, dtype=np.uint8)


def encode(image: np.ndarray, ext: str = ".png") -> bytes:
    """Encode an array with cv2 (ext like ".png", ".jpg", ".bmp", ".webp")."""
    ok, buffer = cv2.imencode(ext, image)
    assert ok, f"cv2 could not encode {ext}"
    return buffer.tobytes()


def png_bytes(width: int = 80, height: int = 50, channels: int = 3) -> bytes:
    return encode(make_image(width, height, channels), ".png")


def jpeg_bytes(width: int = 80, height: int = 50) -> bytes:
    return encode(make_image(width, height), ".jpg")


def post_image(client, data: bytes, content_type: str, filename: str = "img", params=None):
    """POST /detect with `data` under the `image` multipart field."""
    return client.post(
        "/detect", files={"image": (filename, data, content_type)}, params=params
    )


def assert_error_body(response):
    """ARCHITECTURE.md §3.3: errors are {"detail": "<non-empty str>"}."""
    body = response.json()
    assert set(body) == {"detail"}, body
    assert isinstance(body["detail"], str) and body["detail"], body
