"""evaluate.run() on the real model (config defaults: yolov8s.pt @ 0.5) over backend/samples."""

import json
from pathlib import Path

import pytest

from backend import config
from backend.main import app
from backend.scripts import evaluate
from backend.services.detector import get_detector
from backend.tests.conftest import REAL_DB
from backend.tests.helpers import post_image

pytestmark = pytest.mark.integration

SAMPLES = Path(config.PROJECT_ROOT) / "backend" / "samples"
COUNT_KEYS = ("visible", "detected", "correct", "missed", "false_positives", "ignored_small")


def _real_db_snapshot():
    if not REAL_DB.exists():
        return None
    stat = REAL_DB.stat()
    return (stat.st_size, stat.st_mtime_ns)


@pytest.fixture(scope="module")
def evaluation():
    """One real run(1); config globals restored and the detector cache cleared around it."""
    saved = {k: getattr(config, k) for k in
             ("DB_PATH", "WARMUP_MODEL", "CONFIDENCE_THRESHOLD", "MODEL_PATH")}
    app.dependency_overrides.clear()
    get_detector.cache_clear()
    before = _real_db_snapshot()
    try:
        summary, results = evaluate.run(1)
    finally:
        for key, value in saved.items():
            setattr(config, key, value)
        get_detector.cache_clear()
    return summary, results, before, _real_db_snapshot()


def test_real_evaluation_reproduces_results_json(evaluation):
    """M5-int-01"""
    summary, results, db_before, db_after = evaluation
    official = json.loads((SAMPLES / "results.json").read_text())["images"]

    assert summary["reliability_pct"] == 100.0
    assert all(r["status"] == 200 for r in results)
    assert summary["model"] == "yolov8s.pt"
    assert [r["file"] for r in results] == [r["file"] for r in official]
    for got, want in zip(results, official):
        assert {k: got[k] for k in COUNT_KEYS} == {k: want[k] for k in COUNT_KEYS}, got["file"]
    assert db_after == db_before


def test_real_evaluation_meets_brief_targets(evaluation):
    """M5-int-02 [OQ-7] Regression guard, not proof of accuracy.

    This set is only 16 images (69 people), and the model/threshold were picked by
    comparing on this same set. A pass means "no regression since the official run",
    not "the model meets 85 % in general". Accuracy clears the target by one person
    (59/69 = 85.5 %; 58/69 = 84.1 %).
    """
    summary = evaluation[0]

    assert summary["detection_accuracy_pct"] >= 85.0
    assert summary["false_positive_pct"] <= 10.0
    assert summary["avg_inference_ms"] <= 1500
    assert summary["avg_confidence"] >= 0.7
    assert summary["reliability_pct"] == 100.0


@pytest.fixture
def real_model():
    get_detector.cache_clear()
    yield
    get_detector.cache_clear()


def _detect(client, file):
    data = (SAMPLES / file).read_bytes()
    response = post_image(client, data, "image/jpeg", filename=file)
    assert response.status_code == 200, response.text
    return response.json()


def test_real_lookalikes_and_near_miss(real_model, client):
    """M5-int-03"""
    assert config.MODEL_PATH == "yolov8s.pt"
    truth = {e["file"]: e for e in json.loads((SAMPLES / "ground_truth.json").read_text())["images"]}

    statue = _detect(client, "coco-23751.jpg")
    assert statue["count"] == 1
    assert round(statue["detections"][0]["confidence"], 2) == 0.79

    doll = _detect(client, "coco-180296.jpg")
    assert doll["count"] == 1
    assert round(doll["detections"][0]["confidence"], 2) == 0.55

    boy = _detect(client, "coco-96493.jpg")
    assert (boy["image_width"], boy["image_height"]) == (426, 640)  # scale 1
    (x, y, w, h), = truth["coco-96493.jpg"]["persons_xywh"]
    overlaps = [evaluate.iou(d["bbox"], [x, y, x + w, y + h]) for d in boy["detections"]]
    assert overlaps
    assert 0.40 <= max(overlaps) < 0.50
