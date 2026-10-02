import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from backend import config
from backend.models.record import Detection, DetectionRecord, DetectionResponse
from backend.services.detector import PersonDetector, get_detector
from backend.services.storage import SQLiteStorage, get_storage
from backend.utils.preprocessing import (
    decode_image,
    encode_image_base64,
    preprocess_image,
    sniff_image_format,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Declared Content-Type is only a first filter; the magic bytes decide the real format.
ALLOWED_DECLARED_TYPES = {"image/jpeg", "image/jpg", "image/png", "application/octet-stream"}
SUPPORTED_FORMATS = {"JPEG", "PNG"}


@router.post("/detect", response_model=DetectionResponse)
async def detect_people(
    # Optional here so a missing file is our 400 with a string detail, not FastAPI's 422 list.
    image: UploadFile | None = File(None),
    return_annotated: bool = False,
    detector: PersonDetector = Depends(get_detector),
    storage: SQLiteStorage = Depends(get_storage),
):
    if image is None:
        raise HTTPException(
            status_code=400, detail="No image file provided (expected form field 'image')"
        )

    declared_type = (image.content_type or "").split(";")[0].strip().lower()
    if declared_type and declared_type not in ALLOWED_DECLARED_TYPES:
        raise HTTPException(
            status_code=415, detail=f"Unsupported file type: {image.content_type}"
        )

    max_bytes = config.MAX_UPLOAD_BYTES
    raw_bytes = await image.read(max_bytes + 1)
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(raw_bytes) > max_bytes:
        raise HTTPException(
            status_code=413, detail=f"File too large (max {max_bytes / (1024 * 1024):g} MB)"
        )

    image_format = sniff_image_format(raw_bytes)
    if image_format is not None and image_format not in SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image format: {image_format}. Only JPEG and PNG are accepted",
        )
    if image_format is None:
        raise HTTPException(
            status_code=400, detail="Could not decode image — unsupported or corrupt file"
        )

    try:
        decoded = decode_image(raw_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    processed = preprocess_image(decoded)
    height, width = processed.shape[:2]

    try:
        detections, inference_time_ms = detector.detect(processed)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc

    average_confidence = (
        sum(d["confidence"] for d in detections) / len(detections) if detections else 0.0
    )

    logger.info(
        "detect: count=%d avg_confidence=%.3f inference_ms=%.1f size=%dx%d",
        len(detections), average_confidence, inference_time_ms, width, height,
    )

    annotated_b64 = None
    if return_annotated:
        try:
            annotated = detector.annotate(processed, detections)
            annotated_b64 = encode_image_base64(annotated)
        except Exception as exc:
            raise HTTPException(
                status_code=500, detail=f"Annotation failed: {exc}"
            ) from exc

    # Saved only once the whole response is built, so any error above saves nothing.
    # A failed save shouldn't cost the user their detection result: log it and carry on.
    try:
        storage.save(
            DetectionRecord(
                timestamp=datetime.now(timezone.utc),
                count=len(detections),
                average_confidence=average_confidence,
                inference_time_ms=inference_time_ms,
            )
        )
    except Exception:
        logger.exception("Failed to save detection record")

    return DetectionResponse(
        count=len(detections),
        detections=[Detection(**d) for d in detections],
        average_confidence=average_confidence,
        inference_time_ms=inference_time_ms,
        image_width=width,
        image_height=height,
        annotated_image_base64=annotated_b64,
    )
