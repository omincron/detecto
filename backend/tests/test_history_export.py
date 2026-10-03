"""GET /history/export: CSV of the history (dataset S seeded directly into the temp DB)."""

import csv
import importlib.metadata
import io
import re
import zoneinfo
from datetime import datetime, timezone
from pathlib import Path

import pytest

from backend import config
from backend.models.record import DetectionRecord
from backend.tests.helpers import assert_error_body, utc

HEADER = ["id", "timestamp_utc", "person_count", "average_confidence", "inference_time_ms"]
HEADER_TZ = [
    "id", "timestamp_utc", "timestamp_local",
    "person_count", "average_confidence", "inference_time_ms",
]
UTC_COLUMN = [
    "2026-10-01T23:59:59.999Z",
    "2026-10-02T00:00:00.000Z",
    "2026-10-02T12:00:00.000Z",
    "2026-10-02T23:59:59.999Z",
    "2026-10-03T00:00:00.000Z",
]
ISO_UTC_MS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
FRONTEND = "http://localhost:5173"


def rows(response) -> list[list[str]]:
    """Assert 200 and return the parsed CSV rows (header first)."""
    assert response.status_code == 200, response.text
    return list(csv.reader(io.StringIO(response.text, newline="")))


def column(response, name: str) -> list[str]:
    parsed = rows(response)
    index = parsed[0].index(name)
    return [row[index] for row in parsed[1:]]


def export(client, **params):
    return client.get("/history/export", params=params)


def seed(storage, *items):
    """Save (timestamp, count, avg, ms) records in order."""
    for ts, count, avg, ms in items:
        storage.save(
            DetectionRecord(timestamp=ts, count=count, average_confidence=avg, inference_time_ms=ms)
        )


def assert_json_400(response):
    assert response.status_code == 400, response.text
    assert response.headers["content-type"].startswith("application/json")
    assert_error_body(response)


# --- content and format ----------------------------------------------------------


def test_empty_store_header_only(client):
    """M6-exp-01"""
    response = client.get("/history/export")

    assert response.status_code == 200
    assert response.text == "id,timestamp_utc,person_count,average_confidence,inference_time_ms\r\n"


def test_columns_without_tz(client, dataset_s):
    """M6-exp-02"""
    parsed = rows(client.get("/history/export"))

    assert parsed[0] == HEADER
    assert all(len(row) == 5 for row in parsed[1:])


def test_rows_oldest_first_with_values(client, dataset_s):
    """M6-exp-03"""
    response = client.get("/history/export")

    assert column(response, "id") == ["2", "4", "3", "5", "1"]
    assert [int(c) for c in column(response, "person_count")] == [1, 2, 0, 4, 3]
    assert [float(c) for c in column(response, "average_confidence")] == pytest.approx(
        [0.5, 0.8, 0.0, 0.7, 1.0]
    )
    assert [float(c) for c in column(response, "inference_time_ms")] == pytest.approx(
        [10, 20, 30, 40, 50]
    )


def test_number_text_rounded(client, storage):
    """M6-exp-03 / OQ-4: confidence round(x, 4), time round(x, 1), written with str."""
    seed(
        storage,
        (utc(2026, 10, 2, 9), 1, 0.123456789, 150.2777),
        (utc(2026, 10, 2, 10), 1, 1e-07, 1e-07),
    )
    response = client.get("/history/export")

    assert column(response, "average_confidence") == ["0.1235", "0.0"]
    assert column(response, "inference_time_ms") == ["150.3", "0.0"]


def test_timestamp_utc_millis_z(client, dataset_s):
    """M6-exp-04 (OQ-3: truncated, not rounded)"""
    utc_column = column(client.get("/history/export"), "timestamp_utc")

    assert utc_column == UTC_COLUMN
    assert all(ISO_UTC_MS.match(value) for value in utc_column)


