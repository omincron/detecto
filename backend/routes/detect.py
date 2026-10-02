from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from backend.models.record import Detection, DetectionResponse
from backend.services.detector import PersonDetector, get_detector
from backend.utils.preprocessing import decode_image, encode_image_base64, preprocess_image

router = APIRouter()

SUPPORTED_CONTENT_TYPES = {"image/jpeg", "image/png"}


@router.post("/detect", response_model=DetectionResponse)
async def detect_people(
    image: UploadFile = File(...),
    return_annotated: bool = False,
    detector: PersonDetector = Depends(get_detector),
):
    if image.content_type not in SUPPORTED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415, detail=f"Unsupported file type: {image.content_type}"
        )

    raw_bytes = await image.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

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

    annotated_b64 = None
    if return_annotated:
        annotated = detector.annotate(processed, detections)
        annotated_b64 = encode_image_base64(annotated)

    return DetectionResponse(
        count=len(detections),
        detections=[Detection(**d) for d in detections],
        average_confidence=average_confidence,
        inference_time_ms=inference_time_ms,
        image_width=width,
        image_height=height,
        annotated_image_base64=annotated_b64,
    )
