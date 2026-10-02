"""Live probe of the running backend on :8000 (skipped when nothing is listening)."""

import json
import urllib.error
import urllib.request

import pytest

LIVE_URL = "http://localhost:8000/health"
FRONTEND_ORIGIN = "http://localhost:5173"


@pytest.mark.integration
def test_running_backend_answers_health_cross_origin():
    """M3b-e2e-01"""
    request = urllib.request.Request(LIVE_URL, headers={"Origin": FRONTEND_ORIGIN})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            status = response.status
            body = json.loads(response.read())
            allow_origin = response.headers.get("access-control-allow-origin")
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, ConnectionRefusedError):
            pytest.skip("no backend listening on :8000")
        raise

    assert status == 200
    assert body == {"status": "ok"}
    assert allow_origin == FRONTEND_ORIGIN