@pytest.mark.parametrize(
    "query",
    [
        "",
        "start_date=2026-10-02",
        "min_confidence=0.75",
        "start_date=2026-10-02T00:00Z&end_date=2026-10-02T23:00Z",
    ],
)
def test_matches_history(client, dataset_s, query):
    """M6-exp-05"""
    history = client.get(f"/history?{query}")
    assert history.status_code == 200
    records = history.json()
    parsed = rows(client.get(f"/history/export?{query}"))
    data = parsed[1:]

    assert [int(r[0]) for r in data] == [r["id"] for r in records]
    assert [int(r[2]) for r in data] == [r["count"] for r in records]
    assert [float(r[3]) for r in data] == pytest.approx([r["average_confidence"] for r in records])
    assert [float(r[4]) for r in data] == pytest.approx([r["inference_time_ms"] for r in records])
    for row, record in zip(data, records):
        stamp = datetime.fromisoformat(record["timestamp"])
        truncated = stamp.replace(microsecond=stamp.microsecond // 1000 * 1000)
        assert datetime.fromisoformat(row[1]) == truncated


def test_crlf_line_endings(client, dataset_s):
    """M6-exp-06"""
    content = client.get("/history/export").content

    assert content.endswith(b"\r\n")
    assert content.count(b"\r\n") == 6
    assert content.replace(b"\r\n", b"").count(b"\n") == 0
    assert b"\r\r\n" not in content


def test_parses_as_plain_csv(client, dataset_s):
    """M6-exp-07 (OQ-11: no BOM)"""
    response = client.get("/history/export?tz=Europe/Athens")
    parsed = rows(response)

    assert len(parsed) == 6
    assert {len(row) for row in parsed} == {6}
    assert '"' not in response.text
    assert not response.content.startswith(b"\xef\xbb\xbf")
    response.content.decode("utf-8")
    assert all(cell for row in parsed for cell in row)


@pytest.mark.parametrize("params", [{}, {"tz": "America/St_Johns"}])
def test_no_formula_cells(client, dataset_s, params):
    """M6-exp-08"""
    parsed = rows(export(client, **params))
    header = parsed[0]

    for row in parsed[1:]:
        for name, cell in zip(header, row):
            assert cell[0] not in "=+@\t\r-", (name, cell)
            if name in ("id", "person_count"):
                int(cell)
            elif name in ("average_confidence", "inference_time_ms"):
                float(cell)
            else:
                datetime.fromisoformat(cell)


def test_export_is_read_only(client, storage, dataset_s):
    """M6-exp-09"""
    before = client.get("/history").json()

    rows(client.get("/history/export"))
    rows(client.get("/history/export?start_date=2026-10-02&min_confidence=0.75"))
    rows(client.get("/history/export?tz=Europe/Athens"))

    assert client.get("/history").json() == before
    assert len(before) == 5
    assert len(storage.list()) == 5


def test_only_get_is_routed(client, dataset_s):
    """M6-exp-10"""
    assert client.post("/history/export").status_code == 405
    assert client.delete("/history/export").status_code == 405
    assert len(client.get("/history").json()) == 5


# --- filters ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "query, expected",
    [
        ("start_date=2026-10-02", [2, 0, 4, 3]),
        ("end_date=2026-10-02", [1, 2, 0, 4]),
        ("start_date=2026-10-02&end_date=2026-10-02", [2, 0, 4]),
        ("start_date=2026-10-02T00:00Z&end_date=2026-10-02T12:00Z", [2]),
        ("start_date=2026-10-02T02:00%2B02:00", [2, 0, 4, 3]),
        ("min_confidence=0.75", [2, 0, 3]),
        ("start_date=2026-10-02&min_confidence=0.75", [2, 0, 3]),
    ],
)
def test_filters_narrow_export(client, dataset_s, query, expected):
    """M6-exp-flt-01"""
    counts = column(client.get(f"/history/export?{query}"), "person_count")
    assert [int(c) for c in counts] == expected


def test_empty_values_mean_absent(client, dataset_s):
    """M6-exp-flt-02"""
    parsed = rows(client.get("/history/export?start_date=&end_date=&min_confidence=&tz="))

    assert parsed[0] == HEADER
    assert len(parsed) == 6


