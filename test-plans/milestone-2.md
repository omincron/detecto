# Test plan — Milestone 2: Storage (SQLite, `/history`, `/reset`, persistence from `/detect`)

## Scope

Milestone 2 (uncommitted on top of `4e4acbe`) added:
- `backend/models/record.py`: `DetectionRecord` (id, timestamp, count, average_confidence, inference_time_ms), `ResetResponse`, and `CREATE_DETECTIONS_TABLE` (the §3.4 schema plus an index on `timestamp`).
- `backend/services/storage.py`: `SQLiteStorage` with `save` / `list(HistoryFilters)` / `clear`, timestamp helpers, and the `get_storage()` dependency (reads `config.DB_PATH` per call).
- `backend/routes/history.py`: `GET /history` (`start_date`, `end_date`, `min_confidence`) and `DELETE /reset`.
- `backend/routes/detect.py`: saves one record per successful detection (a failed save is logged and does not fail the request), and writes one `INFO` log line per detection.
- `backend/main.py`: registers the history router. A global `RequestValidationError` handler returns `400 {"detail": "<string>"}` instead of FastAPI's 422.
- `backend/config.py`: a relative `DB_PATH` resolves from the project root.

**In scope:** the storage service against a temp SQLite file, `/history` filters and errors, `/reset`, the side effects of `/detect` on storage, the global 400 validation handler, `DB_PATH` resolution, CORS for the new routes, and a small real-model integration check.

**Out of scope:** the frontend (M3–M4), the base64 `/detect` input (deferred), bonus features (stats, CSV export), and concurrency or load on SQLite.

**Conventions for the generator:**
- Reuse `backend/tests/conftest.py`. The autouse `isolated_config` fixture points `config.DB_PATH` at `tmp_path / "test.db"` for every test, so `get_storage()` and the `client` fixture use a fresh DB. Use `fake_detector` (2 detections at 0.9 / 0.6, `inference_time_ms=12.5`) for `/detect` tests. Use the image builders in `backend/tests/helpers.py`.
- **Seeding:** insert records directly with `get_storage().save(DetectionRecord(...))` and explicit timezone-aware timestamps. Do not rely on wall-clock time, except in the `/detect` persistence cases.
- **Standard dataset S** (counts are unique, so the generator can identify records by `count`). Insert them in the order R5, R1, R3, R2, R4, so insertion order is not chronological:

  | Rec | timestamp (UTC) | count | average_confidence | inference_time_ms |
  |---|---|---|---|---|
  | R1 | 2026-10-01T23:59:59.999999Z | 1 | 0.50 | 10.0 |
  | R2 | 2026-10-02T00:00:00Z | 2 | 0.80 | 20.0 |
  | R3 | 2026-10-02T12:00:00Z | 0 | 0.00 | 30.0 |
  | R4 | 2026-10-02T23:59:59.999999Z | 4 | 0.70 | 40.0 |
  | R5 | 2026-10-03T00:00:00Z | 3 | 1.00 | 50.0 |

  "→ counts [a, b, …]" below means: `200`, and `[r["count"] for r in body]` equals that list, in that order.
- **URL-encode** the `+` in offsets (`%2B`). Otherwise it decodes to a space.
- **Error body:** the response is JSON and `body == {"detail": <non-empty str>}`, as in the M1 plan. Wherever a case says "400", it never means 422.
- Integration cases are marked `@pytest.mark.integration`.
- All open questions were resolved by the user on 2026-10-02 (see "Resolved decisions" at the end). Cases tagged **[OQ-n]** encode those decisions. Some need app changes that haven't been made yet (OQ-1, OQ-2, OQ-4, OQ-5), so those tests are expected to fail until the app is fixed. Do not skip them or mark them xfail.

## Test cases

### services/storage.py (unit, temp SQLite file)

