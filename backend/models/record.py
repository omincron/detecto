"""Schemas for the /detect response and the persisted detection record.

`DetectionRecord` and `CREATE_DETECTIONS_TABLE` describe the same record (one row per
successful /detect call); keep them in sync. Bounding boxes are deliberately not
persisted — history is a trend view, not a replay log (ARCHITECTURE.md §3.4).
"""

from datetime import datetime

from pydantic import BaseModel


class Detection(BaseModel):
    bbox: list[float]  # [x1, y1, x2, y2] in pixels, relative to image_width/image_height
    confidence: float


class DetectionResponse(BaseModel):
    count: int
    detections: list[Detection]
    average_confidence: float
    inference_time_ms: float
    image_width: int
    image_height: int
    annotated_image_base64: str | None = None


class DetectionRecord(BaseModel):
    id: int | None = None  # assigned by storage on save
    timestamp: datetime  # timezone-aware, UTC
    count: int
    average_confidence: float
    inference_time_ms: float


class ResetResponse(BaseModel):
    status: str
    count_removed: int


CREATE_DETECTIONS_TABLE = """
CREATE TABLE IF NOT EXISTS detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    person_count INTEGER NOT NULL,
    average_confidence REAL NOT NULL,
    inference_time_ms REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_detections_timestamp ON detections (timestamp);
"""
