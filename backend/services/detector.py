"""Loads the YOLO model once and exposes person-only detection.

Model is loaded lazily (on first request, not at import time) and cached as a
singleton via lru_cache, wired in as a FastAPI dependency in routes/detect.py.
This keeps startup fast and makes the detector easy to swap/mock in tests.
"""

import time
from functools import lru_cache

import cv2
import numpy as np
from ultralytics import YOLO

from backend import config

PERSON_CLASS_ID = 0  # COCO class 0 = "person"


class PersonDetector:
    def __init__(self, model_path: str, confidence_threshold: float):
        self.model = YOLO(model_path)
        self.confidence_threshold = confidence_threshold

    def detect(self, image: np.ndarray) -> tuple[list[dict], float]:
        start = time.perf_counter()
        results = self.model.predict(
            image,
            classes=[PERSON_CLASS_ID],
            conf=self.confidence_threshold,
            verbose=False,
        )[0]
        inference_time_ms = (time.perf_counter() - start) * 1000

        detections = [
            {"bbox": box.xyxy[0].tolist(), "confidence": float(box.conf[0])}
            for box in results.boxes
        ]
        return detections, inference_time_ms

    def annotate(self, image: np.ndarray, detections: list[dict]) -> np.ndarray:
        annotated = image.copy()
        for det in detections:
            x1, y1, x2, y2 = (int(v) for v in det["bbox"])
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 200, 0), 2)
            label = f"person {det['confidence']:.2f}"
            cv2.putText(
                annotated, label, (x1, max(y1 - 8, 0)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 200, 0), 1, cv2.LINE_AA,
            )
        return annotated


@lru_cache
def get_detector() -> PersonDetector:
    return PersonDetector(config.MODEL_PATH, config.CONFIDENCE_THRESHOLD)