- **ID** M2-storage-01
- **Behavior:** The table is created on first use and matches the §3.4 schema.
- **Source:** ARCHITECTURE.md §3.4, §3.1 (`models/record.py` is the single source of the schema)
- **Setup:** `SQLiteStorage(str(tmp_path / "a" / "b" / "h.db"))`, where the directories do not exist.
- **Steps → Expected:** `list()` returns `[]`. The file exists afterwards. `PRAGMA table_info(detections)` gives exactly these columns: `id INTEGER` (pk), `timestamp TEXT NOT NULL`, `person_count INTEGER NOT NULL`, `average_confidence REAL NOT NULL`, `inference_time_ms REAL NOT NULL`. The table's SQL in `sqlite_master` contains `AUTOINCREMENT`.
- **Type:** unit

- **ID** M2-storage-02
- **Behavior:** `save` returns the record with a newly assigned integer id and its fields unchanged. Ids increase with each save.
- **Source:** ARCHITECTURE.md §3.1 (`save(record)`), §3.4
- **Setup:** Empty storage. Two `DetectionRecord`s with `id=None`.
- **Steps → Expected:** Each returned record has an `int` id, and the second id is greater than the first. `timestamp`, `count`, `average_confidence` and `inference_time_ms` equal the inputs.
- **Type:** unit

- **ID** M2-storage-03
- **Behavior:** Timestamps round-trip as timezone-aware UTC with microsecond precision. A naive input is taken as UTC, and an offset input is converted to UTC.
- **Source:** PROGRESS.md M2 "Decisions: Timestamps"; ARCHITECTURE.md §3.3 (`timestamp` is UTC)
- **Setup:** Save three records: `2026-10-02T12:00:00.123456+00:00`, naive `2026-10-02T13:00:00`, and `2026-10-02T16:00:00+02:00`.
- **Steps → Expected:** `list()` timestamps are `12:00:00.123456`, `13:00:00` and `14:00:00` on 2026-10-02. All have `utcoffset() == timedelta(0)`.
- **Type:** unit

- **ID** M2-storage-04
- **Behavior:** `list()` returns records oldest first, whatever the insertion order.
- **Source:** ARCHITECTURE.md §3.3 ("oldest first")
- **Setup:** Dataset S.
- **Steps → Expected:** The counts in order are `[1, 2, 0, 4, 3]`.
- **Type:** unit

- **ID** M2-storage-05
- **Behavior:** `HistoryFilters` applies an inclusive start, an exclusive end and an inclusive `min_confidence`, combined with AND.
- **Source:** ARCHITECTURE.md §3.3; PROGRESS.md M2 decisions
- **Setup:** Dataset S. Parametrize:
  - `start=2026-10-02T00:00Z` → `[2, 0, 4, 3]`
  - `end=2026-10-03T00:00Z` → `[1, 2, 0, 4]`
  - `min_confidence=0.7` → `[2, 0, 4, 3]` (zero-person records are always kept, OQ-4)
  - `start=2026-10-02T00:00Z, end=2026-10-03T00:00Z, min_confidence=0.75` → `[2, 0]`
- **Steps → Expected:** The counts are as listed.
- **Type:** unit

- **ID** M2-storage-06
- **Behavior:** `clear()` deletes every record and returns how many it removed.
- **Source:** ARCHITECTURE.md §3.1 (`clear()`), §3.3 `/reset`
- **Setup:** Dataset S.
- **Steps → Expected:** The first `clear()` returns `5` and `list() == []`. A second `clear()` returns `0`.
- **Type:** unit

- **ID** M2-storage-07
- **Behavior:** Data persists on disk across storage instances, so it survives a restart.
- **Source:** instructions.md "Backend" ("Store results locally"); ARCHITECTURE.md §1 (SQLite)
- **Setup:** Save 2 records with `SQLiteStorage(p)`.
- **Steps → Expected:** A new `SQLiteStorage(p)` returns the same 2 records, with the same ids, from `list()`.
- **Type:** unit

### GET /history — results and filters

- **ID** M2-hist-01
- **Behavior:** An empty store returns an empty array.
- **Source:** ARCHITECTURE.md §3.3
- **Setup:** Fresh temp DB. The file does not exist yet.
- **Steps → Expected:** `GET /history` → `200`, body `[]`.
- **Type:** unit

