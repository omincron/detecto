"""Shared fixtures: app client, fake detector, per-test DB path."""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.main import app
from backend.services.detector import get_detector

DEFAULT_DETECTIONS = [
    {"bbox": [1, 2, 30, 40], "confidence": 0.9},
    {"bbox": [5, 5, 20, 20], "confidence": 0.6},
]


class FakeDetector:
    """Stands in for PersonDetector. Records what it was given."""

    def __init__(self, detections=None, inference_time_ms=12.5, error=None):
        self.detections = list(DEFAULT_DETECTIONS if detections is None else detections)
        self.inference_time_ms = inference_time_ms
        self.error = error
        self.received = []  # arrays passed to detect()
        self.annotate_calls = []  # (image, detections) passed to annotate()

    @property
    def detect_calls(self) -> int:
        return len(self.received)

    def detect(self, image: np.ndarray):
        self.received.append(image)
        if self.error is not None:
            raise self.error
        return list(self.detections), self.inference_time_ms

    def annotate(self, image: np.ndarray, detections: list[dict]) -> np.ndarray:
        self.annotate_calls.append((image, detections))
        return image.copy()


@pytest.fixture(autouse=True)
def isolated_config(tmp_path, monkeypatch):
    """Warm-up off and a throwaway DB path for every test; clear overrides after."""
    monkeypatch.setattr(config, "WARMUP_MODEL", False, raising=False)
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "test.db"))
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def fake_detector():
    """Installs a FakeDetector via dependency_overrides and returns it."""
    fake = FakeDetector()
    app.dependency_overrides[get_detector] = lambda: fake
    return fake


@pytest.fixture
def client():
    """TestClient with lifespan run; server errors come back as 500 responses."""
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c

