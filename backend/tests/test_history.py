"""GET /history and DELETE /reset (dataset S seeded directly into the temp DB)."""

from datetime import datetime
from pathlib import Path

import pytest

from backend import config
from backend.tests.helpers import assert_error_body, counts, png_bytes, post_image

ALL = [1, 2, 0, 4, 3]


# --- results and filters -------------------------------------------------------


def test_empty_store_returns_empty_list(client):
    """M2-hist-01"""
    assert not Path(config.DB_PATH).exists()

    response = client.get("/history")

    assert response.status_code == 200
    assert response.json() == []


def test_record_shape_and_types(client, dataset_s):
    """M2-hist-02"""
    response = client.get("/history")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 5
    seeded = {r.count: r for r in dataset_s.values()}
    for item in body:
        assert set(item) == {"id", "timestamp", "count", "average_confidence", "inference_time_ms"}
        assert isinstance(item["id"], int) and isinstance(item["count"], int)
        assert isinstance(item["average_confidence"], (int, float))
        assert isinstance(item["inference_time_ms"], (int, float))
        assert item["timestamp"].endswith("Z")
        assert datetime.fromisoformat(item["timestamp"]) == seeded[item["count"]].timestamp
    r2 = next(item for item in body if item["count"] == 2)
    assert r2["average_confidence"] == 0.8
    assert r2["inference_time_ms"] == 20.0


def test_oldest_first(client, dataset_s):
    """M2-hist-03"""
    response = client.get("/history")

    assert counts(response) == ALL
    stamps = [datetime.fromisoformat(r["timestamp"]) for r in response.json()]
    assert stamps == sorted(stamps)


def test_date_only_start_inclusive(client, dataset_s):
    """M2-hist-04"""
    assert counts(client.get("/history?start_date=2026-10-02")) == [2, 0, 4, 3]


def test_date_only_end_covers_whole_day(client, dataset_s):
    """M2-hist-05"""
    assert counts(client.get("/history?end_date=2026-10-02")) == [1, 2, 0, 4]


def test_same_day_start_and_end(client, dataset_s):
    """M2-hist-06"""
    response = client.get("/history?start_date=2026-10-02&end_date=2026-10-02")

    assert counts(response) == [2, 0, 4]


@pytest.mark.parametrize(
    "query, expected",
    [
        ("start_date=2026-10-02T12:00:00Z", [0, 4, 3]),
        ("end_date=2026-10-02T12:00:00Z", [1, 2]),
        ("end_date=2026-10-03T00:00:00Z", [1, 2, 0, 4]),
    ],
)
def test_datetime_bounds(client, dataset_s, query, expected):
    """M2-hist-07"""
    assert counts(client.get(f"/history?{query}")) == expected


@pytest.mark.parametrize("value", ["2026-10-02T12:00", "2026-10-02T12:00:00"])
def test_naive_datetime_is_utc(client, dataset_s, value):
    """M2-hist-08"""
    assert counts(client.get(f"/history?start_date={value}")) == [0, 4, 3]
    assert counts(client.get(f"/history?start_date={value}")) == counts(
        client.get("/history?start_date=2026-10-02T12:00Z")
    )


@pytest.mark.parametrize(
    "query, expected",
    [
        ("start_date=2026-10-02T14:00:00%2B02:00", [0, 4, 3]),
        ("end_date=2026-10-02T02:00%2B02:00", [1]),
        ("start_date=2026-10-02T07:00-05:00", [0, 4, 3]),
    ],
)
def test_offset_converted_to_utc(client, dataset_s, query, expected):
    """M2-hist-09"""
    assert counts(client.get(f"/history?{query}")) == expected


def test_time_window_within_day(client, dataset_s):
    """M2-hist-10"""
    response = client.get("/history?start_date=2026-10-02T06:00Z&end_date=2026-10-02T18:00Z")

    assert counts(response) == [0]


@pytest.mark.parametrize(
    "value, expected",
    [
        ("0", [1, 2, 0, 4, 3]),
        ("0.5", [1, 2, 0, 4, 3]),
        ("0.7", [2, 0, 4, 3]),
        ("0.71", [2, 0, 3]),
        ("1", [0, 3]),
    ],
)
def test_min_confidence(client, dataset_s, value, expected):
    """M2-hist-11 [OQ-4: zero-person records always kept]"""
    assert counts(client.get(f"/history?min_confidence={value}")) == expected


def test_filters_combine_with_and(client, dataset_s):
    """M2-hist-12 [OQ-4]"""
    response = client.get(
        "/history?start_date=2026-10-02&end_date=2026-10-02&min_confidence=0.75"
    )

    assert counts(response) == [2, 0]