- **ID** M2-hist-02
- **Behavior:** Each record has exactly the documented fields and types, and `timestamp` is UTC ISO 8601 ending in `Z`.
- **Source:** ARCHITECTURE.md §3.3 (Output); instructions.md "AI & Processing" (timestamp, number of people, average confidence)
- **Setup:** Dataset S.
- **Steps → Expected:** `200`, 5 items. Each item's key set is `{"id","timestamp","count","average_confidence","inference_time_ms"}`. `id` and `count` are int. The other two numbers are numeric. `timestamp` ends with `"Z"`, and `datetime.fromisoformat(timestamp)` equals the seeded UTC instant. The values for R2 are `count == 2`, `average_confidence == 0.8` and `inference_time_ms == 20.0`.
- **Type:** unit

- **ID** M2-hist-03
- **Behavior:** Records are returned oldest first.
- **Source:** ARCHITECTURE.md §3.3; PROGRESS.md M2 "Order"
- **Setup:** Dataset S, inserted out of order.
- **Steps → Expected:** `GET /history` → counts `[1, 2, 0, 4, 3]`. The timestamps are non-decreasing.
- **Type:** unit

- **ID** M2-hist-04
- **Behavior:** A date-only `start_date` is inclusive from 00:00 UTC that day.
- **Source:** ARCHITECTURE.md §3.3
- **Setup:** Dataset S.
- **Steps → Expected:** `?start_date=2026-10-02` → counts `[2, 0, 4, 3]` (R2 at exactly 00:00:00Z is included, and R1 is excluded).
- **Type:** unit

- **ID** M2-hist-05
- **Behavior:** A date-only `end_date` includes the whole day, up to 23:59:59.999999 UTC, and excludes the next midnight.
- **Source:** ARCHITECTURE.md §3.3; PROGRESS.md M2 "Date filters"
- **Setup:** Dataset S.
- **Steps → Expected:** `?end_date=2026-10-02` → counts `[1, 2, 0, 4]` (R4 is included and R5 is excluded).
- **Type:** unit

- **ID** M2-hist-06
- **Behavior:** The same date for `start_date` and `end_date` selects exactly that UTC day. This is not an error.
- **Source:** ARCHITECTURE.md §3.3 (a date-only end covers the whole day, so start < end)
- **Setup:** Dataset S.
- **Steps → Expected:** `?start_date=2026-10-02&end_date=2026-10-02` → counts `[2, 0, 4]`.
- **Type:** unit

- **ID** M2-hist-07
- **Behavior:** A datetime `start_date` is inclusive and a datetime `end_date` is exclusive, at exact boundaries.
- **Source:** ARCHITECTURE.md §3.3
- **Setup:** Dataset S.
- **Steps → Expected:**
  - `?start_date=2026-10-02T12:00:00Z` → `[0, 4, 3]`.
  - `?end_date=2026-10-02T12:00:00Z` → `[1, 2]`.
  - `?end_date=2026-10-03T00:00:00Z` → `[1, 2, 0, 4]`.
- **Type:** unit

- **ID** M2-hist-08
- **Behavior:** A datetime without a timezone is taken as UTC.
- **Source:** ARCHITECTURE.md §3.3 ("A value without a timezone is taken as UTC")
- **Setup:** Dataset S.
- **Steps → Expected:** `?start_date=2026-10-02T12:00` → `[0, 4, 3]`, the same as with `Z`. `?start_date=2026-10-02T12:00:00` gives the same result.
- **Type:** unit

- **ID** M2-hist-09
- **Behavior:** A datetime with a UTC offset is converted to UTC before filtering.
- **Source:** ARCHITECTURE.md §3.3 (`…+02:00` accepted)
- **Setup:** Dataset S.
- **Steps → Expected:**
  - `?start_date=2026-10-02T14:00:00%2B02:00` (= 12:00Z) → `[0, 4, 3]`.
  - `?end_date=2026-10-02T02:00%2B02:00` (= 00:00Z, exclusive) → `[1]`.
  - `?start_date=2026-10-02T07:00-05:00` (= 12:00Z) → `[0, 4, 3]`.
