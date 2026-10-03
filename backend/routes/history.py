import csv
import io
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo, available_timezones

from fastapi import APIRouter, Depends, HTTPException, Response

from backend.models.record import DetectionRecord, ResetResponse
from backend.services.storage import HistoryFilters, SQLiteStorage, get_storage

router = APIRouter()


def parse_bound(value: str, name: str, is_end: bool) -> datetime | None:
    """Parse a date filter into an aware UTC datetime. Accepts a date ("2026-10-02")
    or an ISO datetime ("2026-10-02T14:30", "...Z", "...+02:00"); naive values are
    taken as UTC.

    A date-only end bound covers that whole day (exclusive end = next midnight); a
    datetime end bound is exclusive as given. Returns None when a date-only end is the
    last representable day, since "through 9999-12-31" means no upper bound.
    """
    try:
        if len(value) == 10:
            day = date.fromisoformat(value)
            if is_end:
                if day == date.max:
                    return None
                day += timedelta(days=1)
            return datetime.combine(day, time.min, tzinfo=timezone.utc)
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {name}: {value!r} (expected YYYY-MM-DD or an ISO datetime)",
        ) from None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    try:
        return parsed.astimezone(timezone.utc)
    except OverflowError:
        raise HTTPException(
            status_code=400, detail=f"Invalid {name}: {value!r} is out of range in UTC"
        ) from None


def parse_min_confidence(value: str) -> float:
    try:
        parsed = float(value)
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Invalid min_confidence: {value!r} (expected a number)"
        ) from None
    if not 0 <= parsed <= 1:  # also rejects NaN
        raise HTTPException(status_code=400, detail="min_confidence must be between 0 and 1")
    return parsed


def parse_filters(
    start_date: str | None, end_date: str | None, min_confidence: str | None
) -> HistoryFilters:
    """The /history query params as storage filters; shared by /history and its export
    so both accept exactly the same values and give the same 400s."""
    start = parse_bound(start_date, "start_date", is_end=False) if start_date else None
    end = parse_bound(end_date, "end_date", is_end=True) if end_date else None
    if start and end and start >= end:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")
    confidence = parse_min_confidence(min_confidence) if min_confidence else None
    return HistoryFilters(start=start, end=end, min_confidence=confidence)


# Keys zoneinfo can load but that aren't real zones: "localtime" is the *server's* zone
# (it would leak it and make the export depend on the machine), the others are tzdata
# internals.
NOT_ZONES = {"localtime", "posixrules", "Factory"}
MAX_ECHOED_TZ = 64  # an unknown tz is quoted in the error, cut to this length


@lru_cache
def known_time_zones() -> frozenset[str]:
    return frozenset(available_timezones() - NOT_ZONES)


def parse_time_zone(value: str) -> ZoneInfo:
    """An IANA zone name from the official list. Checking the list, rather than trying
    ZoneInfo(value), also rejects directories ("Europe"), over-long values and paths
    before any file is opened."""
    if value not in known_time_zones():
        shown = value if len(value) <= MAX_ECHOED_TZ else value[:MAX_ECHOED_TZ] + "…"
        raise HTTPException(
            status_code=400, detail=f"Unknown time zone: {shown!r} (expected e.g. Europe/Athens)"
        )
    return ZoneInfo(value)


def iso_utc(value: datetime) -> str:
    """UTC as ISO 8601 with milliseconds (truncated, so a record never moves to the next
    second, or day) and a "Z"."""
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def iso_local(value: datetime, zone: ZoneInfo) -> str:
    """Local time as ISO 8601 with milliseconds and a numeric offset, "+00:00" included,
    so a zero-offset local time never looks like the UTC column."""
    return value.astimezone(zone).isoformat(timespec="milliseconds")


@router.get("/history", response_model=list[DetectionRecord])
def get_history(
    # Strings, not datetime/float, so an empty value (a cleared filter field) can mean
    # "no filter" and every parse error is our 400 with a readable message.
    start_date: str | None = None,
    end_date: str | None = None,
    min_confidence: str | None = None,
    storage: SQLiteStorage = Depends(get_storage),
):
    return storage.list(parse_filters(start_date, end_date, min_confidence))


@router.get("/history/export")
def export_history(
    start_date: str | None = None,
    end_date: str | None = None,
    min_confidence: str | None = None,
    tz: str | None = None,
    storage: SQLiteStorage = Depends(get_storage),
):
    """The /history records as a CSV download, oldest first. With `tz` (an IANA name,
    e.g. the browser's zone) a `timestamp_local` column is added next to the UTC one.
    Every cell is a number or a timestamp we generate, so there's no CSV-injection
    risk; escape any free-text column added later (e.g. a camera name). The content is
    ASCII only, so no UTF-8 BOM is written (a BOM breaks some CSV readers); add one if
    a non-ASCII column ever appears, so Excel on Windows reads it as UTF-8.
    Filters are validated before `tz`, so with both invalid the filter error is shown."""
    filters = parse_filters(start_date, end_date, min_confidence)
    zone = parse_time_zone(tz) if tz else None
    records = storage.list(filters)

    buffer = io.StringIO()
    writer = csv.writer(buffer)  # RFC 4180: CRLF line endings
    header = ["id", "timestamp_utc"]
    if zone:
        header.append("timestamp_local")
    writer.writerow(header + ["person_count", "average_confidence", "inference_time_ms"])
    for record in records:
        row = [record.id, iso_utc(record.timestamp)]
        if zone:
            row.append(iso_local(record.timestamp, zone))
        # Rounded for spreadsheets: confidence to 4 decimals, time to 0.1 ms.
        writer.writerow(row + [
            record.count,
            round(record.average_confidence, 4),
            round(record.inference_time_ms, 1),
        ])

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="detecto-history-{stamp}.csv"'},
    )


@router.delete("/reset", response_model=ResetResponse)
def reset_history(storage: SQLiteStorage = Depends(get_storage)):
    return ResetResponse(status="cleared", count_removed=storage.clear())
