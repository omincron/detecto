"""Frame decode + preprocessing. Pure functions, no framework/IO dependencies
so they're easy to unit test in isolation from FastAPI or the model.
"""

import base64

import cv2
import numpy as np

MAX_DIMENSION = 1280


def decode_image(file_bytes: bytes) -> np.ndarray:
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
        image = cv2.resize(image, (int(width * scale), int(height * scale)))

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