def test_no_matches_header_only(client, dataset_s):
    """M6-exp-flt-03"""
    response = client.get("/history/export?start_date=2030-01-01")
    assert response.status_code == 200
    assert response.text == ",".join(HEADER) + "\r\n"

    parsed = rows(client.get("/history/export?start_date=2030-01-01&tz=Europe/Athens"))
    assert parsed == [HEADER_TZ]


# --- errors -----------------------------------------------------------------------

BAD_DATES = ["not-a-date", "2026-13-01", "2026-02-30", "2026-10-02T25:00", "02/10/2026", "2026-10"]
BAD_QUERIES = (
    [{"start_date": v} for v in BAD_DATES]
    + [{"end_date": v} for v in BAD_DATES]
    + [
        {"start_date": "2026-10-03", "end_date": "2026-10-02"},
        {"start_date": "2026-10-02T12:00Z", "end_date": "2026-10-02T12:00Z"},
        {"start_date": "2026-10-02T14:00+02:00", "end_date": "2026-10-02T12:00Z"},
    ]
    + [{"min_confidence": v} for v in ["abc", "0.5.5", "-0.01", "1.01", "2", "nan", "inf"]]
    + [{"start_date": "0001-01-01T00:00+01:00"}]
)


@pytest.mark.parametrize("params", BAD_QUERIES)
def test_invalid_filters_same_400_as_history(client, dataset_s, params):
    """M6-exp-err-01"""
    exported = client.get("/history/export", params=params)
    history = client.get("/history", params=params)

    assert_json_400(exported)
    assert_json_400(history)
    assert exported.json() == history.json()
    assert "content-disposition" not in exported.headers


@pytest.mark.parametrize("params", [{"end_date": "9999-12-31"}, {"start_date": "0999-01-01"}])
def test_extreme_valid_dates(client, dataset_s, params):
    """M6-exp-err-02"""
    assert len(rows(export(client, **params))) == 6


def test_filter_error_wins_over_tz_error(client):
    """M6-exp-err-03 (OQ-8: filters are validated first)"""
    response = client.get("/history/export?start_date=bad&tz=Mars/Base")
    assert_json_400(response)
    assert response.json() == client.get("/history?start_date=bad").json()

    response = client.get("/history/export?min_confidence=5&tz=Mars/Base")
    assert_json_400(response)
    assert response.json()["detail"] == "min_confidence must be between 0 and 1"


# --- tz -----------------------------------------------------------------------------


def test_tz_adds_local_column(client, dataset_s):
    """M6-exp-tz-01"""
    response = client.get("/history/export?tz=Europe/Athens")
    parsed = rows(response)

    assert parsed[0] == HEADER_TZ
    assert all(len(row) == 6 for row in parsed[1:])
    assert column(response, "id") == ["2", "4", "3", "5", "1"]
    assert column(response, "timestamp_utc") == UTC_COLUMN
    assert [int(c) for c in column(response, "person_count")] == [1, 2, 0, 4, 3]


def test_local_column_values(client, dataset_s):
    """M6-exp-tz-02"""
    response = client.get("/history/export?tz=Europe/Athens")
    local = column(response, "timestamp_local")

    assert local == [
        "2026-10-02T02:59:59.999+03:00",
        "2026-10-02T03:00:00.000+03:00",
        "2026-10-02T15:00:00.000+03:00",
        "2026-10-03T02:59:59.999+03:00",
        "2026-10-03T03:00:00.000+03:00",
    ]
    for loc, u in zip(local, column(response, "timestamp_utc")):
        assert datetime.fromisoformat(loc) == datetime.fromisoformat(u)


@pytest.mark.parametrize(
    "tz, index, expected",
    [
        ("Asia/Kathmandu", 2, "2026-10-02T17:45:00.000+05:45"),  # R3
        ("Asia/Kolkata", 2, "2026-10-02T17:30:00.000+05:30"),  # R3
        ("America/St_Johns", 2, "2026-10-02T09:30:00.000-02:30"),  # R3
        ("Pacific/Kiritimati", 0, "2026-10-02T13:59:59.999+14:00"),  # R1
        ("Pacific/Pago_Pago", 4, "2026-10-02T13:00:00.000-11:00"),  # R5
    ],
)
def test_unusual_offsets(client, dataset_s, tz, index, expected):
    """M6-exp-tz-03"""
    assert column(export(client, tz=tz), "timestamp_local")[index] == expected


