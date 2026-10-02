"""Test helpers: in-memory images (no binary fixtures) and /detect requests."""

from datetime import datetime, timezone

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


# --- M2: history dataset -------------------------------------------------------

def utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


# Standard dataset S from test-plans/milestone-2.md, in insertion order R5, R1, R3, R2, R4.
# Counts are unique so records can be identified by count.
DATASET_S = [
    # (rec, timestamp, count, average_confidence, inference_time_ms)
    ("R5", utc(2026, 10, 3, 0, 0, 0), 3, 1.00, 50.0),
    ("R1", utc(2026, 10, 1, 23, 59, 59, 999999), 1, 0.50, 10.0),
    ("R3", utc(2026, 10, 2, 12, 0, 0), 0, 0.00, 30.0),
    ("R2", utc(2026, 10, 2, 0, 0, 0), 2, 0.80, 20.0),
    ("R4", utc(2026, 10, 2, 23, 59, 59, 999999), 4, 0.70, 40.0),
]


def counts(response) -> list[int]:
    """Assert 200 and return the record counts in response order."""
    assert response.status_code == 200, response.text
    return [r["count"] for r in response.json()]
