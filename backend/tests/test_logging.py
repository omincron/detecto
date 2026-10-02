"""M3: the `backend` logger's own handler, so detection INFO lines show under uvicorn."""

import io
import logging
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx2
import pytest
from ultralytics.utils import ASSETS

import backend.main  # noqa: F401  (importing the app installs the handler)
from backend import config
from backend.tests.conftest import REAL_DB
from backend.tests.helpers import png_bytes, post_image

ROOT = Path(config.PROJECT_ROOT)
# 1280x720; frontend/public/samples/zidane.jpg was removed in M5 (unlicensed samples).
ZIDANE = ASSETS / "zidane.jpg"


def stream_handlers(logger):
    return [h for h in logger.handlers if isinstance(h, logging.StreamHandler)]


def test_backend_logger_has_info_stream_handler():
    """M3-log-01"""
    logger = logging.getLogger("backend")

    assert stream_handlers(logger)
    assert logger.level == logging.INFO
    assert logging.getLogger("backend.routes.detect").isEnabledFor(logging.INFO)


def test_detection_info_line_reaches_handler(client, fake_detector):
    """M3-log-02"""
    handler = stream_handlers(logging.getLogger("backend"))[0]
    buffer = io.StringIO()
    old = handler.setStream(buffer)
    try:
        response = post_image(client, png_bytes(80, 50), "image/png")
        assert response.status_code == 200

        lines = [
            line
            for line in buffer.getvalue().splitlines()
            if "INFO" in line
            and "backend.routes.detect" in line
            and "count=2" in line
            and "inference_ms=12.5" in line
            and "size=80x50" in line
        ]
        assert len(lines) == 1, buffer.getvalue()

        rejected = post_image(client, b"hello", "text/plain", filename="a.txt")
        assert rejected.status_code == 415
        assert buffer.getvalue().count("detect: count=") == 1, buffer.getvalue()
    finally:
        handler.setStream(old)


def test_reload_does_not_duplicate_handlers():
    """M3-log-03"""
    code = (
        "import importlib, logging, backend.main as m; importlib.reload(m); "
        "print(len(logging.getLogger('backend').handlers))"
    )
    result = subprocess.run(
        [sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, timeout=120
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "1"


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.mark.integration
def test_uvicorn_prints_detection_info_line(tmp_path):
    """M3-log-04"""
    port = free_port()
    assert port != 8000
    real_db_mtime = REAL_DB.stat().st_mtime_ns if REAL_DB.exists() else None
    env = {**os.environ, "DB_PATH": str(tmp_path / "i.db"), "WARMUP_MODEL": "false"}
    log_path = tmp_path / "server.log"
    base = f"http://127.0.0.1:{port}"

    with open(log_path, "w") as log:
        server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "backend.main:app", "--port", str(port)],
            cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 60
            while True:
                assert server.poll() is None, log_path.read_text()
                try:
                    if httpx2.get(f"{base}/health", timeout=2).status_code == 200:
                        break
                except httpx2.HTTPError:
                    pass
                assert time.monotonic() < deadline, "server did not start within 60 s"
                time.sleep(0.5)

            response = httpx2.post(
                f"{base}/detect",
                files={"image": ("zidane.jpg", ZIDANE.read_bytes(), "image/jpeg")},
                timeout=60,
            )
            assert response.status_code == 200, response.text
        finally:
            server.terminate()
            try:
                server.wait(timeout=15)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()

    output = log_path.read_text()
    assert re.search(
        r"INFO:\s+backend\.routes\.detect - detect: count=\d+ .* size=1280x720", output
    ), output
    assert (REAL_DB.stat().st_mtime_ns if REAL_DB.exists() else None) == real_db_mtime
