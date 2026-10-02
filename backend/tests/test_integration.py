"""Real YOLO model (config.MODEL_PATH) on ultralytics' bundled images."""

import base64
import statistics

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from ultralytics.utils import ASSETS

from backend import config
from backend.main import app
from backend.services.detector import get_detector
from backend.tests.helpers import jpeg_bytes, post_image

pytestmark = pytest.mark.integration

BUS = (ASSETS / "bus.jpg").read_bytes()
ZIDANE = (ASSETS / "zidane.jpg").read_bytes()


def test_bus_people_counted(client):
    """M1-int-01"""
    response = post_image(client, BUS, "image/jpeg", filename="bus.jpg")

    assert response.status_code == 200
    body = response.json()
    assert 3 <= body["count"] <= 4
    assert body["image_width"] == 810
    assert body["image_height"] == 1080
    confidences = [d["confidence"] for d in body["detections"]]
    assert all(0.5 <= c <= 1.0 for c in confidences)
    assert body["average_confidence"] == pytest.approx(statistics.mean(confidences))
    for det in body["detections"]:
        x1, y1, x2, y2 = det["bbox"]
        assert 0 <= x1 < x2 <= 810
        assert 0 <= y1 < y2 <= 1080


def test_zidane_two_people(client):
    """M1-int-02"""
    response = post_image(client, ZIDANE, "image/jpeg", filename="zidane.jpg")

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 2
    assert body["image_width"] == 1280
    assert body["image_height"] == 720


def test_blank_frame_no_detections(client):
    """M1-int-03"""
    response = post_image(client, jpeg_bytes(640, 480), "image/jpeg")

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 0
    assert body["detections"] == []
    assert body["average_confidence"] == 0.0


def test_annotated_image_matches_frame(client):
    """M1-int-04"""
    response = post_image(
        client, BUS, "image/jpeg", filename="bus.jpg", params={"return_annotated": "true"}
    )

    assert response.status_code == 200
    body = response.json()
    raw = base64.b64decode(body["annotated_image_base64"])
    decoded = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == (body["image_height"], body["image_width"], 3)


def test_warm_inference_time_within_target(monkeypatch):
    """M1-int-05"""
    monkeypatch.setattr(config, "WARMUP_MODEL", True, raising=False)
    get_detector.cache_clear()

    with TestClient(app) as client:
        times = []
        for _ in range(3):
            response = post_image(client, BUS, "image/jpeg", filename="bus.jpg")
            assert response.status_code == 200
            times.append(response.json()["inference_time_ms"])

    assert all(t > 0 for t in times), times
    assert statistics.mean(times) < 1500, times