- **Type:** unit

- **ID** M2-hist-10
- **Behavior:** Date plus time-of-day filtering works for a window inside one day. This is the History view's "time" filter.
- **Source:** instructions.md "History View" (filters: date, time); ARCHITECTURE.md §3.3
- **Setup:** Dataset S.
- **Steps → Expected:** `?start_date=2026-10-02T06:00Z&end_date=2026-10-02T18:00Z` → `[0]`.
- **Type:** unit

- **ID** M2-hist-11
- **Behavior:** `min_confidence` keeps records whose average confidence is ≥ the value, inclusive at the boundary. Records with `count == 0` are always kept, whatever the threshold (OQ-4).
- **Source:** ARCHITECTURE.md §3.3; PROGRESS.md M2 "`min_confidence`"; instructions.md "History View" (confidence threshold)
- **Setup:** Dataset S. Parametrize:
  - `0` → `[1, 2, 0, 4, 3]`
  - `0.5` → `[1, 2, 0, 4, 3]`
  - `0.7` → `[2, 0, 4, 3]`
  - `0.71` → `[2, 0, 3]`
  - `1` → `[0, 3]`
- **Steps → Expected:** The counts are as listed. R3 (count 0, average 0.0) appears at every threshold. **[OQ-4]**
- **Type:** unit

- **ID** M2-hist-12
- **Behavior:** All three filters combine with AND.
- **Source:** ARCHITECTURE.md §3.3
- **Setup:** Dataset S.
- **Steps → Expected:** `?start_date=2026-10-02&end_date=2026-10-02&min_confidence=0.75` → `[2, 0]` (R3 is kept as a zero-person record, OQ-4).
- **Type:** unit

- **ID** M2-hist-13
- **Behavior:** A date or datetime range that matches nothing returns an empty array, not an error.
- **Source:** ARCHITECTURE.md §3.3
- **Setup:** Dataset S.
- **Steps → Expected:** `?start_date=2027-01-01` → `200`, `[]`. `?end_date=2026-01-01` → `200`, `[]`.
- **Type:** unit

- **ID** M2-hist-14
- **Behavior:** `/history` is read-only: querying does not change the stored records.
- **Source:** ARCHITECTURE.md §3.3 (`GET`)
- **Setup:** Dataset S.
- **Steps → Expected:** Call `GET /history?min_confidence=0.9` and then `GET /history`. The second call returns all 5 records with the same ids.
- **Type:** unit

### GET /history — errors

- **ID** M2-hist-err-01
- **Behavior:** An unparseable `start_date` or `end_date` returns 400 with a string detail that names the parameter.
- **Source:** ARCHITECTURE.md §3.3 Errors ("400 for an unparseable date"); §3.2 ("clear message")
- **Setup:** Dataset S. For each of `start_date` and `end_date`, parametrize the values `not-a-date`, `2026-13-01`, `2026-02-30`, `2026-10-02T25:00`, `02/10/2026` and `2026-10`.
- **Steps → Expected:** `400`, error body, and `detail` contains the parameter name.
- **Type:** unit

- **ID** M2-hist-err-02
- **Behavior:** A range where `start_date` ≥ `end_date` returns 400.
- **Source:** ARCHITECTURE.md §3.3 Errors (`start_date ≥ end_date`)
- **Setup:** Dataset S. Parametrize:
  - `start_date=2026-10-03&end_date=2026-10-02`
  - `start_date=2026-10-02T12:00Z&end_date=2026-10-02T12:00Z` (equal)
  - `start_date=2026-10-02T12:00Z&end_date=2026-10-02T11:59Z`
  - `start_date=2026-10-02T14:00%2B02:00&end_date=2026-10-02T12:00Z` (equal after conversion)
- **Steps → Expected:** `400`, error body.
- **Type:** unit

