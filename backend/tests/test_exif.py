"""M3: frame size for EXIF-rotated uploads matches what the browser displays."""

import io

from PIL import Image

from backend.tests.helpers import post_image


def exif_rotated_jpeg(width: int, height: int, orientation: int) -> bytes:
    image = Image.new("RGB", (width, height), (120, 60, 30))
    exif = Image.Exif()
    exif[0x0112] = orientation  # Orientation tag
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", exif=exif.tobytes())
    return buffer.getvalue()


def test_exif_orientation_applied_to_frame_size(client, fake_detector):
    """M3-exif-01"""
    data = exif_rotated_jpeg(40, 20, orientation=6)

    response = post_image(client, data, "image/jpeg", filename="phone.jpg")

    assert response.status_code == 200
    body = response.json()
    assert body["image_width"] == 20
    assert body["image_height"] == 40
    assert fake_detector.received[0].shape == (40, 20, 3)
