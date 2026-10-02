from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.main import app
from backend.services.detector import get_detector


def test_health_ok_without_loading_model():
    """M1-health-01"""
    get_detector.cache_clear()
    with patch(
        "backend.services.detector.YOLO", side_effect=AssertionError("model loaded")
    ) as yolo:
        with TestClient(app) as client:
            response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    yolo.assert_not_called()
