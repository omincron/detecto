from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

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


@router.get("/history", response_model=list[DetectionRecord])
def get_history(
    # Strings, not datetime/float, so an empty value (a cleared filter field) can mean
    # "no filter" and every parse error is our 400 with a readable message.
    start_date: str | None = None,
    end_date: str | None = None,
    min_confidence: str | None = None,
    storage: SQLiteStorage = Depends(get_storage),
):
    start = parse_bound(start_date, "start_date", is_end=False) if start_date else None
    end = parse_bound(end_date, "end_date", is_end=True) if end_date else None
    if start and end and start >= end:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")
    confidence = parse_min_confidence(min_confidence) if min_confidence else None

    return storage.list(HistoryFilters(start=start, end=end, min_confidence=confidence))


@router.delete("/reset", response_model=ResetResponse)
def reset_history(storage: SQLiteStorage = Depends(get_storage)):
    return ResetResponse(status="cleared", count_removed=storage.clear())
