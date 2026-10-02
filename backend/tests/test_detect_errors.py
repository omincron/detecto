"""POST /detect error handling and edge cases (fake detector)."""

import numpy as np
import pytest

from backend import config
from backend.tests.helpers import (
    assert_error_body,
    encode,
    jpeg_bytes,
    make_image,
    png_bytes,
    post_image,
)


def test_empty_upload_rejected(client, fake_detector):
    """M1-detect-err-01"""
    response = post_image(client, b"", "image/jpeg")

    assert response.status_code == 400
    assert_error_body(response)
    assert "empty" in response.json()["detail"].lower()
    assert fake_detector.detect_calls == 0


def test_non_image_content_type_rejected(client, fake_detector):
    """M1-detect-err-02"""
    response = post_image(client, b"hello", "text/plain", filename="a.txt")

    assert response.status_code == 415
    assert_error_body(response)
    assert "text/plain" in response.json()["detail"]
    assert fake_detector.detect_calls == 0


def _bmp():
    return encode(make_image(80, 50), ".bmp")


def _webp():
    return encode(make_image(80, 50), ".webp")


@pytest.mark.parametrize(
    "data_factory, content_type, sniffed",
    [
        (_bmp, "image/bmp", False),
        (lambda: b"whatever", "image/gif", False),
        (_bmp, "image/jpeg", True),
        (lambda: b"GIF89a" + bytes(50), "image/jpeg", True),
        (_webp, "image/png", True),
    ],
    ids=["a-bmp-as-bmp", "b-gif-type", "c-bmp-as-jpeg", "d-gif-as-jpeg", "e-webp-as-png"],
)
def test_other_image_formats_rejected(client, fake_detector, data_factory, content_type, sniffed):
    """M1-detect-err-03"""
    response = post_image(client, data_factory(), content_type)

    assert response.status_code == 415
    assert_error_body(response)
    assert fake_detector.detect_calls == 0
    if sniffed:
        detail = response.json()["detail"]
        assert "JPEG" in detail and "PNG" in detail


def test_corrupt_jpeg_rejected(client, fake_detector):
    """M1-detect-err-04"""
    response = post_image(client, b"notanimage", "image/jpeg")

    assert response.status_code == 400
    assert_error_body(response)
    assert fake_detector.detect_calls == 0


def test_truncated_png_rejected(client, fake_detector):
    """M1-detect-err-05"""
    response = post_image(client, png_bytes()[:30], "image/png")

    assert response.status_code == 400
    assert_error_body(response)
    assert fake_detector.detect_calls == 0


def test_missing_file_no_body(client, fake_detector):
    """M1-detect-err-06 (a)"""
    response = client.post("/detect")

    assert response.status_code == 400
    assert_error_body(response)
    assert fake_detector.detect_calls == 0


def test_missing_file_wrong_field_name(client, fake_detector):
    """M1-detect-err-06 (b)"""
    response = client.post("/detect", files={"file": ("a.png", png_bytes(), "image/png")})

    assert response.status_code == 400
    assert_error_body(response)
    assert fake_detector.detect_calls == 0


def test_inference_failure_returns_500(client, fake_detector):
    """M1-detect-err-07"""
    fake_detector.error = RuntimeError("kaboom")
    response = post_image(client, png_bytes(), "image/png")

    assert response.status_code == 500
    assert_error_body(response)
    assert response.json()["detail"].startswith("Inference failed")


@pytest.mark.parametrize(
    "width, height, expected_w, expected_h",
    [(4000, 1, 1280, 1), (1, 4000, 1, 1280)],
    ids=["4000x1", "1x4000"],
)
def test_extreme_aspect_ratio_processed(client, fake_detector, width, height, expected_w, expected_h):
    """M1-detect-err-08"""
    response = post_image(client, png_bytes(width, height), "image/png")

    assert response.status_code == 200
    body = response.json()
    assert body["image_width"] == expected_w
    assert body["image_height"] == expected_h
    assert fake_detector.received[0].shape == (expected_h, expected_w, 3)


def test_detect_is_post_only(client):
    """M1-detect-err-09"""
    assert client.get("/detect").status_code == 405


@pytest.mark.parametrize(
    "data_factory, content_type",
    [
        (png_bytes, "image/jpg"),
        (png_bytes, "IMAGE/PNG"),
        (png_bytes, "application/octet-stream"),
        (png_bytes, "image/jpeg"),
        (jpeg_bytes, "image/png"),
        (jpeg_bytes, "image/jpeg; charset=binary"),
    ],
    ids=["a-png-as-image-jpg", "b-png-uppercase", "c-png-octet-stream",
         "d-png-as-jpeg", "e-jpeg-as-png", "f-jpeg-with-params"],
)
def test_declared_type_is_lenient(client, fake_detector, data_factory, content_type):
    """M1-detect-err-10"""
    response = post_image(client, data_factory(), content_type)

    assert response.status_code == 200, response.text
    assert response.json()["count"] == 2


def _noisy_png() -> bytes:
    rng = np.random.default_rng(0)
    data = encode(rng.integers(0, 256, (40, 40, 3), dtype=np.uint8), ".png")
    assert len(data) > 1000
    return data


def _small_png() -> bytes:
    data = png_bytes(10, 10)
    assert len(data) <= 1000
    return data


def test_upload_over_limit_rejected(client, fake_detector, monkeypatch):
    """M1-detect-err-11 (oversized)"""
    monkeypatch.setattr(config, "MAX_UPLOAD_BYTES", 1000, raising=False)
    response = post_image(client, _noisy_png(), "image/png")

    assert response.status_code == 413
    assert_error_body(response)
    assert fake_detector.detect_calls == 0


def test_upload_within_limit_accepted(client, fake_detector, monkeypatch):
    """M1-detect-err-11 (within limit)"""
    monkeypatch.setattr(config, "MAX_UPLOAD_BYTES", 1000, raising=False)
    response = post_image(client, _small_png(), "image/png")

    assert response.status_code == 200