- **ID** M2-hist-err-03
- **Behavior:** A non-numeric `min_confidence` returns 400 with a string detail. It never returns 422.
- **Source:** ARCHITECTURE.md §3.3 Errors ("unparseable … number") and "All endpoints"
- **Setup:** Parametrize `abc` and `0.5.5`.
- **Steps → Expected:** `400`, error body (`detail` is a `str`, not a list), and `detail` contains `min_confidence`.
- **Type:** unit

- **ID** M2-hist-err-04
- **Behavior:** A `min_confidence` outside 0–1 returns 400. The bounds 0 and 1 are valid.
- **Source:** ARCHITECTURE.md §3.3 Errors
- **Setup:** Parametrize `-0.01`, `1.01`, `2`, `nan` and `inf`.
- **Steps → Expected:** `400`, error body. (`0` and `1` → `200`, as in M2-hist-11.)
- **Type:** unit

- **ID** M2-hist-err-05
- **Behavior:** Empty query-parameter values are handled the same way for all three filters. **[OQ-1]**
- **Source:** Spec silent; see OQ-1
- **Setup:** Dataset S. Requests: `?start_date=`, `?end_date=` and `?min_confidence=`.
- **Steps → Expected:** Each returns `200` and all 5 records, as if the parameter were absent. Also `?start_date=&end_date=&min_confidence=` together → all 5.
- **Type:** unit

- **ID** M2-hist-err-06
- **Behavior:** Extreme but valid dates never cause a 500. **[OQ-2]**
- **Source:** ARCHITECTURE.md §3.3 (only 400 is documented for `/history`); see OQ-2
- **Setup:** Dataset S.
- **Steps → Expected:**
  - `?end_date=9999-12-31` → `200`, all 5 records.
  - `?start_date=0999-01-01` → `200`, all 5 records.
  - `?start_date=0001-01-01T00:00%2B01:00` → `400` with an error body. The value is before the earliest representable UTC instant.
  - In no case is the status `500`.
- **Type:** unit

### DELETE /reset

- **ID** M2-reset-01
- **Behavior:** `/reset` removes every record and reports how many it removed.
- **Source:** instructions.md "Backend" (`/reset` clears stored history); ARCHITECTURE.md §3.3
- **Setup:** Dataset S.
- **Steps → Expected:** `DELETE /reset` → `200`, body exactly `{"status": "cleared", "count_removed": 5}`. Then `GET /history` → `[]`.
- **Type:** unit

- **ID** M2-reset-02
- **Behavior:** `/reset` on an empty store succeeds with 0. It is idempotent.
- **Source:** ARCHITECTURE.md §3.3
- **Setup:** Fresh temp DB with no file. Then a second call.
- **Steps → Expected:** Both calls → `200`, `{"status": "cleared", "count_removed": 0}`.
- **Type:** unit

- **ID** M2-reset-03
- **Behavior:** After a reset, new detections are saved again, and ids are not reused.
- **Source:** ARCHITECTURE.md §3.4 (`AUTOINCREMENT`), §3.3 persistence
- **Setup:** `fake_detector`. Two successful `/detect` calls, then `/reset`, then one more `/detect`.
- **Steps → Expected:** `/reset` → `count_removed == 2`. `GET /history` then has exactly 1 record, and its `id` is greater than both earlier ids.
- **Type:** unit

- **ID** M2-reset-04
- **Behavior:** `/reset` only accepts DELETE.
- **Source:** ARCHITECTURE.md §3.3 (`DELETE /reset`)
- **Setup:** Dataset S.
- **Steps → Expected:** `GET /reset` and `POST /reset` → `405`. `GET /history` still returns 5 records.
- **Type:** unit

### POST /detect — persistence and logging

- **ID** M2-detect-persist-01
- **Behavior:** A successful detection saves exactly one record whose values match the response.
- **Source:** instructions.md "AI & Processing" (save timestamp, count, average confidence); ARCHITECTURE.md §3.2 step 8, §3.3 "Persistence from `/detect`"
- **Setup:** `fake_detector` (defaults). Record `before = datetime.now(UTC)`. POST an 80x50 PNG. Record `after`.
- **Steps → Expected:** `200`. `GET /history` returns exactly 1 record with `count == response.count == 2`, `average_confidence == approx(response.average_confidence) == approx(0.75)` and `inference_time_ms == response.inference_time_ms == 12.5`. Its `timestamp` ends in `Z` and is in `[before, after]`, allowing up to 1 s of slack.
- **Type:** unit