@pytest.mark.parametrize("query", ["start_date=2027-01-01", "end_date=2026-01-01"])
def test_no_match_returns_empty(client, dataset_s, query):
    """M2-hist-13"""
    response = client.get(f"/history?{query}")

    assert response.status_code == 200
    assert response.json() == []


def test_history_is_read_only(client, dataset_s):
    """M2-hist-14"""
    client.get("/history?min_confidence=0.9")
    response = client.get("/history")

    assert response.status_code == 200
    assert sorted(r["id"] for r in response.json()) == sorted(r.id for r in dataset_s.values())


# --- errors --------------------------------------------------------------------

BAD_DATES = ["not-a-date", "2026-13-01", "2026-02-30", "2026-10-02T25:00", "02/10/2026", "2026-10"]


@pytest.mark.parametrize("param", ["start_date", "end_date"])
@pytest.mark.parametrize("value", BAD_DATES)
def test_unparseable_date_rejected(client, dataset_s, param, value):
    """M2-hist-err-01"""
    response = client.get("/history", params={param: value})

    assert response.status_code == 400
    assert_error_body(response)
    assert param in response.json()["detail"]


@pytest.mark.parametrize(
    "query",
    [
        "start_date=2026-10-03&end_date=2026-10-02",
        "start_date=2026-10-02T12:00Z&end_date=2026-10-02T12:00Z",
        "start_date=2026-10-02T12:00Z&end_date=2026-10-02T11:59Z",
        "start_date=2026-10-02T14:00%2B02:00&end_date=2026-10-02T12:00Z",
    ],
    ids=["reversed-days", "equal", "end-before-start", "equal-after-offset"],
)
def test_start_not_before_end_rejected(client, dataset_s, query):
    """M2-hist-err-02"""
    response = client.get(f"/history?{query}")

    assert response.status_code == 400
    assert_error_body(response)


@pytest.mark.parametrize("value", ["abc", "0.5.5"])
def test_non_numeric_min_confidence_rejected(client, value):
    """M2-hist-err-03 / M2-valid-02"""
    response = client.get("/history", params={"min_confidence": value})

    assert response.status_code == 400
    assert_error_body(response)
    assert "min_confidence" in response.json()["detail"]


@pytest.mark.parametrize("value", ["-0.01", "1.01", "2", "nan", "inf"])
def test_min_confidence_out_of_range_rejected(client, value):
    """M2-hist-err-04"""
    response = client.get("/history", params={"min_confidence": value})

    assert response.status_code == 400
    assert_error_body(response)


@pytest.mark.parametrize(
    "query",
    ["start_date=", "end_date=", "min_confidence=", "start_date=&end_date=&min_confidence="],
    ids=["start_date", "end_date", "min_confidence", "all-three"],
)
def test_empty_values_treated_as_absent(client, dataset_s, query):
    """M2-hist-err-05 [OQ-1]"""
    assert counts(client.get(f"/history?{query}")) == ALL


@pytest.mark.parametrize(
    "query", ["end_date=9999-12-31", "start_date=0999-01-01"], ids=["max-end", "year-999"]
)
def test_extreme_valid_dates_filter_correctly(client, dataset_s, query):
    """M2-hist-err-06 [OQ-2]"""
    response = client.get(f"/history?{query}")

    assert response.status_code != 500
    assert counts(response) == ALL


def test_unrepresentable_utc_date_rejected(client, dataset_s):
    """M2-hist-err-06 [OQ-2]"""
    response = client.get("/history?start_date=0001-01-01T00:00%2B01:00")

    assert response.status_code != 500
    assert response.status_code == 400
    assert_error_body(response)


# --- DELETE /reset -------------------------------------------------------------


def test_reset_clears_all(client, dataset_s):
    """M2-reset-01"""
    response = client.delete("/reset")

    assert response.status_code == 200
    assert response.json() == {"status": "cleared", "count_removed": 5}
    assert client.get("/history").json() == []


def test_reset_empty_store_is_idempotent(client):
    """M2-reset-02"""
    for _ in range(2):
        response = client.delete("/reset")
        assert response.status_code == 200
        assert response.json() == {"status": "cleared", "count_removed": 0}


def test_reset_then_detect_does_not_reuse_ids(client, fake_detector):
    """M2-reset-03"""
    for _ in range(2):
        assert post_image(client, png_bytes(), "image/png").status_code == 200
    old_ids = [r["id"] for r in client.get("/history").json()]

    reset = client.delete("/reset")
    assert reset.json()["count_removed"] == 2
    assert post_image(client, png_bytes(), "image/png").status_code == 200

    body = client.get("/history").json()
    assert len(body) == 1
    assert body[0]["id"] > max(old_ids)


def test_reset_is_delete_only(client, dataset_s):
    """M2-reset-04"""
    assert client.get("/reset").status_code == 405
    assert client.post("/reset").status_code == 405
    assert len(client.get("/history").json()) == 5
