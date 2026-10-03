# Test plan — Milestone 6: CSV export of detection history (bonus)

## Scope

**Added in M6 (uncommitted working tree):**
- Backend: `GET /history/export` in `backend/routes/history.py`. It shares
  `parse_filters()` with `/history`, adds `parse_time_zone()` (the `tz` param) and
  `iso_millis()`, and builds the CSV with the `csv` module. `backend/main.py` CORS now has
  `expose_headers=["Content-Disposition"]`. `tzdata==2026.5` is added to `requirements.txt`.
- Frontend: `api/client.js` is refactored into `send`/`failure`/`readJson`/`toQuery`, plus
  the new `exportHistory(params, {timeZone})`. There is a new `utils/download.js`
  (`saveBlob`) and a new `components/ExportHistoryButton.jsx`. `pages/HistoryView.jsx`
  gets the "Export CSV (all N | N filtered)" button and an export error alert.
  `ClearHistoryButton.jsx` gets the "Download a copy first (CSV)" link.

**Contract:** ARCHITECTURE.md §3.3 `GET /history/export` and §4.1 (Export CSV, clear
dialog link). The PROGRESS.md entry "2026-10-03 — Milestone 6" records the user's
decisions: CSV only, the export follows the *applied* filters, and there is a local-time
column as well as UTC. instructions.md "Bonus" says "Export detection history to CSV or
Excel format".

**In scope:** the endpoint (columns, order, filters, 400s, `tz`, headers, CORS, CSV
format, empty result, read-only). Regressions from the `client.js` refactor.
`exportHistory`, `saveBlob`, `ExportHistoryButton`, the History page integration, the
clear-dialog link, and manual checks of a real browser download.

**Out of scope:** `/detect`, the evaluation and the Detect page. These are only re-run
as part of the existing suite.

**Conventions for the generator:**
- Backend: use the existing `client`, `storage` and `dataset_s` fixtures from
  `backend/tests/conftest.py`. They provide a temp `DB_PATH` per test, and the session
  guard keeps the real `backend/detecto.db` untouched. No real model is needed: the
  export never touches the detector. Put the tests in a new
  `backend/tests/test_history_export.py`. Parse CSV bodies with
  `csv.reader(io.StringIO(response.text, newline=""))`.
- Dataset S as seeded by `dataset_s` (insertion order gives the ids):

  | rec | id | timestamp (UTC) | count | avg | ms |
  |---|---|---|---|---|---|
  | R5 | 1 | 2026-10-03T00:00:00.000000 | 3 | 1.00 | 50.0 |
  | R1 | 2 | 2026-10-01T23:59:59.999999 | 1 | 0.50 | 10.0 |
  | R3 | 3 | 2026-10-02T12:00:00.000000 | 0 | 0.00 | 30.0 |
  | R2 | 4 | 2026-10-02T00:00:00.000000 | 2 | 0.80 | 20.0 |
  | R4 | 5 | 2026-10-02T23:59:59.999999 | 4 | 0.70 | 40.0 |

  The expected oldest-first row order is R1, R2, R3, R4, R5, with **ids 2, 4, 3, 5, 1**.
  This shows the order comes from the timestamp, not the id.
- Dataset DST (new, seeded via `storage.save`). The local values were computed with
  `zoneinfo`:

  | rec | UTC | tz | expected `timestamp_local` |
  |---|---|---|---|
  | D1 | 2026-03-29T00:59:59.999Z | Europe/Athens | 2026-03-29T02:59:59.999+02:00 |
  | D2 | 2026-03-29T01:00:00.000Z | Europe/Athens | 2026-03-29T04:00:00.000+03:00 |
  | D3 | 2026-10-25T00:30:00.000Z | Europe/Athens | 2026-10-25T03:30:00.000+03:00 |
  | D4 | 2026-10-25T01:30:00.000Z | Europe/Athens | 2026-10-25T03:30:00.000+02:00 |
  | D5 | 2026-11-01T05:30:00.000Z | America/New_York | 2026-11-01T01:30:00.000-04:00 |
  | D6 | 2026-11-01T06:30:00.000Z | America/New_York | 2026-11-01T01:30:00.000-05:00 |

- Assert numeric cells by value (`int(...)` and `float(...) == pytest.approx`), not by
  exact text, because the text format is OQ-4. Assert timestamp cells by exact string.
- Frontend: use Vitest and Testing Library with the helpers in `src/test/helpers.js`.
  **Note:** `mockFetch`'s router sends any URL containing `/history` to the `history`
  handler, and that includes `/history/export`. The tests must branch on
  `url.includes("/history/export")` inside that handler, or the generator can add an
  `exportCsv` route to `mockFetch` that is checked *before* `/history`. Also,
  `callsTo(fetchMock, "/history")` matches export calls too. To count list queries
  alone, use a filter that excludes `/export`. Build CSV responses as
  `new Response("id,...\r\n", {status: 200, headers: {"content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="detecto-history-20261003-120000.csv"'}})`.
  Stub `saveBlob` with `vi.mock("../utils/download.js")` in component and page tests.
  Test it directly only in its own unit test.
- **Known failures found while planning:** M6-exp-tz-07 rows "Europe", "America" and the
  >255-char values return **500** (`IsADirectoryError` / `OSError` escape
  `parse_time_zone`, which only catches `ZoneInfoNotFoundError, ValueError`). These
  cases are expected to fail until that is fixed. The spec is unambiguous here
  ("unknown → 400"; every error has a `{"detail"}` body).

## Test cases

### GET /history/export: content and format

- **ID** M6-exp-01
- **Behavior:** With an empty store, the export returns 200 with only the header row.
- **Source:** ARCHITECTURE.md §3.3 ("No matches → header row only")
- **Setup:** temp DB, nothing seeded (DB file need not exist)
- **Steps → Expected:** `GET /history/export` → 200. The body is exactly
  `"id,timestamp_utc,person_count,average_confidence,inference_time_ms\r\n"`.
- **Type:** unit

- **ID** M6-exp-02
- **Behavior:** Without `tz`, the columns are exactly `id, timestamp_utc, person_count,
  average_confidence, inference_time_ms`, in that order.
- **Source:** ARCHITECTURE.md §3.3
- **Setup:** `dataset_s`
- **Steps → Expected:** `GET /history/export` → 200. The parsed header row is
  `["id","timestamp_utc","person_count","average_confidence","inference_time_ms"]`.
  Every data row has 5 cells.
- **Type:** unit

- **ID** M6-exp-03
- **Behavior:** Rows are oldest first, and every stored record appears exactly once with
  its values.
- **Source:** ARCHITECTURE.md §3.3 ("oldest first"); PROGRESS.md M6
- **Setup:** `dataset_s`
- **Steps → Expected:** `GET /history/export` → 5 data rows. The id column is
  `["2","4","3","5","1"]` and person_count is `[1,2,0,4,3]`. average_confidence (as
  float) is `[0.5,0.8,0.0,0.7,1.0]` and inference_time_ms (as float) is
  `[10,20,30,40,50]`.
- **Type:** unit

- **ID** M6-exp-04
- **Behavior:** `timestamp_utc` is ISO 8601 with exactly millisecond precision and a `Z`
  suffix.
- **Source:** ARCHITECTURE.md §3.3 ("ISO 8601 with milliseconds: `…Z` for UTC")
- **Setup:** `dataset_s`
- **Steps → Expected:** the timestamp_utc column is exactly
  `["2026-10-01T23:59:59.999Z","2026-10-02T00:00:00.000Z","2026-10-02T12:00:00.000Z",
  "2026-10-02T23:59:59.999Z","2026-10-03T00:00:00.000Z"]`. Every value matches
  `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`. The R1/R4 values (`.999999` stored)
  depend on truncation, see OQ-3.