- **ID** M2-detect-persist-02
- **Behavior:** Each successful call adds one record, and they come back in call order.
- **Source:** ARCHITECTURE.md §3.3
- **Setup:** `fake_detector`. Send 3 POSTs, changing `fake_detector.detections` between calls so the counts are 1, 3, 0.
- **Steps → Expected:** `GET /history` counts are `[1, 3, 0]`, the ids are distinct and increasing, and the timestamps are non-decreasing.
- **Type:** unit

- **ID** M2-detect-persist-03
- **Behavior:** A detection with no people is still saved, with count 0 and average confidence 0.0.
- **Source:** instructions.md "Save each detection result"; ARCHITECTURE.md §3.3
- **Setup:** `fake_detector.detections = []`.
- **Steps → Expected:** `200`. `GET /history` has 1 record with `count == 0` and `average_confidence == 0.0`.
- **Type:** unit

- **ID** M2-detect-persist-04
- **Behavior:** `return_annotated=true` still saves exactly one record.
- **Source:** ARCHITECTURE.md §3.2 steps 7–8
- **Setup:** `fake_detector`. POST with `?return_annotated=true`.
- **Steps → Expected:** `200`, `annotated_image_base64` is non-null, and `GET /history` has exactly 1 record with `count == 2`.
- **Type:** unit

- **ID** M2-detect-persist-05
- **Behavior:** Rejected requests and inference failures save nothing.
- **Source:** ARCHITECTURE.md §3.3 ("Rejected uploads and inference failures save nothing")
- **Setup:** `fake_detector`. Parametrize:
  - no file → 400
  - empty file → 400
  - corrupt JPEG → 400
  - `text/plain` declared type → 415
  - GIF bytes → 415
  - upload over `MAX_UPLOAD_BYTES` (monkeypatched small) → 413
  - `?return_annotated=maybe` with a valid PNG → 400
  - `FakeDetector(error=RuntimeError("boom"))` → 500
- **Steps → Expected:** The listed status. Afterwards, `GET /history` → `[]`.
- **Type:** unit

- **ID** M2-detect-persist-06
- **Behavior:** If saving fails, `/detect` still returns the detection result, and the failure is logged at ERROR.
- **Source:** ARCHITECTURE.md §3.3 ("If the save itself fails, the error is logged and the detection result is still returned"); PROGRESS.md M2 "Failed saves"
- **Setup:** `fake_detector`. Override `get_storage` with a stub whose `save` raises `sqlite3.OperationalError("disk I/O error")`. Use `caplog` at ERROR.
- **Steps → Expected:** `200`. The body has `count == 2`, `average_confidence == approx(0.75)` and `inference_time_ms == 12.5`, the same as M2-detect-persist-01. `caplog` has at least one ERROR record from logger `backend.routes.detect`, with `exc_info` set.
- **Type:** unit

- **ID** M2-detect-persist-07
- **Behavior:** An unusable database file does not break `/detect`.
- **Source:** ARCHITECTURE.md §3.3 (failed save is non-fatal)
- **Setup:** `fake_detector`. Monkeypatch `config.DB_PATH` to `str(tmp_path)`, which is a directory, so sqlite cannot open it as a file.
- **Steps → Expected:** `POST /detect` with a valid PNG → `200`, `count == 2`.
- **Type:** unit

- **ID** M2-detect-persist-08
- **Behavior:** If drawing or encoding the annotated image fails, the request returns a 500 with a `{"detail"}` body and saves nothing.
- **Source:** ARCHITECTURE.md §3.3 (only successful detections save a record; every error has a string `detail`); OQ-5 resolution
- **Setup:** `fake_detector`, with its `annotate` monkeypatched to raise `RuntimeError("draw failed")`. Use the `client` fixture (`raise_server_exceptions=False`). POST a valid PNG with `?return_annotated=true`.
- **Steps → Expected:** `500`, error body (JSON, `detail` is a non-empty str). `GET /history` returns `[]`. Without `return_annotated`, the same fake gives `200` and 1 record.
- **Type:** unit

