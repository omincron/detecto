"""Central config loaded from the project-root .env (or real env vars)."""

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent

load_dotenv(PROJECT_ROOT / ".env")


def _from_root(path: str) -> str:
    """Relative paths are resolved against the project root, not the CWD, so the
    server finds the same DB no matter which directory it's started from."""
    resolved = Path(path)
    return str(resolved if resolved.is_absolute() else PROJECT_ROOT / resolved)


MODEL_PATH = os.getenv("MODEL_PATH", "yolov8n.pt")
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.5"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
DB_PATH = _from_root(os.getenv("DB_PATH", "backend/detecto.db"))
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
# Run one dummy inference at startup so the first real request isn't paying for warm-up.
WARMUP_MODEL = os.getenv("WARMUP_MODEL", "true").strip().lower() not in {"0", "false", "no", "off"}
