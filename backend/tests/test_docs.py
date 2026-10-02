"""Model default (yolov8s.pt) in config, .env and the docs."""

import importlib
import re
from pathlib import Path

import dotenv

from backend import config

ROOT = Path(config.PROJECT_ROOT)


def test_config_default_model_is_yolov8s(env):
    """M5-cfg-01"""
    env.setattr(dotenv, "load_dotenv", lambda *a, **k: False)
    env.delenv("MODEL_PATH", raising=False)
    env.delenv("CONFIDENCE_THRESHOLD", raising=False)
    importlib.reload(config)

    assert config.MODEL_PATH == "yolov8s.pt"
    assert config.CONFIDENCE_THRESHOLD == 0.5


def test_shipped_env_selects_yolov8s():
    """M5-cfg-02"""
    values = dotenv.dotenv_values(ROOT / ".env")

    assert values["MODEL_PATH"] == "yolov8s.pt"
    assert values["CONFIDENCE_THRESHOLD"] == "0.5"


def architecture_env_block():
    text = (ROOT / "ARCHITECTURE.md").read_text()
    match = re.search(r"^### 3\.5[^\n]*\n+```[^\n]*\n(.*?)```", text, re.S | re.M)
    assert match, "no fenced block under ### 3.5"
    values = {}
    for line in match.group(1).splitlines():
        line = line.split("#", 1)[0].strip()
        if "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def test_architecture_env_sample_matches_shipped_env():
    """M5-cfg-03 [OQ-4]"""
    sample = architecture_env_block()
    shipped = dotenv.dotenv_values(ROOT / ".env")

    assert sample["MODEL_PATH"] == "yolov8s.pt"
    for key in ("MODEL_PATH", "CONFIDENCE_THRESHOLD", "DB_PATH", "CORS_ORIGINS"):
        assert sample[key] == shipped[key], key


def section_lines(lines, start_pattern, end_pattern):
    """Indexes of lines from the first match of start_pattern up to end_pattern."""
    inside, picked = False, set()
    for i, line in enumerate(lines):
        if re.match(start_pattern, line):
            inside = True
        elif inside and re.match(end_pattern, line):
            inside = False
        if inside:
            picked.add(i)
    return picked


def test_no_current_state_doc_names_yolov8n():
    """M5-cfg-04 [OQ-4]"""
    files = ["ARCHITECTURE.md", "pytest.ini", "backend/scripts/evaluate.py",
             "backend/tests/test_integration.py", "README.md"]
    stale = []
    for name in files:
        lines = (ROOT / name).read_text().splitlines()
        allowed = set()
        if name == "README.md":
            allowed = section_lines(lines, r"^### Model and threshold comparison", r"^##? ")
            allowed |= {i for i, line in enumerate(lines)
                        if line.startswith("| `MODEL_PATH`") and "`yolov8n.pt` is faster" in line}
        elif name == "ARCHITECTURE.md":
            allowed = section_lines(lines, r"^## 7\.", r"^## ")
        for i, line in enumerate(lines):
            if re.search("yolov8n", line, re.I) and i not in allowed:
                stale.append(f"{name}:{i + 1}: {line.strip()}")

    assert stale == []