- **ID** M2-detect-log-01
- **Behavior:** Each successful detection writes exactly one INFO log line with the count, average confidence, inference time and frame size.
- **Source:** ARCHITECTURE.md §3.3 ("Each detection also writes one `INFO` log line …"); instructions.md "Backend" (performance logging); M1 OQ-9
- **Setup:** `fake_detector` (2 detections, avg 0.75, 12.5 ms). 80x50 PNG. `caplog.set_level(INFO, logger="backend.routes.detect")`.
- **Steps → Expected:** Exactly one INFO record from `backend.routes.detect` for the request. Its message contains `2`, `0.75`, `12.5`, `80` and `50`.
- **Type:** unit

- **ID** M2-detect-log-02
- **Behavior:** Startup warm-up does not create a history record.
- **Source:** ARCHITECTURE.md §3.3 (records come from `/detect` requests); M1 OQ-8 (warm-up is a dummy inference)
- **Setup:** `config.WARMUP_MODEL = True`, `fake_detector` override, `with TestClient(app)`.
- **Steps → Expected:** After startup, the fake's `detect_calls == 1` and `GET /history` → `[]`.
- **Type:** unit

### Request validation → 400 (all endpoints)

- **ID** M2-valid-01
- **Behavior:** A query-parameter validation error on `/detect` returns 400 with a string detail, not 422.
- **Source:** ARCHITECTURE.md §3.3 "All endpoints"; PROGRESS.md M2 "422 → 400"
- **Setup:** `fake_detector`. Valid PNG. `?return_annotated=maybe`.
- **Steps → Expected:** `400`, error body (`isinstance(detail, str)`), `detail` contains `return_annotated`, and `fake_detector.detect_calls == 0`.
- **Type:** unit

- **ID** M2-valid-02
- **Behavior:** A query-parameter validation error on `/history` returns 400 with a string detail.
- **Source:** ARCHITECTURE.md §3.3 "All endpoints"
- **Setup:** None.
- **Steps → Expected:** `GET /history?min_confidence=abc` → `400`. The `detail` is a `str` containing `min_confidence`. (This overlaps M2-hist-err-03. Keep one test and tag it with both IDs.)
- **Type:** unit

### config.py — DB_PATH

- **ID** M2-config-01
- **Behavior:** A relative `DB_PATH` resolves from the project root, regardless of the current working directory.
- **Source:** ARCHITECTURE.md §3.5 ("relative paths resolve from the project root"); PROGRESS.md M2 `config.py`
- **Setup:** Reuse the `env` fixture pattern from `test_config.py`. `env.setenv("DB_PATH", "data/x.db")` and `monkeypatch.chdir(tmp_path)`, then `importlib.reload(config)`.
- **Steps → Expected:** `config.DB_PATH == str(<repo root> / "data" / "x.db")`, where the repo root is `Path(backend.__file__).resolve().parent.parent`.
- **Type:** unit

- **ID** M2-config-02
- **Behavior:** An absolute `DB_PATH` is used unchanged. The default is `<project root>/backend/detecto.db`.
- **Source:** ARCHITECTURE.md §3.5
- **Setup:** As above. Case A: `DB_PATH=str(tmp_path / "abs.db")`. Case B: `DB_PATH` unset, and no `.env` override. If the repo's `.env` sets `DB_PATH`, the generator must patch `load_dotenv` or skip case B with a reason.
- **Steps → Expected:** A: `config.DB_PATH == str(tmp_path / "abs.db")`. B: `config.DB_PATH == str(<repo root> / "backend" / "detecto.db")`.
- **Type:** unit

### CORS for the new routes

