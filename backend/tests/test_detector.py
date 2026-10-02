"""services/detector.py with YOLO mocked out."""

from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest

from backend import config
from backend.services.detector import PersonDetector, get_detector


def _box():
    return SimpleNamespace(xyxy=np.array([[10.0, 20.0, 30.0, 40.0]]), conf=np.array([0.8]))


@pytest.fixture
def yolo():
    with patch("backend.services.detector.YOLO") as mock_cls:
        yield mock_cls


def test_detect_filters_person_class_at_threshold(yolo):
    """M1-detector-01"""
    yolo.return_value.predict.return_value = [SimpleNamespace(boxes=[_box(), _box()])]
    detector = PersonDetector("x.pt", 0.42)

    detections, elapsed = detector.detect(np.zeros((10, 10, 3), np.uint8))

    yolo.return_value.predict.assert_called_once()
    kwargs = yolo.return_value.predict.call_args.kwargs
    assert kwargs["classes"] == [0]
    assert kwargs["conf"] == 0.42
    assert detections == [{"bbox": [10, 20, 30, 40], "confidence": 0.8}] * 2
    assert all(type(d["confidence"]) is float for d in detections)
    assert isinstance(elapsed, float) and elapsed >= 0


def test_detect_empty_when_nothing_found(yolo):
    """M1-detector-02"""
    yolo.return_value.predict.return_value = [SimpleNamespace(boxes=[])]
    detector = PersonDetector("x.pt", 0.5)

    detections, elapsed = detector.detect(np.zeros((10, 10, 3), np.uint8))

    assert detections == []
    assert elapsed >= 0


def test_annotate_draws_on_copy(yolo):
    """M1-detector-03"""
    detector = PersonDetector("x.pt", 0.5)
    image = np.zeros((100, 100, 3), np.uint8)

    out = detector.annotate(image, [{"bbox": [10, 20, 60, 80], "confidence": 0.9}])

    assert out.shape == (100, 100, 3)
    assert not np.array_equal(out, image)
    assert not image.any()
    assert np.array_equal(detector.annotate(image, []), image)


def test_get_detector_is_cached_and_uses_config(yolo, monkeypatch):
    """M1-detector-04"""
    monkeypatch.setattr(config, "MODEL_PATH", "m.pt")
    monkeypatch.setattr(config, "CONFIDENCE_THRESHOLD", 0.33)
    get_detector.cache_clear()
    try:
        first = get_detector()
        second = get_detector()

        assert first is second
        yolo.assert_called_once_with("m.pt")
        assert first.confidence_threshold == 0.33
    finally:
        get_detector.cache_clear()
