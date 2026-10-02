"""Response schemas for the /detect endpoint (Pydantic).

The history record schema (what gets persisted to SQLite) is added in the
storage milestone, alongside services/storage.py.
"""

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