def test_dst_transitions(client, storage):
    """M6-exp-tz-04"""
    seed(
        storage,
        (datetime(2026, 3, 29, 0, 59, 59, 999000, tzinfo=timezone.utc), 1, 0.5, 1.0),  # D1
        (utc(2026, 3, 29, 1, 0, 0), 2, 0.5, 1.0),  # D2
        (utc(2026, 10, 25, 0, 30, 0), 3, 0.5, 1.0),  # D3
        (utc(2026, 10, 25, 1, 30, 0), 4, 0.5, 1.0),  # D4
        (utc(2026, 11, 1, 5, 30, 0), 5, 0.5, 1.0),  # D5
        (utc(2026, 11, 1, 6, 30, 0), 6, 0.5, 1.0),  # D6
    )

    athens = export(client, tz="Europe/Athens")
    assert [int(c) for c in column(athens, "person_count")] == [1, 2, 3, 4, 5, 6]
    assert column(athens, "timestamp_local")[:4] == [
        "2026-03-29T02:59:59.999+02:00",
        "2026-03-29T04:00:00.000+03:00",
        "2026-10-25T03:30:00.000+03:00",
        "2026-10-25T03:30:00.000+02:00",
    ]

    new_york = export(client, tz="America/New_York")
    assert column(new_york, "timestamp_local")[4:] == [
        "2026-11-01T01:30:00.000-04:00",
        "2026-11-01T01:30:00.000-05:00",
    ]


@pytest.mark.parametrize("tz", ["UTC", "Etc/UTC", "Europe/London"])
def test_zero_offset_zone(client, storage, dataset_s, tz):
    """M6-exp-tz-05 (OQ-2: local always has a numeric offset, never Z)"""
    seed(storage, (utc(2026, 1, 15, 12, 0, 0), 9, 0.5, 1.0))
    response = export(client, tz=tz)
    parsed = rows(response)

    assert parsed[0] == HEADER_TZ
    local = column(response, "timestamp_local")
    for loc, u in zip(local, column(response, "timestamp_utc")):
        assert datetime.fromisoformat(loc) == datetime.fromisoformat(u)
        assert not loc.endswith("Z")
    assert local[0] == "2026-01-15T12:00:00.000+00:00"
    if tz != "Europe/London":
        assert local[1:] == [u.replace("Z", "+00:00") for u in UTC_COLUMN]


@pytest.mark.parametrize(
    "tz",
    [
        "Mars/Base", "europe/athens", "Europe/Athens ", " Europe/Athens", "Europe//Athens",
        "Europe/Athens/", "Etc/Unknown", "Ελλάδα", "Europe\\Athens", "+03:00", "3",
    ],
)
def test_unknown_tz_is_400(client, dataset_s, tz):
    """M6-exp-tz-06"""
    response = export(client, tz=tz)

    assert_json_400(response)
    assert "time zone" in response.json()["detail"].lower()


@pytest.mark.parametrize(
    "tz",
    [
        "/etc/passwd", "../../etc/passwd", "Europe/../../../etc/passwd", ".", "..", "Europe/",
        "zone.tab", "tzdata.zi", "__init__.py", "a\x00b", "Europe/Athens\n", "Europe", "America",
        "x" * 300, "Europe/" + "x" * 300, "A/" * 2000,
        # OQ-1: loadable keys that aren't real zones
        "localtime", "posixrules", "Factory",
    ],
    ids=lambda v: repr(v[:40]),
)
def test_malformed_tz_never_500(client, dataset_s, tz):
    """M6-exp-tz-07"""
    response = export(client, tz=tz)

    assert_json_400(response)
    assert "root:" not in response.text


@pytest.mark.parametrize("tz", ["Asia/Calcutta", "US/Pacific", "Etc/GMT+3"])
def test_listed_legacy_zones_accepted(client, dataset_s, tz):
    """M6-exp-tz-07 (OQ-1: legacy keys in available_timezones() are accepted)"""
    assert rows(export(client, tz=tz))[0] == HEADER_TZ