- **Type:** unit

- **ID** M6-exp-05
- **Behavior:** The export rows match `/history` for the same query: same records, same
  order, same values.
- **Source:** ARCHITECTURE.md §3.3 ("Same … params as `/history`"); README "returns the
  same records as CSV"
- **Setup:** `dataset_s`
- **Steps → Expected:** for each query in {none, `start_date=2026-10-02`,
  `min_confidence=0.75`, `start_date=2026-10-02T00:00Z&end_date=2026-10-02T23:00Z`}, get
  both endpoints. The ids, the counts and `float(avg)`, `float(ms)` from the CSV equal
  `[r["id"]]`, `[r["count"]]`, `[r["average_confidence"]]`, `[r["inference_time_ms"]]`
  from `/history`, in the same order. `datetime.fromisoformat(csv timestamp_utc)` equals
  the `/history` timestamp truncated to milliseconds.
- **Type:** unit

- **ID** M6-exp-06
- **Behavior:** Line endings are CRLF, including after the last row, with no bare `\n`.
- **Source:** ARCHITECTURE.md §3.3 ("CRLF line ends"); PROGRESS.md M6
- **Setup:** `dataset_s`
- **Steps → Expected:** `response.content.endswith(b"\r\n")`.
  `response.content.count(b"\r\n") == 6` (header + 5 rows).
  `response.content.replace(b"\r\n", b"").count(b"\n") == 0`. There is no
  `b"\r\r\n"`.
- **Type:** unit

- **ID** M6-exp-07
- **Behavior:** The body parses as RFC 4180 CSV. There are no quoted cells, no blank
  lines, and no leading BOM.
- **Source:** ARCHITECTURE.md §3.3 (CSV, opens in Excel); README "It opens in Excel"
- **Setup:** `dataset_s`, then `GET /history/export?tz=Europe/Athens`
- **Steps → Expected:** `csv.reader` yields 6 rows, all of the same width (6).
  `'"' not in response.text`. `not response.content.startswith(b"\xef\xbb\xbf")` (see
  OQ-11). The body decodes as UTF-8 and every cell is non-empty.
- **Type:** unit

- **ID** M6-exp-08
- **Behavior:** No cell can start a spreadsheet formula. Every cell is a number or a
  timestamp.
