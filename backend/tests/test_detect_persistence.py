"""POST /detect side effects: saved history records and the per-detection log line."""

import logging
import sqlite3
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient
from ultralytics.utils import ASSETS

from backend import config
from backend.main import app
from backend.services.storage import get_storage
from backend.tests.helpers import assert_error_body, encode, png_bytes, post_image

DETECT_LOGGER = "backend.routes.detect"


def _history(client):
    response = client.get("/history")
    assert response.status_code == 200, response.text
    return response.json()


def test_success_saves_one_matching_record(client, fake_detector):
    """M2-detect-persist-01"""
    before = datetime.now(timezone.utc)
    response = post_image(client, png_bytes(80, 50), "image/png")
    after = datetime.now(timezone.utc)

    assert response.status_code == 200
    body = response.json()
    records = _history(client)
    assert len(records) == 1
    rec = records[0]
    assert rec["count"] == body["count"] == 2
    assert rec["average_confidence"] == pytest.approx(body["average_confidence"])
    assert rec["average_confidence"] == pytest.approx(0.75)
    assert rec["inference_time_ms"] == body["inference_time_ms"] == 12.5
    assert rec["timestamp"].endswith("Z")
    ts = datetime.fromisoformat(rec["timestamp"])
    slack = timedelta(seconds=1)
    assert before - slack <= ts <= after + slack


def test_each_call_adds_one_record_in_order(client, fake_detector):
    """M2-detect-persist-02"""
    for n in (1, 3, 0):
        fake_detector.detections = [{"bbox": [1, 1, 5, 5], "confidence": 0.8}] * n
        assert post_image(client, png_bytes(), "image/png").status_code == 200

    records = _history(client)

    assert [r["count"] for r in records] == [1, 3, 0]
    ids = [r["id"] for r in records]
    assert len(set(ids)) == 3 and ids == sorted(ids)
    stamps = [datetime.fromisoformat(r["timestamp"]) for r in records]
    assert stamps == sorted(stamps)


def test_no_people_still_saved(client, fake_detector):
    """M2-detect-persist-03"""
    fake_detector.detections = []

    assert post_image(client, png_bytes(), "image/png").status_code == 200

    records = _history(client)
    assert len(records) == 1
    assert records[0]["count"] == 0
    assert records[0]["average_confidence"] == 0.0


def test_annotated_request_saves_one_record(client, fake_detector):
    """M2-detect-persist-04"""
    response = post_image(client, png_bytes(), "image/png", params={"return_annotated": "true"})

    assert response.status_code == 200
    assert response.json()["annotated_image_base64"] is not None
    records = _history(client)
    assert len(records) == 1
    assert records[0]["count"] == 2


def _noisy_png() -> bytes:
    rng = np.random.default_rng(0)
    return encode(rng.integers(0, 256, (40, 40, 3), dtype=np.uint8), ".png")


@pytest.mark.parametrize(
    "send, expected_status",
    [
        (lambda c: c.post("/detect"), 400),
        (lambda c: post_image(c, b"", "image/jpeg"), 400),
        (lambda c: post_image(c, b"notanimage", "image/jpeg"), 400),
        (lambda c: post_image(c, b"hello", "text/plain", filename="a.txt"), 415),
        (lambda c: post_image(c, b"GIF89a" + bytes(50), "image/jpeg"), 415),
        (lambda c: post_image(c, _noisy_png(), "image/png"), 413),
        (lambda c: post_image(c, png_bytes(), "image/png", params={"return_annotated": "maybe"}), 400),
        (lambda c: post_image(c, png_bytes(), "image/png"), 500),
    ],
    ids=["no-file", "empty", "corrupt-jpeg", "text-plain", "gif", "too-large",
         "bad-return-annotated", "inference-error"],
)
def test_failed_requests_save_nothing(client, fake_detector, monkeypatch, send, expected_status):
    """M2-detect-persist-05"""
    monkeypatch.setattr(config, "MAX_UPLOAD_BYTES", 1000, raising=False)
    if expected_status == 500:
        fake_detector.error = RuntimeError("boom")

    response = send(client)

    assert response.status_code == expected_status
    assert_error_body(response)
    assert _history(client) == []


class _FailingStorage:
    def save(self, record):
        raise sqlite3.OperationalError("disk I/O error")


def test_failed_save_still_returns_result(client, fake_detector, caplog):
    """M2-detect-persist-06"""
    app.dependency_overrides[get_storage] = lambda: _FailingStorage()
    caplog.set_level(logging.ERROR, logger=DETECT_LOGGER)

    response = post_image(client, png_bytes(), "image/png")

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 2
    assert body["average_confidence"] == pytest.approx(0.75)
    assert body["inference_time_ms"] == 12.5
    errors = [
        r for r in caplog.records if r.name == DETECT_LOGGER and r.levelno == logging.ERROR
    ]
    assert errors, "expected an ERROR log from backend.routes.detect"
    assert any(r.exc_info for r in errors)


def test_unusable_db_file_does_not_break_detect(client, fake_detector, monkeypatch, tmp_path):
    """M2-detect-persist-07"""
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path))  # a directory

    response = post_image(client, png_bytes(), "image/png")

    assert response.status_code == 200
    assert response.json()["count"] == 2


def test_annotation_failure_is_500_and_saves_nothing(client, fake_detector, monkeypatch):
    """M2-detect-persist-08 [OQ-5]"""

    def broken_annotate(image, detections):
        raise RuntimeError("draw failed")

    monkeypatch.setattr(fake_detector, "annotate", broken_annotate)

    response = post_image(client, png_bytes(), "image/png", params={"return_annotated": "true"})

    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/json"), response.text
    assert_error_body(response)
    assert _history(client) == []

    plain = post_image(client, png_bytes(), "image/png")
    assert plain.status_code == 200
    assert len(_history(client)) == 1


def test_one_info_log_line_per_detection(client, fake_detector, caplog):
    """M2-detect-log-01"""
    caplog.set_level(logging.INFO, logger=DETECT_LOGGER)

    assert post_image(client, png_bytes(80, 50), "image/png").status_code == 200

    infos = [
        r for r in caplog.records if r.name == DETECT_LOGGER and r.levelno == logging.INFO
    ]
    assert len(infos) == 1
    message = infos[0].getMessage()
    for part in ("2", "0.75", "12.5", "80", "50"):
        assert part in message, message


def test_warmup_creates_no_record(fake_detector, monkeypatch):
    """M2-detect-log-02"""
    monkeypatch.setattr(config, "WARMUP_MODEL", True, raising=False)

    with TestClient(app) as client:
        assert fake_detector.detect_calls == 1
        assert _history(client) == []


def test_query_validation_error_is_400(client, fake_detector):
    """M2-valid-01"""
    response = post_image(client, png_bytes(), "image/png", params={"return_annotated": "maybe"})

    assert response.status_code == 400
    assert_error_body(response)
    assert "return_annotated" in response.json()["detail"]
    assert fake_detector.detect_calls == 0


@pytest.mark.integration
def test_real_detection_persisted_and_reset(client):
    """M2-int-01"""
    response = post_image(client, (ASSETS / "bus.jpg").read_bytes(), "image/jpeg", filename="bus.jpg")

    assert response.status_code == 200
    body = response.json()
    records = _history(client)
    assert len(records) == 1
    rec = records[0]
    assert rec["count"] == body["count"]
    assert rec["average_confidence"] == pytest.approx(body["average_confidence"])
    assert rec["inference_time_ms"] == pytest.approx(body["inference_time_ms"])

    reset = client.delete("/reset")
    assert reset.status_code == 200
    assert reset.json()["count_removed"] == 1
