"""Startup warm-up in the main.py lifespan."""

import numpy as np
from fastapi.testclient import TestClient

from backend import config
from backend.main import app
from backend.tests.helpers import png_bytes, post_image


def test_warmup_runs_one_inference_at_startup(fake_detector, monkeypatch):
    """M1-startup-01"""
    monkeypatch.setattr(config, "WARMUP_MODEL", True, raising=False)

    with TestClient(app) as client:
        assert fake_detector.detect_calls == 1
        warmup_frame = fake_detector.received[0]
        assert warmup_frame.ndim == 3 and warmup_frame.shape[2] == 3
        assert warmup_frame.dtype == np.uint8

        response = post_image(client, png_bytes(), "image/png")
        assert response.status_code == 200
        assert fake_detector.detect_calls == 2


def test_no_warmup_when_disabled(fake_detector, monkeypatch):
    """M1-startup-02"""
    monkeypatch.setattr(config, "WARMUP_MODEL", False, raising=False)

    with TestClient(app) as client:
        assert fake_detector.detect_calls == 0
        assert client.get("/health").status_code == 200
