"""POST /detect happy paths (fake detector)."""

import base64

import cv2
import numpy as np
import pytest

from backend.tests.helpers import jpeg_bytes, png_bytes, post_image

RESPONSE_KEYS = {
    "count",
    "detections",
    "average_confidence",
    "inference_time_ms",
    "image_width",
    "image_height",
    "annotated_image_base64",
}


def test_png_upload_returns_full_schema(client, fake_detector):
    """M1-detect-01"""
    response = post_image(client, png_bytes(80, 50), "image/png")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == RESPONSE_KEYS
    assert body["count"] == 2
    assert body["detections"] == [
        {"bbox": [1.0, 2.0, 30.0, 40.0], "confidence": 0.9},
        {"bbox": [5.0, 5.0, 20.0, 20.0], "confidence": 0.6},
    ]
    for det in body["detections"]:
        assert len(det["bbox"]) == 4
        assert all(isinstance(v, (int, float)) for v in det["bbox"])


def test_jpeg_upload_accepted(client, fake_detector):
    """M1-detect-02"""
    response = post_image(client, jpeg_bytes(80, 50), "image/jpeg")

    assert response.status_code == 200
    assert response.json()["count"] == 2


def test_average_confidence_is_mean(client, fake_detector):
    """M1-detect-03"""
    fake_detector.detections = [
        {"bbox": [0, 0, 10, 10], "confidence": 0.9},
        {"bbox": [0, 0, 10, 10], "confidence": 0.6},
        {"bbox": [0, 0, 10, 10], "confidence": 0.75},
    ]
    response = post_image(client, png_bytes(), "image/png")

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 3
    assert len(body["detections"]) == 3
    assert body["average_confidence"] == pytest.approx(0.75)


def test_no_people_returns_empty_result(client, fake_detector):
    """M1-detect-04"""
    fake_detector.detections = []
    response = post_image(client, png_bytes(), "image/png")

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 0
    assert body["detections"] == []
    assert body["average_confidence"] == 0.0


def test_small_image_not_upscaled(client, fake_detector):
    """M1-detect-05"""
    response = post_image(client, png_bytes(80, 50), "image/png")

    body = response.json()
    assert body["image_width"] == 80
    assert body["image_height"] == 50
    assert fake_detector.received[0].shape == (50, 80, 3)


def test_large_image_downscaled_to_1280(client, fake_detector):
    """M1-detect-06"""
    response = post_image(client, png_bytes(3000, 1000), "image/png")

    assert response.status_code == 200
    body = response.json()
    assert body["image_width"] == 1280
    assert body["image_height"] in {426, 427}
    assert fake_detector.detect_calls == 1
    assert fake_detector.received[0].shape == (body["image_height"], body["image_width"], 3)


def test_no_annotated_image_by_default(client, fake_detector):
    """M1-detect-07"""
    response = post_image(client, png_bytes(), "image/png")

    assert response.status_code == 200
    assert response.json().get("annotated_image_base64") is None
    assert fake_detector.annotate_calls == []


def test_return_annotated_gives_base64_jpeg(client, fake_detector):
    """M1-detect-08"""
    response = post_image(
        client, png_bytes(80, 50), "image/png", params={"return_annotated": "true"}
    )

    assert response.status_code == 200
    encoded = response.json()["annotated_image_base64"]
    assert isinstance(encoded, str) and encoded
    raw = base64.b64decode(encoded)
    assert raw[:3] == b"\xff\xd8\xff"
    decoded = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == (50, 80, 3)
    assert len(fake_detector.annotate_calls) == 1
    assert fake_detector.annotate_calls[0][1] == fake_detector.detections


def test_inference_time_from_detector(client, fake_detector):
    """M1-detect-09"""
    response = post_image(client, png_bytes(), "image/png")

    value = response.json()["inference_time_ms"]
    assert isinstance(value, (int, float))
    assert value == 12.5
    assert value >= 0


def test_grayscale_png_passed_as_three_channels(client, fake_detector):
    """M1-detect-10"""
    response = post_image(client, png_bytes(80, 50, channels=1), "image/png")

    assert response.status_code == 200
    received = fake_detector.received[0]
    assert received.shape == (50, 80, 3)
    assert received.dtype == np.uint8
