"""/history with the exact instant format the frontend sends (Date.toISOString())."""

from backend.models.record import DetectionRecord
from backend.tests.helpers import utc


def test_millisecond_z_instants_start_inclusive_end_exclusive(client, storage):
    """M4-be-01"""
    stamps = [
        utc(2026, 10, 1, 20, 59, 59, 999000),
        utc(2026, 10, 1, 21, 0, 0),
        utc(2026, 10, 2, 20, 59, 59, 999000),
        utc(2026, 10, 2, 21, 0, 0),
    ]
    saved = [
        storage.save(
            DetectionRecord(timestamp=ts, count=i, average_confidence=0.5, inference_time_ms=10.0)
        )
        for i, ts in enumerate(stamps, start=1)
    ]

    response = client.get(
        "/history?start_date=2026-10-01T21:00:00.000Z&end_date=2026-10-02T21:00:00.000Z"
    )

    assert response.status_code == 200
    assert [r["id"] for r in response.json()] == [saved[1].id, saved[2].id]

    response = client.get(
        "/history?start_date=2026-10-02T05:00:00.000Z&end_date=2026-10-02T05:00:00.000Z"
    )

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)
