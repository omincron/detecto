"""services/storage.py against a temp SQLite file."""

import sqlite3
from contextlib import closing
from datetime import datetime, timedelta

import pytest

from backend.models.record import DetectionRecord
from backend.services.storage import HistoryFilters, SQLiteStorage
from backend.tests.helpers import utc


def _record(ts, count=1, avg=0.5, ms=10.0):
    return DetectionRecord(timestamp=ts, count=count, average_confidence=avg, inference_time_ms=ms)


def test_table_created_on_first_use(tmp_path):
    """M2-storage-01"""
    path = tmp_path / "a" / "b" / "h.db"
    store = SQLiteStorage(str(path))

    assert store.list() == []
    assert path.exists()
    with closing(sqlite3.connect(path)) as conn:
        columns = {
            row[1]: (row[2], bool(row[3]), row[5])
            for row in conn.execute("PRAGMA table_info(detections)")
        }
        sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='detections'"
        ).fetchone()[0]
    assert set(columns) == {
        "id", "timestamp", "person_count", "average_confidence", "inference_time_ms"
    }
    assert columns["id"][0] == "INTEGER" and columns["id"][2] == 1
    assert columns["timestamp"] == ("TEXT", True, 0)
    assert columns["person_count"] == ("INTEGER", True, 0)
    assert columns["average_confidence"] == ("REAL", True, 0)
    assert columns["inference_time_ms"] == ("REAL", True, 0)
    assert "AUTOINCREMENT" in sql.upper()


def test_save_assigns_increasing_ids(storage):
    """M2-storage-02"""
    first_in = _record(utc(2026, 10, 2, 12), count=2, avg=0.8, ms=20.0)
    second_in = _record(utc(2026, 10, 2, 13), count=0, avg=0.0, ms=30.0)

    first = storage.save(first_in)
    second = storage.save(second_in)

    assert isinstance(first.id, int) and isinstance(second.id, int)
    assert second.id > first.id
    for saved, original in [(first, first_in), (second, second_in)]:
        assert saved.timestamp == original.timestamp
        assert saved.count == original.count
        assert saved.average_confidence == original.average_confidence
        assert saved.inference_time_ms == original.inference_time_ms


def test_timestamps_round_trip_as_utc(storage):
    """M2-storage-03"""
    storage.save(_record(datetime.fromisoformat("2026-10-02T12:00:00.123456+00:00")))
    storage.save(_record(datetime(2026, 10, 2, 13, 0, 0)))  # naive -> UTC
    storage.save(_record(datetime.fromisoformat("2026-10-02T16:00:00+02:00")))

    timestamps = [r.timestamp for r in storage.list()]

    assert timestamps == [
        utc(2026, 10, 2, 12, 0, 0, 123456),
        utc(2026, 10, 2, 13, 0, 0),
        utc(2026, 10, 2, 14, 0, 0),
    ]
    assert all(t.utcoffset() == timedelta(0) for t in timestamps)


def test_list_oldest_first(storage, dataset_s):
    """M2-storage-04"""
    assert [r.count for r in storage.list()] == [1, 2, 0, 4, 3]


@pytest.mark.parametrize(
    "filters, expected",
    [
        (HistoryFilters(start=utc(2026, 10, 2)), [2, 0, 4, 3]),
        (HistoryFilters(end=utc(2026, 10, 3)), [1, 2, 0, 4]),
        (HistoryFilters(min_confidence=0.7), [2, 0, 4, 3]),
        (
            HistoryFilters(start=utc(2026, 10, 2), end=utc(2026, 10, 3), min_confidence=0.75),
            [2, 0],
        ),
    ],
    ids=["start", "end", "min_confidence", "combined"],
)
def test_filters(storage, dataset_s, filters, expected):
    """M2-storage-05 (min_confidence keeps zero-person records: OQ-4)"""
    assert [r.count for r in storage.list(filters)] == expected


def test_clear_returns_removed_count(storage, dataset_s):
    """M2-storage-06"""
    assert storage.clear() == 5
    assert storage.list() == []
    assert storage.clear() == 0


def test_data_persists_across_instances(tmp_path):
    """M2-storage-07"""
    path = str(tmp_path / "persist.db")
    first = SQLiteStorage(path)
    saved = [
        first.save(_record(utc(2026, 10, 2, 10), count=1)),
        first.save(_record(utc(2026, 10, 2, 11), count=2)),
    ]

    reloaded = SQLiteStorage(path).list()

    assert [(r.id, r.count, r.timestamp) for r in reloaded] == [
        (r.id, r.count, r.timestamp) for r in saved
    ]