- **Source:** ARCHITECTURE.md §3.3 ("Every cell is a number or a server-generated
  timestamp, so no CSV-injection escaping is needed")
- **Setup:** `dataset_s`, then with and without `tz=America/St_Johns` (negative offset)
- **Steps → Expected:** for every data cell, `cell[0]` is not in `=+@\t\r` and `-`
  appears only inside a timestamp's date or offset (never at index 0). id and
  person_count parse with `int()`. Confidence and ms parse with `float()`. Timestamps
  parse with `datetime.fromisoformat()`.
- **Type:** unit

- **ID** M6-exp-09
- **Behavior:** The export is read-only and doesn't change the stored records.
- **Source:** ARCHITECTURE.md §3.3 (GET; only `/reset` deletes); clear-dialog contract
  "Download a copy first"
- **Setup:** `dataset_s`
- **Steps → Expected:** call `/history/export` three times, with and without filters and
  `tz`. Afterwards `GET /history` still returns the same 5 records (ids and values
  unchanged), and `storage.list()` has a length of 5.
- **Type:** unit

- **ID** M6-exp-10
- **Behavior:** Only GET is routed. Other methods get 405 and do not delete anything.
- **Source:** ARCHITECTURE.md §3.3 (endpoint is `GET`)
- **Setup:** `dataset_s`
- **Steps → Expected:** `POST /history/export` and `DELETE /history/export` → 405.
  `GET /history` still returns 5 records.
- **Type:** unit

### GET /history/export: filters (shared with /history)

- **ID** M6-exp-flt-01
- **Behavior:** Each `/history` filter narrows the export in the same way.
- **Source:** ARCHITECTURE.md §3.3 (/history filter semantics; "Same … params")
- **Setup:** `dataset_s`
- **Steps → Expected (person_count column):**
  - `start_date=2026-10-02` → `[2,0,4,3]`
  - `end_date=2026-10-02` (date-only end covers the whole day) → `[1,2,0,4]`
  - `start_date=2026-10-02&end_date=2026-10-02` → `[2,0,4]`
  - `start_date=2026-10-02T00:00Z&end_date=2026-10-02T12:00Z` (exclusive end) → `[2]`
  - `start_date=2026-10-02T02:00%2B02:00` (offset → UTC 00:00) → `[2,0,4,3]`
  - `min_confidence=0.75` (zero-person records always kept) → `[2,0,3]`
  - `start_date=2026-10-02&min_confidence=0.75` (AND) → `[2,0,3]`
- **Type:** unit

- **ID** M6-exp-flt-02
- **Behavior:** Empty filter values count as absent, the same as on `/history`.
- **Source:** ARCHITECTURE.md §3.3 ("An empty value … means the same as leaving the
  parameter out")
- **Setup:** `dataset_s`
- **Steps → Expected:** `?start_date=&end_date=&min_confidence=&tz=` → 200 with all 5
  rows and the 5-column header (no `timestamp_local`).
- **Type:** unit

- **ID** M6-exp-flt-03
- **Behavior:** Filters that match nothing give a header-only CSV, not an error.
- **Source:** ARCHITECTURE.md §3.3 ("No matches → header row only")
- **Setup:** `dataset_s`
- **Steps → Expected:** `start_date=2030-01-01` → 200 with a body of exactly the 5-column
  header + `\r\n`. `start_date=2030-01-01&tz=Europe/Athens` → 200 with only the 6-column
  header row.
- **Type:** unit

### GET /history/export: errors (identical to /history)

- **ID** M6-exp-err-01
- **Behavior:** Every invalid filter gets the same 400 and the same `detail` as on
  `/history`.
- **Source:** ARCHITECTURE.md §3.3 ("with the same `400`s"); PROGRESS.md M6
  (`parse_filters()` shared)
- **Setup:** `dataset_s`
- **Steps → Expected:** for each query below, `GET /history/export?<q>` and
  `GET /history?<q>` both return 400 with `content-type: application/json`, and
  `export.json() == history.json()`. That is a `{"detail": <str>}` body, and the body
  must not be CSV.
  - `start_date=` / `end_date=` ∈ {`not-a-date`, `2026-13-01`, `2026-02-30`,
    `2026-10-02T25:00`, `02/10/2026`, `2026-10`}
  - `start_date=2026-10-03&end_date=2026-10-02`,
    `start_date=2026-10-02T12:00Z&end_date=2026-10-02T12:00Z`,
    `start_date=2026-10-02T14:00%2B02:00&end_date=2026-10-02T12:00Z`
  - `min_confidence` ∈ {`abc`, `0.5.5`, `-0.01`, `1.01`, `2`, `nan`, `inf`}
  - `start_date=0001-01-01T00:00%2B01:00` (unrepresentable in UTC)
- **Type:** unit

- **ID** M6-exp-err-02
- **Behavior:** Extreme but valid dates are accepted, never a 500.
- **Source:** ARCHITECTURE.md §3.3 ("Never `500` for a parseable date")
- **Setup:** `dataset_s`
- **Steps → Expected:** `end_date=9999-12-31` and `start_date=0999-01-01` → 200 with
  5 rows each.
- **Type:** unit

- **ID** M6-exp-err-03
- **Behavior:** An invalid filter combined with an invalid `tz` is still a 400 with a
  string detail.
- **Source:** ARCHITECTURE.md §3.3 (both are `400`s); which message wins is OQ-8
- **Setup:** none
- **Steps → Expected:** `start_date=bad&tz=Mars/Base` → 400 with `detail` a non-empty
  str. `min_confidence=5&tz=Mars/Base` → 400 with str `detail`.
- **Type:** unit

### GET /history/export: tz

- **ID** M6-exp-tz-01
- **Behavior:** With a valid `tz`, a `timestamp_local` column sits between
  `timestamp_utc` and `person_count`.
- **Source:** ARCHITECTURE.md §3.3 ("Columns: `id, timestamp_utc, [timestamp_local,]
  …`")
- **Setup:** `dataset_s`
- **Steps → Expected:** `tz=Europe/Athens` → the header is
  `["id","timestamp_utc","timestamp_local","person_count","average_confidence","inference_time_ms"]`
  and every row has 6 cells. The other columns are unchanged from M6-exp-03/04.
- **Type:** unit

- **ID** M6-exp-tz-02
- **Behavior:** `timestamp_local` is the same instant shown with the zone's offset, with
  milliseconds.
- **Source:** ARCHITECTURE.md §3.3 ("`…+03:00` for local")
- **Setup:** `dataset_s`, `tz=Europe/Athens`
- **Steps → Expected:** the timestamp_local column is exactly
  `["2026-10-02T02:59:59.999+03:00","2026-10-02T03:00:00.000+03:00","2026-10-02T15:00:00.000+03:00",
  "2026-10-03T02:59:59.999+03:00","2026-10-03T03:00:00.000+03:00"]`. For each row,
  `fromisoformat(local) == fromisoformat(utc)`.
- **Type:** unit

- **ID** M6-exp-tz-03
- **Behavior:** Non-hour and extreme offsets are written correctly, and so is a local
  date that differs from the UTC date.
- **Source:** ARCHITECTURE.md §3.3 (IANA zone, ISO offset)
- **Setup:** `dataset_s`
- **Steps → Expected (R1 or R3 row, `timestamp_local`):**
  - `tz=Asia/Kathmandu`, R3 → `2026-10-02T17:45:00.000+05:45`
  - `tz=Asia/Kolkata`, R3 → `2026-10-02T17:30:00.000+05:30`
  - `tz=America/St_Johns`, R3 → `2026-10-02T09:30:00.000-02:30`
  - `tz=Pacific/Kiritimati`, R1 → `2026-10-02T13:59:59.999+14:00`
  - `tz=Pacific/Pago_Pago`, R5 → `2026-10-02T13:00:00.000-11:00` (local date before the
    UTC date)
- **Type:** unit

- **ID** M6-exp-tz-04
- **Behavior:** Records on either side of a DST change get the offset in force at that
  instant. In a repeated (fall-back) hour, the same wall time is told apart by its
  offset.
- **Source:** ARCHITECTURE.md §3.3; PROGRESS.md M6 (local-time column decision)
- **Setup:** dataset DST (D1–D6)
- **Steps → Expected:** `tz=Europe/Athens` → D1–D4 local values exactly as in the
  dataset table (D3 and D4 both read `03:30:00.000` but with `+03:00` and `+02:00`).
  `tz=America/New_York` → D5 `…01:30:00.000-04:00` and D6 `…01:30:00.000-05:00`. Row
  order stays by UTC instant (D3 before D4, D5 before D6).
- **Type:** unit

- **ID** M6-exp-tz-05
- **Behavior:** A zero-offset zone still produces a `timestamp_local` column that
  denotes the same instant.
- **Source:** ARCHITECTURE.md §3.3; the textual form (`Z` vs `+00:00`) is OQ-2
- **Setup:** `dataset_s`
- **Steps → Expected:** for `tz` ∈ {`UTC`, `Etc/UTC`, `Europe/London` (with a seeded
  2026-01-15T12:00Z record)}: 200, a 6-column header, and
  `fromisoformat(local) == fromisoformat(utc)` for every row. The suffix is asserted
  only once OQ-2 is decided.
- **Type:** unit

- **ID** M6-exp-tz-06
- **Behavior:** An unknown, wrongly cased or padded zone name is a 400 with a string
  detail that names the problem.
- **Source:** ARCHITECTURE.md §3.3 ("unknown → `400`"); PROGRESS.md M6
- **Setup:** `dataset_s`
- **Steps → Expected:** for `tz` ∈ {`Mars/Base`, `europe/athens`, `Europe/Athens ` (trailing
  space), ` Europe/Athens`, `Europe//Athens`, `Europe/Athens/`, `Etc/Unknown`, `Ελλάδα`,
  `Europe\Athens`, `+03:00`, `3`}: 400, JSON `{"detail": str}`, and `"time zone" in
  detail.lower()`. No CSV body is returned.
- **Type:** unit

- **ID** M6-exp-tz-07
- **Behavior:** Malicious or malformed `tz` values never reach the filesystem
  successfully and never cause a 500. They are always a 400 with a JSON detail.
- **Source:** ARCHITECTURE.md §3.3 ("unknown → `400`", errors have `{"detail"}`);
  PROGRESS.md M6 ("An unknown or malformed zone (`Mars/Base`, `/etc/passwd`) is a 400")
- **Setup:** `dataset_s`; `TestClient(raise_server_exceptions=False)` (the `client`
  fixture)
- **Steps → Expected:** for `tz` ∈ {`/etc/passwd`, `../../etc/passwd`,
  `Europe/../../../etc/passwd`, `.`, `..`, `Europe/`, `zone.tab`, `tzdata.zi`,
  `__init__.py`, `a%00b` (NUL), `Europe/Athens%0A` (newline), `Europe`, `America`,
  `"x"*300`, `"Europe/" + "x"*300`, `"A/"*2000`}: status == 400 (not 500),
  `content-type` is JSON, and the body is `{"detail": str}`. The body does not contain
  `root:` or any `/etc/passwd` content.
  **Currently failing for `Europe`, `America` and the overlong values (500)**, see
  Scope.
- **Type:** unit

- **ID** M6-exp-tz-08
- **Behavior:** The detail for a bad `tz` is safe to show in the UI: one line, bounded
  in length.
- **Source:** ARCHITECTURE.md §3.3 ("a `{"detail": "<string>"}` body the frontend can
  display directly")
- **Setup:** none
- **Steps → Expected:** `tz=Europe/Athens%0AInjected` → 400 with `"\n" not in detail`.
  `tz="x"*300` → 400 with `len(detail) <= 400` (see OQ-12 for whether to echo the value
  at all).
- **Type:** unit

### GET /history/export: headers and CORS

- **ID** M6-exp-hdr-01
- **Behavior:** The response is `text/csv; charset=utf-8`.
- **Source:** ARCHITECTURE.md §3.3
- **Setup:** `dataset_s`
- **Steps → Expected:** `response.headers["content-type"] == "text/csv; charset=utf-8"`
  with and without `tz`, and for the empty-store case.
- **Type:** unit

- **ID** M6-exp-hdr-02
- **Behavior:** The response is an attachment named
  `detecto-history-<UTC yyyymmdd-hhmmss>.csv`, stamped with the request time in UTC.
- **Source:** ARCHITECTURE.md §3.3; PROGRESS.md M6
- **Setup:** `dataset_s`. Record `before = datetime.now(timezone.utc)` and `after` around
  the call.
- **Steps → Expected:** `content-disposition` matches
  `^attachment; filename="detecto-history-(\d{8}-\d{6})\.csv"$`. The parsed stamp
  (`%Y%m%d-%H%M%S`, UTC) satisfies `before.replace(microsecond=0) <= stamp <= after`.
  It is the same with `tz=Pacific/Kiritimati`: the stamp stays UTC and does not follow
  `tz`.
- **Type:** unit

- **ID** M6-exp-hdr-03
- **Behavior:** Error responses are not attachments.
- **Source:** ARCHITECTURE.md §3.3 (errors are `{"detail"}` JSON)
- **Setup:** none
- **Steps → Expected:** `tz=Mars/Base` and `start_date=bad` → 400 with no
  `content-disposition` header, and a content-type starting with `application/json`.
- **Type:** unit

- **ID** M6-cors-01
- **Behavior:** From the frontend origin, the export is readable cross-origin and
  `Content-Disposition` is exposed.
- **Source:** ARCHITECTURE.md §3.3 ("CORS exposes `Content-Disposition`"); PROGRESS.md M6
- **Setup:** `dataset_s`
- **Steps → Expected:** `GET /history/export?tz=Europe/Athens` with
  `Origin: http://localhost:5173` → 200, `access-control-allow-origin ==
  "http://localhost:5173"`, and `"content-disposition" in [h.strip().lower() for h in
  access-control-expose-headers.split(",")]`.
- **Type:** unit

- **ID** M6-cors-02
- **Behavior:** An unknown origin gets no CORS grant on the export.
- **Source:** ARCHITECTURE.md (CORS restricted to `CORS_ORIGINS`); M1-cors-02
- **Setup:** `dataset_s`
- **Steps → Expected:** `Origin: http://evil.example` → there is no
  `access-control-allow-origin` header (and no `access-control-expose-headers`).
- **Type:** unit
- **Note (healer, user decision 2026-10-03):** the "no expose-headers" clause is dropped.
  Starlette adds `access-control-expose-headers` and `-allow-credentials` for every
  origin; without allow-origin the browser ignores them, so they grant nothing. Only
  the absent allow-origin is asserted.

- **ID** M6-cors-03
- **Behavior:** CORS headers are also on error responses from the frontend origin, so
  the browser can read the `detail`.
- **Source:** ARCHITECTURE.md §4.1 (errors show "the backend's `detail`")
- **Setup:** none
- **Steps → Expected:** `GET /history/export?tz=Mars/Base` with
  `Origin: http://localhost:5173` → 400 and
  `access-control-allow-origin == "http://localhost:5173"`.
- **Type:** unit

### Dependencies

- **ID** M6-deps-01
- **Behavior:** `tzdata` is pinned in `requirements.txt` and installed, so zones resolve
  without a system tz database.
- **Source:** PROGRESS.md M6 ("`tzdata==2026.5` added … Windows has no system tz
  database")
- **Setup:** none
- **Steps → Expected:** `requirements.txt` has a line matching `^tzdata==\d{4}\.\d+$`.
  `importlib.metadata.version("tzdata")` equals the pinned version. With
  `zoneinfo.reset_tzpath(to=[])` (system tz path disabled, then restored),
  `ZoneInfo("Europe/Athens")` still resolves.
- **Type:** unit

### api/client.js: refactor regressions (existing calls)

- **ID** M6-api-reg-01
- **Behavior:** For every call, an unreachable backend becomes an `ApiError` with the
  can't-reach message and `status === null`.
- **Source:** ARCHITECTURE.md §4.3 (client is the only module that knows the backend;
  ApiError messages); M3-api-08
- **Setup:** `fetch` stubbed to reject with `TypeError("Failed to fetch")`
- **Steps → Expected:** `detectPeople(file)`, `getHistory()`, `clearHistory()` and
  `exportHistory()` each reject with `ApiError`. The message is
  `` `Can't reach the detection server at ${API_BASE_URL}. Is the backend running?` ``
  and `status` is `null`.
- **Type:** unit

- **ID** M6-api-reg-02
- **Behavior:** For every call, a non-OK JSON response with a string `detail` rejects
  with that detail and the HTTP status.
- **Source:** ARCHITECTURE.md §3.3 error contract; M4-api-04
- **Setup:** fetch → `jsonResponse({detail: "Invalid start_date: 'x'"}, 400)`
- **Steps → Expected:** `getHistory()`, `clearHistory()`, `detectPeople(file)` and
  `exportHistory()` reject with `message === "Invalid start_date: 'x'"` and
  `status === 400`.
- **Type:** unit

- **ID** M6-api-reg-03
- **Behavior:** A non-OK response with a non-JSON body, or a non-string `detail`, gives
  `Request failed (HTTP <status>)`.
- **Source:** M3-api-07; ARCHITECTURE.md §4.3
- **Setup:** fetch → `new Response("<html>Bad gateway</html>", {status: 502})`, and
  separately `jsonResponse({detail: [{msg: "x"}]}, 400)`
- **Steps → Expected:** for all four calls, the first case gives message
  `"Request failed (HTTP 502)"` with status 502, and the second gives
  `"Request failed (HTTP 400)"` with status 400.
- **Type:** unit

- **ID** M6-api-reg-04
- **Behavior:** An OK response whose body isn't JSON is "The server sent an unreadable
  response" for the JSON calls.
- **Source:** M3/M4 client contract (existing behavior that the refactor must keep)
- **Setup:** fetch → `new Response("not json", {status: 200})`
- **Steps → Expected:** `getHistory()`, `clearHistory()` and `detectPeople(file)` reject
  with `ApiError("The server sent an unreadable response")` and status 200.
  `getHistory()` with `jsonResponse({})` also rejects with that message (not an array).
- **Type:** unit

- **ID** M6-api-reg-05
- **Behavior:** `getHistory` builds the same URLs as before the refactor.
- **Source:** M4-api-01/02
- **Setup:** fetch → `jsonResponse([])`
- **Steps → Expected:** `getHistory()` → URL exactly `${API_BASE_URL}/history`.
  `getHistory({start_date: "2026-10-02T06:00:00.000Z", end_date: "", min_confidence: null})`
  → `${API_BASE_URL}/history?start_date=2026-10-02T06%3A00%3A00.000Z`. Neither URL
  contains `tz`.
- **Type:** unit

- **ID** M6-api-reg-06
- **Behavior:** `checkHealth` still resolves `false` (never throws) on a timeout, a
  network error, a non-OK response or a non-JSON body. It resolves `true` on
  `{status:"ok"}`.
- **Source:** ARCHITECTURE.md §3.3 `/health` (5 s timeout); M3b-health-01..05,
  M3b-status-09
- **Setup:** fake timers. fetch returns a promise that rejects when `options.signal`
  aborts (hung backend).
- **Steps → Expected:** the hung case is unsettled at 4999 ms and resolves `false` after
  5000 ms. The fetch got an `AbortSignal`, and no timer is left pending after it
  settles (`vi.getTimerCount() === 0`). Reject → `false`. 500 JSON → `false`.
  `"not json"` 200 → `false`. `{status:"ok"}` → `true`. `{status:"down"}` → `false`.
- **Type:** unit

### api/client.js: exportHistory

- **ID** M6-api-exp-01
- **Behavior:** By default it sends one GET to `/history/export` with the browser's zone
  as `tz`.
- **Source:** ARCHITECTURE.md §4.1 ("local-time column in the browser's zone");
  PROGRESS.md M6
- **Setup:** `pinTimeZone("Asia/Riyadh", …)`. fetch → CSV response.
- **Steps → Expected:** `exportHistory()` → one fetch to exactly
  `${API_BASE_URL}/history/export?tz=Asia%2FRiyadh` with method GET (or undefined
  options).
- **Type:** unit

- **ID** M6-api-exp-02
- **Behavior:** Filter params are passed through, and null or empty ones are dropped,
  as in `getHistory`.
- **Source:** ARCHITECTURE.md §3.3 ("Same … params as `/history`")
- **Setup:** fetch → CSV response
- **Steps → Expected:**
  `exportHistory({start_date: "2026-10-02T06:00:00.000Z", end_date: "", min_confidence: "0.5"}, {timeZone: "Europe/Athens"})`
  → the URL's searchParams equal
  `{start_date: "2026-10-02T06:00:00.000Z", min_confidence: "0.5", tz: "Europe/Athens"}`
  and there is no `end_date` key.
- **Type:** unit

- **ID** M6-api-exp-03
- **Behavior:** An explicit `timeZone` overrides the browser's, and an empty or null zone
  leaves `tz` out. A `tz` in `params` can't override the option.
- **Source:** client.js JSDoc contract (`timeZone` option); ARCHITECTURE.md §3.3 (tz
  optional)
- **Setup:** fetch → CSV response; the browser zone is pinned to `Asia/Riyadh`
- **Steps → Expected:** `{timeZone: "UTC"}` → `tz=UTC`. `{timeZone: ""}` and
  `{timeZone: null}` → the URL has no `tz` param (exactly
  `${API_BASE_URL}/history/export`). `exportHistory({tz: "Mars/Base"})` → `tz=Asia%2FRiyadh`.
- **Type:** unit

- **ID** M6-api-exp-04
- **Behavior:** It resolves to `{blob, filename}`, with the blob holding the exact CSV
  bytes and the filename taken from `Content-Disposition`.
- **Source:** ARCHITECTURE.md §3.3 (CORS exposes `Content-Disposition` "so the frontend
  can read the name"); PROGRESS.md M6
- **Setup:** fetch → CSV response with body `"id,timestamp_utc\r\n1,2026-10-02T09:00:00.000Z\r\n"`
  and `content-disposition: attachment; filename="detecto-history-20261003-120000.csv"`
- **Steps → Expected:** `filename === "detecto-history-20261003-120000.csv"`, `blob`
  is a `Blob`, and `await blob.text()` equals the body exactly (CRLF kept).
- **Type:** unit

- **ID** M6-api-exp-05
- **Behavior:** Without a usable `Content-Disposition` filename, the name falls back to
  `detecto-history.csv`.
- **Source:** PROGRESS.md M6 ("fallback `detecto-history.csv`")
- **Setup:** fetch → OK CSV responses with headers: (a) none, (b) `attachment`, (c)
  `attachment; filename=""`
- **Steps → Expected:** in all three, `filename === "detecto-history.csv"` and the blob
  is still returned. Unquoted `filename=x.csv` and RFC 5987 `filename*=` are left to
  OQ-9.
- **Type:** unit

- **ID** M6-api-exp-06
- **Behavior:** Error responses reject with an `ApiError` carrying the backend detail and
  status, and no blob is returned.
- **Source:** ARCHITECTURE.md §3.3 error contract; §4.1 ("error (the backend's
  `detail`)")
- **Setup:** fetch → `jsonResponse({detail: "Unknown time zone: 'Mars/Base' (expected e.g. Europe/Athens)"}, 400)`;
  then `new Response("oops", {status: 500})`; then a fetch rejection
- **Steps → Expected:** the first gives the message equal to the detail and status 400.
  The second gives `"Request failed (HTTP 500)"` and status 500. The third gives the
  can't-reach message and status null. All are `instanceof ApiError`.
- **Type:** unit

### utils/download.js: saveBlob

- **ID** M6-dl-01
- **Behavior:** `saveBlob` clicks a temporary link to an object URL of the blob, with
  `download` set to the filename, and removes the link.
- **Source:** PROGRESS.md M6 ("object URL + temporary link")
- **Setup:** `stubObjectUrls()`. Spy on `HTMLAnchorElement.prototype.click` and capture
  `this` (href, download, isConnected) at click time.
- **Steps → Expected:** `saveBlob(blob, "detecto-history-x.csv")` →
  `URL.createObjectURL` is called once with `blob`, and click is called once on an
  anchor with `href === "blob:mock/1"`, `download === "detecto-history-x.csv"` and
  `isConnected === true`. After the call returns, `document.querySelectorAll("a[download]").length === 0`.
- **Type:** unit

- **ID** M6-dl-02
- **Behavior:** The object URL is revoked after the click, on a later tick and not
  synchronously.
- **Source:** PROGRESS.md M6 ("revoked next tick")
- **Setup:** fake timers, `stubObjectUrls()`, click spy
- **Steps → Expected:** right after `saveBlob` returns, `URL.revokeObjectURL` has not
  been called. After `vi.runAllTimers()` it has been called exactly once, with
  `"blob:mock/1"`. Two consecutive saves revoke `blob:mock/1` and `blob:mock/2` (one
  each).
- **Type:** unit

### components/ExportHistoryButton.jsx

- **ID** M6-btn-01
- **Behavior:** It renders its children as a button label, and a click exports the given
  params and saves the result under the server's filename.
- **Source:** ARCHITECTURE.md §4.1; PROGRESS.md M6
- **Setup:** `vi.mock("../api/client.js")` with `exportHistory` resolving to
  `{blob: B, filename: "f.csv"}`. `saveBlob` mocked.
- **Steps → Expected:** render
  `<ExportHistoryButton params={{min_confidence: "0.5"}}>Export CSV (all 3)</ExportHistoryButton>`.
  Clicking the button named "Export CSV (all 3)" → `exportHistory` is called once with
  `{min_confidence: "0.5"}` as its first argument, then `saveBlob` is called once with
  `(B, "f.csv")`.
- **Type:** unit

- **ID** M6-btn-02
- **Behavior:** While the export is pending the button shows a busy state and can't
  start a second export. It is re-enabled afterwards.
- **Source:** PROGRESS.md M6 ("download button with busy state")
- **Setup:** `exportHistory` returns a `deferred()` promise
- **Steps → Expected:** after the click the button is disabled (or has
  `data-loading="true"`). Clicking again → `exportHistory` has still been called once.
  After resolve, the button is enabled and `saveBlob` has been called once. The same
  holds after a reject: the button is re-enabled.
- **Type:** unit

- **ID** M6-btn-03
- **Behavior:** A failure is reported through `onError(message)` and nothing is saved.
- **Source:** PROGRESS.md M6 ("errors go to an `onError` prop")
- **Setup:** `exportHistory` rejects with `new ApiError("Unknown time zone: 'X'", 400)`
- **Steps → Expected:** `onError` is last called with `"Unknown time zone: 'X'"` and
  `saveBlob` is not called.
- **Type:** unit

- **ID** M6-btn-04
- **Behavior:** An error without a message falls back to a generic message.
- **Source:** ExportHistoryButton contract (component JSDoc); consistent with the M4
  page fallback
- **Setup:** `exportHistory` rejects with `new Error("")`
- **Steps → Expected:** `onError` is last called with `"Couldn't export the history"`.
- **Type:** unit

- **ID** M6-btn-05
- **Behavior:** Starting an export clears a previous error first.
- **Source:** component JSDoc ("`onError(null)` clears a previous one")
- **Setup:** first export rejects, second resolves
- **Steps → Expected:** the `onError` calls are, in order, `[null]`, `["<msg>"]`,
  `[null]`. There is no further call after the successful second export.
- **Type:** unit

- **ID** M6-btn-06
- **Behavior:** Button props are forwarded. `disabled` prevents the export.
- **Source:** ARCHITECTURE.md §4.1 ("Disabled while loading or with no records")
- **Setup:** `exportHistory` mocked
- **Steps → Expected:** `<ExportHistoryButton disabled>` → the button is disabled, and
  clicking it calls nothing.
- **Type:** unit

### pages/HistoryView.jsx: Export CSV

- **ID** M6-view-01
- **Behavior:** With no filters applied, the button reads "Export CSV (all N)" for the N
  records shown.
- **Source:** ARCHITECTURE.md §4.1 ("The label states the scope: 'Export CSV (all N)'")
- **Setup:** `mockFetch({history})` where `/history` → `R4` (4 records)
- **Steps → Expected:** after load, a button named exactly `Export CSV (all 4)` is
  present and enabled.
- **Type:** unit

- **ID** M6-view-02
- **Behavior:** With filters applied, the label is "Export CSV (N filtered)", where N is
  the number of records the page shows.
- **Source:** ARCHITECTURE.md §4.1
- **Setup:** `/history` → R4 unfiltered, and 2 records when called with
  `min_confidence`
- **Steps → Expected:** set the minimum confidence to 70 % and click Apply → a button
  named `Export CSV (2 filtered)`. Reset filters → `Export CSV (all 4)`. Repeat with only
  a From date applied → the label also says "filtered".
- **Type:** unit

- **ID** M6-view-03
- **Behavior:** Clicking Export sends the *applied* filters as the export query, with the
  browser zone as `tz`.
- **Source:** ARCHITECTURE.md §4.1 ("exports the *applied* filters"); PROGRESS.md M6
  decision
- **Setup:** `pinTimeZone("Asia/Riyadh")`. `/history` → R4. The export route returns a
  CSV. `saveBlob` mocked.
- **Steps → Expected:** apply From = Oct 2 00:00 local and min confidence 50 %, then
  click Export. There is exactly one `/history/export` call. Its searchParams are
  `start_date=2026-10-01T21:00:00.000Z`, `min_confidence=0.5` and `tz=Asia/Riyadh`,
  identical to the start_date and min_confidence of the last `/history` call.
  `saveBlob` is called with the response's filename.
- **Type:** unit

- **ID** M6-view-04
- **Behavior:** Unapplied edits in the filter bar don't affect the export, and neither
  does the label.
- **Source:** ARCHITECTURE.md §4.1 ("not unsaved filter-bar edits")
- **Setup:** `/history` → R4, no filters applied
- **Steps → Expected:** change min confidence to 80 % without clicking Apply. The label
  still reads `Export CSV (all 4)`. Clicking it → the export URL has only `tz`, with no
  `min_confidence`.
- **Type:** unit

- **ID** M6-view-05
- **Behavior:** The button is disabled while the history is loading.
- **Source:** ARCHITECTURE.md §4.1 ("Disabled while loading")
- **Setup:** `/history` returns a `deferred()` promise
- **Steps → Expected:** on mount, before resolve, the Export button is disabled and
  clicking it makes no export fetch. After the promise resolves with R4, the button is
  enabled. Then click Apply with a deferred second query, and the button is disabled
  again until that query resolves.
- **Type:** unit

- **ID** M6-view-06
- **Behavior:** The button is disabled when there are no records, both with no data and
  with filters that match nothing.
- **Source:** ARCHITECTURE.md §4.1 ("Disabled … with no records")
- **Setup:** (a) `/history` → `[]`. (b) R4 unfiltered, then `[]` under a filter.
- **Steps → Expected:** in (a), with the "No detections yet." state, the button
  `Export CSV (all 0)` is disabled. In (b), after Apply, with the "No detections match
  these filters." state, the button `Export CSV (0 filtered)` is disabled. No export
  fetch is made in either case.
- **Type:** unit

- **ID** M6-view-07
- **Behavior:** The button is disabled when the history query failed.
- **Source:** ARCHITECTURE.md §4.1 (disabled with no records; the error state shows
  none)
- **Setup:** `/history` → `jsonResponse({detail: "boom"}, 500)`
- **Steps → Expected:** the "Couldn't load the history." alert is shown, and the Export
  button is disabled.
- **Type:** unit

- **ID** M6-view-08
- **Behavior:** A failed export shows a dismissible "Couldn't export the history." alert
  with the backend's detail. The data on the page stays as it was.
- **Source:** PROGRESS.md M6 ("errors in a dismissible 'Couldn't export the history.'
  alert"); ARCHITECTURE.md §4.1 (error shows the backend's `detail`)
- **Setup:** `/history` → R4. Export → `jsonResponse({detail: "Unknown time zone: 'Etc/Unknown'"}, 400)`.
- **Steps → Expected:** after the click, an alert with title "Couldn't export the
  history." and text "Unknown time zone: 'Etc/Unknown'" is shown. The table still has
  4 rows, the list query count is unchanged (no reload), and the "Couldn't load the
  history." alert is absent. Clicking the alert's close button removes it.
- **Type:** unit

- **ID** M6-view-09
- **Behavior:** If the backend is unreachable, the export alert shows the can't-reach
  message.
- **Source:** ARCHITECTURE.md §4.3; §4.1
- **Setup:** `/history` → R4. The export fetch rejects.
- **Steps → Expected:** the alert text starts with "Can't reach the detection server
  at".
- **Type:** unit

- **ID** M6-view-10
- **Behavior:** A later export attempt clears the previous export error. A successful
  export shows no alert and does not reload the list.
- **Source:** component contract (`onError(null)` on start); OQ-10
- **Setup:** export fails first, then succeeds
- **Steps → Expected:** after the second click the "Couldn't export the history." alert
  is gone and `saveBlob` has been called once. The number of list queries is the same as
  before the clicks.
- **Type:** unit

- **ID** M6-view-11
- **Behavior:** After Clear history completes, the export button shows the new empty
  scope and is disabled.
- **Source:** ARCHITECTURE.md §4.1 (clear resets filters and reloads unfiltered;
  disabled with no records)
- **Setup:** `/history` → R4 then `[]`. `/reset` → `{status: "cleared", count_removed: 4}`.
- **Steps → Expected:** after confirming the delete, the button `Export CSV (all 0)`
  is disabled.
- **Type:** unit

### components/ClearHistoryButton.jsx: "Download a copy first (CSV)"

- **ID** M6-clear-01
- **Behavior:** When there are records to delete, the dialog offers "Download a copy first
  (CSV)".
- **Source:** ARCHITECTURE.md §4.1
- **Setup:** `/history` (unfiltered count) → R4
- **Steps → Expected:** open Clear history. Once counted, the dialog contains a button
  named `Download a copy first (CSV)`, and it is enabled.
- **Type:** unit

- **ID** M6-clear-02
- **Behavior:** The dialog link exports *all* records, with no filters even when the page
  has filters applied, and it includes the browser's zone.
- **Source:** ARCHITECTURE.md §4.1 ("exports *all* records, matching the scope of the
  delete")
- **Setup:** HistoryView with min confidence 50 % and a From date applied.
  `pinTimeZone("Asia/Riyadh")`. The export route returns a CSV. `saveBlob` mocked.
- **Steps → Expected:** open Clear history and click "Download a copy first (CSV)". There
  is exactly one export fetch, to `${API_BASE_URL}/history/export?tz=Asia%2FRiyadh`, with
  no `start_date`, `end_date` or `min_confidence`. `saveBlob` is called with the
  server filename.
- **Type:** unit

- **ID** M6-clear-03
- **Behavior:** Downloading a copy doesn't delete anything and doesn't close the dialog.
- **Source:** ARCHITECTURE.md §4.1 ("Download a copy *first*"); README ("The clear
  dialog offers a CSV download first")
- **Setup:** as M6-clear-01, with `reset` routed to a spy
- **Steps → Expected:** after the download completes, the `/reset` spy has 0 calls,
  the dialog is still open, and "Delete all 4 records" is present and enabled. The page
  shows no "Deleted …" notice.
- **Type:** unit

- **ID** M6-clear-04
- **Behavior:** A failed download shows its error inside the dialog, not on the page.
  The delete is still possible.
- **Source:** ARCHITECTURE.md §4.1; PROGRESS.md M6 ("errors show in the dialog")
- **Setup:** export → `jsonResponse({detail: "Disk on fire"}, 500)`
- **Steps → Expected:** `within(dialog)` contains the text "Disk on fire". The page has
  no alert titled "Couldn't export the history.". The dialog stays open,
  "Delete all 4 records" is enabled, and `/reset` has 0 calls.
- **Type:** unit

- **ID** M6-clear-05
- **Behavior:** While a delete is in progress, the download link is disabled.
- **Source:** PROGRESS.md M6; consistent with M4-clear-08 (the dialog can't be acted
  on while deleting)
- **Setup:** `/reset` returns a `deferred()` promise
- **Steps → Expected:** click "Delete all 4 records". Before it resolves, "Download a
  copy first (CSV)" is disabled and clicking it makes no export fetch.
- **Type:** unit

- **ID** M6-clear-06
- **Behavior:** There is no download link while counting, when the count failed, or when
  the history is already empty.
- **Source:** ARCHITECTURE.md §4.1 (the link sits with the delete scope); OQ-7
- **Setup:** (a) count pending (deferred). (b) count → 500. (c) count → `[]`.
- **Steps → Expected:** in all three, `queryByRole("button", {name: /download a copy/i})`
  is null.
- **Type:** unit

- **ID** M6-clear-07
- **Behavior:** After a successful download, confirming the delete still works normally.
- **Source:** ARCHITECTURE.md §4.1 (delete flow unchanged)
- **Setup:** export → CSV. `/reset` → `{status: "cleared", count_removed: 4}`.
- **Steps → Expected:** download, then click "Delete all 4 records". One DELETE is sent,
  the dialog closes, "Deleted 4 records." is shown and the reload is unfiltered.
- **Type:** unit

### Manual checks: real browser download (sandbox only)

**Never touch the user's backend on :8000 or `backend/detecto.db`.** Sandbox setup:
```
SB=/tmp/claude-1000/-home-patou-Desktop-detecto/<session>/scratchpad
DB_PATH=$SB/m6-sandbox.db CORS_ORIGINS=http://localhost:5174 WARMUP_MODEL=false \
  backend/.venv/bin/uvicorn backend.main:app --port 8001
# seed: POST 3+ sample images to http://localhost:8001/detect, with at least one dated so a
# filter can exclude it (or seed the sandbox DB with SQLiteStorage), and >=1 zero-person record
cd frontend && VITE_API_BASE_URL=http://localhost:8001 npx vite --port 5174 --strictPort
```
Check first that `curl -s localhost:8001/history | jq length` matches what was seeded,
and that `backend/detecto.db`'s mtime is unchanged at the end.

- **ID** M6-man-01
- **Behavior:** In Chrome, Export CSV downloads a file named `detecto-history-<UTC
  stamp>.csv`, not "export" or "download.csv". This shows that the exposed header is
  readable cross-origin (5174 → 8001).
- **Source:** ARCHITECTURE.md §3.3, §4.1
- **Setup:** sandbox above, History page at http://localhost:5174
- **Steps → Expected:** click "Export CSV (all N)" → one file appears in Downloads. Its
  name matches `detecto-history-\d{8}-\d{6}\.csv`, and the stamp is the current UTC time
  (±1 min). DevTools Network shows one `GET :8001/history/export?tz=<browser zone>`
  returning 200, with `Access-Control-Expose-Headers: Content-Disposition`.
- **Type:** e2e (manual)

- **ID** M6-man-02
- **Behavior:** The file opens in a spreadsheet with the right columns and values. The
  local times match what the History table shows.
- **Source:** README "It opens in Excel"; ARCHITECTURE.md §3.3
- **Setup:** the file from M6-man-01
- **Steps → Expected:** `file` reports CSV text with CRLF line terminators. Opening it in
  LibreOffice Calc (or Excel) gives 6 columns with header
  `id,timestamp_utc,timestamp_local,person_count,average_confidence,inference_time_ms`
  and N data rows, oldest first. For each row, the `timestamp_local` wall time equals
  the History table time for that id, and `person_count` equals the table count.
- **Type:** e2e (manual)

- **ID** M6-man-03
- **Behavior:** With filters applied, the label says "(K filtered)" and the file holds
  exactly those K records. Unapplied edits are ignored.
- **Source:** ARCHITECTURE.md §4.1
- **Setup:** sandbox. Apply a From date that excludes at least one record and a min
  confidence above at least one non-zero record.
- **Steps → Expected:** the label "Export CSV (K filtered)" equals the table row count.
  The downloaded file has K data rows with the same ids. Then change the slider without
  clicking Apply and export again: the file still has the same K rows.
- **Type:** e2e (manual)

- **ID** M6-man-04
- **Behavior:** The clear dialog's link downloads all records and deletes nothing.
- **Source:** ARCHITECTURE.md §4.1
- **Setup:** sandbox, with filters still applied from M6-man-03
- **Steps → Expected:** open Clear history and click "Download a copy first (CSV)". The
  file has all N records (N = `curl :8001/history | jq length`). The dialog is still
  open, and `curl :8001/history | jq length` is still N. Cancel the dialog. Optionally,
  confirm the delete on the sandbox only → the page shows "Deleted N records." and
  Export is disabled with "(all 0)".
- **Type:** e2e (manual)

- **ID** M6-man-05
- **Behavior:** With the backend stopped, Export shows the can't-reach error alert, and
  no file is downloaded.
- **Source:** ARCHITECTURE.md §4.3; PROGRESS.md M6
- **Setup:** sandbox with records loaded. Stop the :8001 uvicorn.
- **Steps → Expected:** click Export → the "Couldn't export the history." alert says
  "Can't reach the detection server at http://localhost:8001…". Downloads is
  unchanged. Closing the alert removes it.
- **Type:** e2e (manual)

## Regression

Re-run the full existing suites (`backend/.venv/bin/pytest -m "not integration"` and then
the integration marker separately; `cd frontend && npx vitest run`). Re-check these in
particular:

- **`/history` after the `parse_filters()` extraction:** all of `test_history.py`
  (M2-hist-01..06, M2-hist-err-01..06), plus `test_history_frontend_format.py`.
  `/history` must still return JSON (not CSV), and `/history?tz=Mars/Base` stays 200
  (the unknown param is ignored, so `/history` gains no `tz` validation).
- **`/reset`** (M2-reset tests): unaffected, and still the only deleting route.
- **CORS:** `test_cors.py` (M1-cors-01/02, M2-cors-01, M3b-cors-01). Adding
  `expose_headers` must not loosen the allowed origins.
- **Docs tests:** `test_docs.py` and `test_readme.py`, since README and ARCHITECTURE
  changed (the endpoint list and the file tree now include `/history/export`,
  `ExportHistoryButton.jsx` and `download.js`).
- **Real DB untouched:** the session guard `real_db_untouched` (M2-reg-01) must pass.
- **Frontend client:** `client.test.js` (M3-api-01..08), `client.history.test.js`
  (M4-api-01..06), `client.health.test.js` (M3b-health-01..05, M3b-status-09). The
  refactor touched `request()` for all of them.
- **History page:** `HistoryView.test.jsx` (M4-view-01..11, latest-request-wins),
  `HistoryView.tz.test.jsx`, `HistoryView.clear.test.jsx` (M4-clear-01..11),
  `ClearHistoryButton.test.jsx`, and `App.history.test.jsx`. The header now holds two
  buttons in a `Group`. Queries like `getByRole("button", {name: /clear history/i})`
  must still be unique. "Download a copy first (CSV)" must not match existing
  `/delete/i` or `/clear/i` queries, and the extra export calls through the
  `/history` route in `mockFetch` must not inflate counts in M4-view-01 or M4-clear-01.
- **Build:** `cd frontend && npx vite build` succeeds. `utils/history.js` is now imported
  by `api/client.js`, so check that there is no circular import.

## Open questions

- **OQ-1: Non-IANA and legacy zone keys are accepted.** The spec says `tz` is an "IANA
  name, e.g. `Europe/Athens`; unknown → `400`". The code accepts anything `zoneinfo` can
  load. That includes `localtime` (it resolves to the *server's* `/etc/localtime`; here
  that gave `+03:00`), `posixrules`, `Factory`, `EST5EDT`, `Etc/GMT+3` and `US/Pacific`.
  It matters because `tz=localtime` makes the export depend on the server machine and
  reveals its zone. Should the API restrict keys to `zoneinfo.available_timezones()`
  (or reject `localtime`/`posixrules`/`Factory` explicitly), or accept every loadable key?
- **OQ-2: Zero-offset local times are written as `Z`.** The spec says "`…Z` for UTC,
  `…+03:00` for local". `iso_millis()` replaces `+00:00` with `Z` in both columns, so
  `tz=UTC`, `GMT`, `Africa/Abidjan`, and `Europe/London` in winter
  (`2026-01-15T12:00:00.000Z`) show a local column that looks identical to the UTC one.
  It matters because a reader can't tell "local time in London" from "UTC". Should
  `timestamp_local` always use a numeric offset (`+00:00`)? M6-exp-tz-05 asserts only
  the instant until this is decided.
- **OQ-3: Milliseconds are truncated, not rounded.** The spec says "ISO 8601 with
  milliseconds". The code truncates (`isoformat(timespec="milliseconds")`), so
  `23:59:59.999999` becomes `23:59:59.999Z`. Rounding would give `00:00:00.000` of the
  *next day* and move the record across a date boundary, which disagrees with the
  `/history` filters. The plan (M6-exp-04, tz-02) expects truncation. Please confirm.
- **OQ-4: The number format is unspecified.** The spec only says "every cell is a
  number". The code writes Python `repr`: unrounded (`0.123456789`), always with a
  decimal (`0.0`, `20.0`), and in scientific notation for tiny values (`1e-07`). Should
  `average_confidence` and `inference_time_ms` be rounded or fixed-point (e.g. 4 and 1
  decimals) for spreadsheet readability? The tests assert values only, not text.
- **OQ-5: The label count can go stale against the file.** The spec says "The label
  states the scope: 'Export CSV (all N)'". N is the count from the last page load, but
  the export re-queries at click time. Unfiltered or open-ended exports therefore include
  detections made since the load, so "all 4" can download 5 rows. Is that acceptable, or
  should the label avoid the number, or the page refresh before exporting?
- **OQ-6: Delete is not blocked while the copy is downloading.** §4.1 says "Download a
  copy first". In the code, the dialog's Delete button stays enabled while the dialog
  export is in flight. Clicking Delete immediately could run `/reset` before the export
  query reads the rows (both run in the server's threadpool), giving an empty or partial
  copy. Should Delete (and Cancel) be disabled until the download finishes?
- **OQ-7: There is no download link for an empty history or a failed count.** The spec
  says "The dialog also offers **Download a copy first (CSV)**" and is silent on the
  empty or failed states. The code shows the link only when the count is > 0.
  M6-clear-06 assumes it is hidden in those states. Please confirm.
- **OQ-8: Error precedence is unspecified.** The spec doesn't say which error wins when
  both a filter and `tz` are invalid. The code validates filters first (the
  `start_date` message wins over the tz one). M6-exp-err-03 asserts only a 400. Should
  one be pinned?
- **OQ-9: Filename parsing only handles quoted `filename="…"`.** The spec says the name
  comes from `Content-Disposition`, with fallback `detecto-history.csv`. The regex
  `filename="([^"]+)"` ignores unquoted `filename=x.csv` and RFC 6266 `filename*=UTF-8''…`,
  and falls back to the generic name. The server always quotes today, so this only
  matters if a proxy rewrites the header or the name ever changes. Should those forms be
  supported?
- **OQ-10: Should starting an export clear unrelated dialog errors?** The component calls
  `onError(null)` at the start of every export. In the clear dialog `onError` is the
  dialog's shared `setError`, so clicking "Download a copy first" also wipes an earlier
  *delete* failure message. The spec is silent. Should the dialog keep separate error
  slots?
- **OQ-11: There is no UTF-8 BOM.** The README says "It opens in Excel". The body has no
  BOM. That is harmless today because it is all ASCII, but Excel on Windows guesses the
  encoding without one. Is ASCII-only content a guarantee, or should a BOM be added for
  future non-ASCII columns?
- **OQ-12: The bad `tz` value is echoed in the error detail.** The spec only says
  `unknown → 400`. The code echoes the full raw value via `repr()` in `detail`, which the
  UI shows as-is. A 2000-char `tz` produces a 2000+ char alert, and control characters
  appear escaped. Should the echoed value be truncated (M6-exp-tz-08 proposes ≤ 400 chars
  total), or not echoed?
- **OQ-13: What happens when the browser reports an unrecognised zone?** The spec says
  the export uses "a local-time column in the browser's zone", and an unknown `tz` →
  400. If `Intl…timeZone` returns a value the server's tzdata lacks (e.g. `Etc/Unknown`
  on a misconfigured machine, or a zone newer than `tzdata==2026.5`), the whole export
  fails with a 400 instead of degrading to UTC-only. Should the frontend retry without
  `tz`, or the backend omit the column, or is failing correct?

## Resolved decisions (user, 2026-10-03: "go with recommendations")

The app has been changed to match; ARCHITECTURE.md §3.3/§4.1 are updated. These
**override** the case bodies above where they differ.

- **OQ-1:** `tz` must be in `zoneinfo.available_timezones()` minus `localtime`,
  `posixrules`, `Factory`; anything else → 400. This also fixes the M6-exp-tz-07 500s
  (`Europe`, `America`, > 255 chars). Add rows: `localtime`, `posixrules`, `Factory` → 400;
  legacy-but-listed keys (`Asia/Calcutta`, `US/Pacific`, `Etc/GMT+3`) → 200.
- **OQ-2:** `timestamp_local` always has a numeric offset (`+00:00` for zero offsets, never
  `Z`); `timestamp_utc` keeps `Z`. M6-exp-tz-05 should assert the exact text, e.g.
  `Europe/London`, `2026-01-15T12:00:00.000+00:00`.
- **OQ-3:** milliseconds are truncated (confirmed).
- **OQ-4:** `average_confidence` = `round(x, 4)`, `inference_time_ms` = `round(x, 1)`
  (Python `round`, written with `str`), e.g. `0.123456789` → `0.1235`, `150.2777` → `150.3`,
  `1e-07` → `0.0`. Assert the text.
- **OQ-5:** labels have no count: "Export CSV (all)" / "Export CSV (filtered)".
- **OQ-6:** while the dialog's download runs, Delete and Cancel are disabled and the
  dialog can't be closed (X / Escape / overlay); they re-enable when it finishes or fails.
  `ExportHistoryButton` has a new `onBusyChange(bool)` prop (true at start, false at end).
- **OQ-7:** the link is shown only when the count is > 0 (confirmed; M6-clear-06 stands).
- **OQ-8:** filters are validated first: with an invalid filter and an invalid `tz`, the
  filter's message is the detail. Pin it in M6-exp-err-03.
- **OQ-9:** only the quoted `filename="…"` form is parsed (confirmed, no change).
- **OQ-10:** the dialog has a separate export error alert (title "Couldn't download the
  copy."); starting a download clears only that one, not a count/delete error.
- **OQ-11:** no BOM (ASCII only; noted in the endpoint docstring).
- **OQ-12:** the echoed value is cut to 64 characters plus "…" inside the `repr` quotes.
  M6-exp-tz-08: detail ≤ 120 chars for a 2000-char `tz`.
- **OQ-13:** an unknown browser zone fails with the 400 message (confirmed, no fallback).
