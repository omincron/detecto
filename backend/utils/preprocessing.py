"""Frame decode + preprocessing. Pure functions, no framework/IO dependencies
so they're easy to unit test in isolation from FastAPI or the model.
"""

import base64

import cv2
import numpy as np

MAX_DIMENSION = 1280


JPEG_MAGIC = b"\xff\xd8\xff"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
# Real image formats we recognize but don't accept (-> 415 rather than "corrupt" 400).
OTHER_IMAGE_MAGIC = {
    b"GIF87a": "GIF",
    b"GIF89a": "GIF",
    b"BM": "BMP",
    b"II*\x00": "TIFF",
    b"MM\x00*": "TIFF",
}


def sniff_image_format(file_bytes: bytes) -> str | None:
    """Identify the format from magic bytes: "JPEG", "PNG", another known image
    format name (e.g. "GIF"), or None if unrecognized.
    """
    if file_bytes.startswith(JPEG_MAGIC):
        return "JPEG"
    if file_bytes.startswith(PNG_MAGIC):
        return "PNG"
    if file_bytes[:4] == b"RIFF" and file_bytes[8:12] == b"WEBP":
        return "WEBP"
    for magic, name in OTHER_IMAGE_MAGIC.items():
        if file_bytes.startswith(magic):
            return name
    return None


def decode_image(file_bytes: bytes) -> np.ndarray:
    if not file_bytes:
        raise ValueError("Could not decode image — file is empty")
    array = np.frombuffer(file_bytes, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode image — unsupported or corrupt file")
    return image


def preprocess_image(image: np.ndarray) -> np.ndarray:
    """Resize large frames for consistent inference speed, and boost local
    contrast (CLAHE on the luminance channel) so low-light frames still yield
    usable detections. YOLO does its own internal letterboxing/normalization
    on the tensor it feeds the network — this step is about frame quality
    going in, not the model's input format.
    """
    height, width = image.shape[:2]
    scale = MAX_DIMENSION / max(height, width)
    if scale < 1:
        # Clamp to 1px so extreme aspect ratios (e.g. 4000x1) don't collapse to 0.
        new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
        image = cv2.resize(image, new_size)

    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_channel = clahe.apply(l_channel)
    return cv2.cvtColor(cv2.merge((l_channel, a_channel, b_channel)), cv2.COLOR_LAB2BGR)


def encode_image_base64(image: np.ndarray) -> str:
    success, buffer = cv2.imencode(".jpg", image)
    if not success:
        raise ValueError("Failed to encode image")
    return base64.b64encode(buffer).decode("utf-8")