- **ID** M2-cors-01
- **Behavior:** The configured frontend origin may call `GET /history` and `DELETE /reset`.
- **Source:** ARCHITECTURE.md §3.5, §4.1 (the History view calls `/history`, and the frontend calls `/reset`)
- **Setup:** Default config.
- **Steps → Expected:** `OPTIONS /reset` with `Origin: http://localhost:5173` and `Access-Control-Request-Method: DELETE` → `200`, with `access-control-allow-origin == "http://localhost:5173"`. `GET /history` with the same `Origin` → `200` and the same header.
- **Type:** unit

### Integration (real YOLOv8n, `@pytest.mark.integration`)

- **ID** M2-int-01
- **Behavior:** A real detection is persisted with the values the model returned, and `/reset` clears it.
- **Source:** instructions.md "AI & Processing" (save each detection result); ARCHITECTURE.md §3.2 step 8
- **Setup:** No override. Upload `ultralytics.utils.ASSETS / "bus.jpg"`.
- **Steps → Expected:** `200`. `GET /history` has exactly 1 record, with `count == response.count`, `average_confidence == approx(response.average_confidence)` and `inference_time_ms == approx(response.inference_time_ms)`. Then `DELETE /reset` → `count_removed == 1`.
- **Type:** integration

## Regression

M2 changes some M1 behavior. Re-run the whole M1 suite (`backend/.venv/bin/python -m pytest`) and check these points:

- **Every successful `/detect` now writes a row** (M1-detect-01..10, M1-int-01..05). These tests must keep passing, and they must write only to the per-test temp DB.
  - **M2-reg-01:** record the size and mtime of the real `backend/detecto.db` before the run (or confirm the file does not exist), then confirm they are unchanged after the full suite. This can be a session-scoped fixture or a final check.
- **Error responses of `/detect`** (M1-detect-err-01..11) must keep their status codes and string `detail` bodies. M2-detect-persist-05 adds "saves nothing" to each of them.
- **422 → 400** is now app-wide (PROGRESS.md M2). No M1 test asserted 422. M1-detect-err-06/07 (missing file / wrong field name → 400) must still pass. They are still handled in the route, but the new global handler must not change their `detail` into a list.
- **M1-detect-err-08** (inference failure → 500) must still return 500, and now must also save nothing. This is covered by M2-detect-persist-05.
- **M1-config-01** (`test_config.py` reloads `backend.config`): `DB_PATH` is now computed through `_from_root`. After the reload in teardown, `config.DB_PATH` must still be the autouse temp path for later tests. Check this by running `test_config.py` followed by a persistence test in the same session.
- **M1-startup-01/02** (warm-up): the lifespan is unchanged. M2-detect-log-02 adds that warm-up writes no record.
- **M1-cors-01/02** are unchanged. M2-cors-01 extends them to the new routes.

## Resolved decisions (user, 2026-10-02)

The planner's open questions, with the user's resolution. "App change" means the code must change, and the tests encode the new behavior.

- **OQ-1 — Empty filter values:** **app change.** An empty value (`?start_date=`, `?end_date=`, `?min_confidence=`) is treated as absent for all three filters. M2-hist-err-05.
- **OQ-2 — Extreme valid dates:** **app change.** `/history` never returns 500 for a parseable date.
  - Valid dates filter correctly. The stored timestamp format and the comparison must hold for years below 1000, and a date-only `end_date` of 9999-12-31 must not overflow.
  - Dates that can't be represented in UTC get a `400` with a string `detail`. M2-hist-err-06.
- **OQ-3 — Date-only filters are UTC days:** the backend stays as documented. Recorded in PROGRESS.md as an M4 requirement: the FilterBar must send datetimes with an offset, built from the user's local midnight, not bare dates. No test change.
- **OQ-4 — `min_confidence` and zero-person records:** **app change.** `min_confidence` applies only to records with `count > 0`, and zero-person records are always kept, so the people-over-time chart keeps its "nobody present" points. M2-storage (combined filters), M2-hist-11 and the combined-filter case were updated. ARCHITECTURE.md §3.3 is updated.
- **OQ-5 — Annotation failure after saving:** **app change.** The record is saved only after the full response (including the annotated image) is built. Annotation and encoding errors become `500` with a string `detail`, and nothing is saved. New case M2-detect-persist-08.