def test_tz_detail_is_safe_to_show(client):
    """M6-exp-tz-08 (OQ-12: echoed value cut to 64 chars)"""
    response = client.get("/history/export?tz=Europe/Athens%0AInjected")
    assert_json_400(response)
    assert "\n" not in response.json()["detail"]

    for length in (300, 2000):
        response = export(client, tz="x" * length)
        assert_json_400(response)
        assert len(response.json()["detail"]) <= 120


# --- headers and CORS ------------------------------------------------------------------


def test_content_type_csv(client, storage):
    """M6-exp-hdr-01"""
    assert client.get("/history/export").headers["content-type"] == "text/csv; charset=utf-8"
    seed(storage, (utc(2026, 10, 2, 9), 1, 0.5, 1.0))
    for params in ({}, {"tz": "Europe/Athens"}):
        assert export(client, **params).headers["content-type"] == "text/csv; charset=utf-8"


@pytest.mark.parametrize("params", [{}, {"tz": "Pacific/Kiritimati"}])
def test_attachment_filename_utc_stamp(client, dataset_s, params):
    """M6-exp-hdr-02"""
    before = datetime.now(timezone.utc)
    response = export(client, **params)
    after = datetime.now(timezone.utc)

    match = re.match(
        r'^attachment; filename="detecto-history-(\d{8}-\d{6})\.csv"$',
        response.headers["content-disposition"],
    )
    assert match, response.headers["content-disposition"]
    stamp = datetime.strptime(match.group(1), "%Y%m%d-%H%M%S").replace(tzinfo=timezone.utc)
    assert before.replace(microsecond=0) <= stamp <= after


@pytest.mark.parametrize("query", ["tz=Mars/Base", "start_date=bad"])
def test_errors_are_not_attachments(client, query):
    """M6-exp-hdr-03"""
    response = client.get(f"/history/export?{query}")

    assert response.status_code == 400
    assert "content-disposition" not in response.headers
    assert response.headers["content-type"].startswith("application/json")


def test_cors_exposes_content_disposition(client, dataset_s):
    """M6-cors-01"""
    response = client.get("/history/export?tz=Europe/Athens", headers={"Origin": FRONTEND})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == FRONTEND
    exposed = response.headers["access-control-expose-headers"]
    assert "content-disposition" in [h.strip().lower() for h in exposed.split(",")]


def test_cors_unknown_origin_denied(client, dataset_s):
    """M6-cors-02"""
    response = client.get("/history/export", headers={"Origin": "http://evil.example"})

    # Only the allow-origin grant matters: without it the browser blocks the response
    # and ignores any other Access-Control-* header, which Starlette adds for every
    # origin (healer report M6, item C, resolved by the user as option (a)).
    assert "access-control-allow-origin" not in response.headers


def test_cors_on_error_responses(client):
    """M6-cors-03"""
    response = client.get("/history/export?tz=Mars/Base", headers={"Origin": FRONTEND})

    assert response.status_code == 400
    assert response.headers["access-control-allow-origin"] == FRONTEND


# --- dependencies ---------------------------------------------------------------------------


def test_tzdata_pinned_and_installed():
    """M6-deps-01"""
    requirements = (Path(config.PROJECT_ROOT) / "requirements.txt").read_text().splitlines()
    pins = [line.strip() for line in requirements if re.match(r"^tzdata==\d{4}\.\d+$", line.strip())]
    assert len(pins) == 1, requirements
    assert importlib.metadata.version("tzdata") == pins[0].split("==")[1]

    zoneinfo.reset_tzpath(to=[])
    try:
        assert zoneinfo.ZoneInfo.no_cache("Europe/Athens").key == "Europe/Athens"
    finally:
        zoneinfo.reset_tzpath()


def test_history_still_json_and_ignores_tz(client, dataset_s):
    """M6 regression: /history stays JSON and gains no tz validation"""
    response = client.get("/history?tz=Mars/Base")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert len(response.json()) == 5
