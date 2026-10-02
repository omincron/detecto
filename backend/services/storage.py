"""All persistence for detection history (SQLite).

Routes talk to the small interface below — save / list / clear — so the backend can
be swapped (e.g. Postgres) without touching the HTTP layer. Opens a short-lived
connection per call: FastAPI runs sync work in a threadpool and sqlite3 connections
can't be shared across threads, and at this scale the open cost is negligible.

Timestamps are stored as fixed-width UTC strings ("2026-10-02T12:00:00.123456Z"), so
lexicographic order is chronological order and range filters can compare strings.
(isoformat, not strftime("%Y"): the latter doesn't zero-pad years < 1000 on Linux,
which would break the fixed width.)
"""

import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from backend import config
from backend.models.record import CREATE_DETECTIONS_TABLE, DetectionRecord

def to_db_timestamp(value: datetime) -> str:
    """Aware datetime -> stored UTC string. Naive datetimes are taken as UTC.
    Raises OverflowError if the value can't be represented in UTC."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    utc = value.astimezone(timezone.utc).replace(tzinfo=None)
    return utc.isoformat(timespec="microseconds") + "Z"


def from_db_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.removesuffix("Z")).replace(tzinfo=timezone.utc)


@dataclass
class HistoryFilters:
    start: datetime | None = None  # inclusive
    end: datetime | None = None  # exclusive
    # On the record's average_confidence, inclusive. Zero-person records are always
    # kept, so a people-over-time chart doesn't lose its "nobody present" points.
    min_confidence: float | None = None


class SQLiteStorage:
    def __init__(self, db_path: str):
        # No I/O here: constructing is free and can't fail, so a broken DB only
        # surfaces in the call that actually touches it.
        self.db_path = db_path

    def _connect(self) -> sqlite3.Connection:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.executescript(CREATE_DETECTIONS_TABLE)  # idempotent
        return conn

    def save(self, record: DetectionRecord) -> DetectionRecord:
        with closing(self._connect()) as conn, conn:
            cursor = conn.execute(
                "INSERT INTO detections"
                " (timestamp, person_count, average_confidence, inference_time_ms)"
                " VALUES (?, ?, ?, ?)",
                (
                    to_db_timestamp(record.timestamp),
                    record.count,
                    record.average_confidence,
                    record.inference_time_ms,
                ),
            )
        return record.model_copy(update={"id": cursor.lastrowid})

    def list(self, filters: HistoryFilters | None = None) -> list[DetectionRecord]:
        """Matching records, oldest first."""
        filters = filters or HistoryFilters()
        clauses, params = [], []
        if filters.start is not None:
            clauses.append("timestamp >= ?")
            params.append(to_db_timestamp(filters.start))
        if filters.end is not None:
            clauses.append("timestamp < ?")
            params.append(to_db_timestamp(filters.end))
        if filters.min_confidence is not None:
            clauses.append("(person_count = 0 OR average_confidence >= ?)")
            params.append(filters.min_confidence)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""

        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT id, timestamp, person_count, average_confidence, inference_time_ms"
                f" FROM detections{where} ORDER BY timestamp, id",
                params,
            ).fetchall()
        return [
            DetectionRecord(
                id=row[0],
                timestamp=from_db_timestamp(row[1]),
                count=row[2],
                average_confidence=row[3],
                inference_time_ms=row[4],
            )
            for row in rows
        ]

    def clear(self) -> int:
        """Delete all records; returns how many were removed."""
        with closing(self._connect()) as conn, conn:
            return conn.execute("DELETE FROM detections").rowcount


def get_storage() -> SQLiteStorage:
    # Not cached: reads config.DB_PATH per request (tests point it at a temp file), and
    # construction does no I/O.
    return SQLiteStorage(config.DB_PATH)
