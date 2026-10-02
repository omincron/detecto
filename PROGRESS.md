# Detecto — Project Log

Running log of what's been built, what's in progress, and what's planned. Read
`ARCHITECTURE.md` first for the design; this file tracks status over time.

Workflow: built in milestones (see plan below). Each milestone is implemented, then
summarized here with the decisions made, before moving to the next.

Testing gate (end of every milestone), using the agents in `.claude/agents/`:
1. `test-planner` writes `test-plans/milestone-N.md` from the spec. A human reviews it and
   resolves its open questions.
2. `test-generator` implements the plan as tests and runs them. It doesn't fix anything.
3. `test-healer` sorts each failure into one of three classes: a test bug (it fixes the
   test), a clear app bug (it fixes the app), or unclear (it changes nothing and the case
   goes to human review). It writes `test-plans/milestone-N-healer-report.md`.
A milestone is done only when the suite passes and the human-review items are resolved.

## Status: Milestone 3 complete — Frontend detection view

## Plan (milestones)

1. **Backend skeleton** — FastAPI app, YOLOv8 model loading, `/detect` on a single image *(done)*
2. **Storage** — SQLite schema, `/history`, `/reset` *(done)*
3. **Frontend detection view** — upload + bounding box overlay *(done)*
4. **Frontend history view** — table/chart + filters
5. **Evaluation** — run the 10 sample images, fill in README metrics table
6. **Bonus (optional)** — webcam/alerts/heatmaps/etc.

## Log

### 2026-09-18 — Setup

- Reviewed `instructions.md`, wrote `ARCHITECTURE.md` (system design, API contract,
  storage schema, frontend component breakdown, extension points for bonus features).
- Agreed on a milestone-based workflow: implement a milestone, then checkpoint here
  and in chat with a plain-language summary + any real decisions, before continuing.
- Backend environment set up:
  - `backend/.venv` — Python virtualenv (system Python is externally-managed, so a
    venv is required, not optional).
  - `requirements.txt` created and installed: fastapi, uvicorn, python-multipart,
    pydantic, python-dotenv, ultralytics (YOLOv8), opencv-python-headless, numpy.
  - **Decision:** YOLOv8**n** (nano) chosen as the model — smallest/fastest variant,
    good default for CPU inference; matches the "optimize detection speed" learning
    objective without needing a GPU. Can swap to a larger variant later if accuracy
    testing shows it's needed.
  - Note: installing `ultralytics` pulled in `torch` (with CUDA wheels, ~2GB) even
    though we're targeting CPU inference by default — this is normal for the PyPI
    torch wheel and doesn't force GPU use; it'll just run on CPU if no GPU/CUDA is
    present.

### 2026-09-18 — Milestone 1: backend skeleton

Built and smoke-tested:

- `backend/config.py` — loads `.env` from project root regardless of working
  directory (`load_dotenv(Path(__file__)...)`), exposes `MODEL_PATH`,
  `CONFIDENCE_THRESHOLD`, `CORS_ORIGINS`, `DB_PATH`.
- `backend/utils/preprocessing.py` — `decode_image` (bytes → array, raises on
  corrupt/unsupported files), `preprocess_image` (resize to max 1280px on the
  long edge + CLAHE contrast boost on the luminance channel), `encode_image_base64`.
  Pure functions, no FastAPI/model imports, so they're unit-testable standalone.
- `backend/services/detector.py` — `PersonDetector` wraps `ultralytics.YOLO`,
  filters to COCO class `0` ("person") only, returns `(detections, inference_time_ms)`.
  Loaded once via `get_detector()` (`@lru_cache`), injected into the route with
  FastAPI's `Depends()` — model loads lazily on first request, not at import time.
- `backend/models/record.py` — `Detection` / `DetectionResponse` Pydantic schemas
  for the `/detect` response.
- `backend/routes/detect.py` — `POST /detect`: validates content-type (415) and
  non-empty file (400), decodes/preprocesses, runs inference, computes average
  confidence, optionally returns an annotated JPEG as base64 (`return_annotated=true`),
  returns `image_width`/`image_height` alongside the boxes so the frontend can scale
  overlays correctly regardless of the resize step in preprocessing.
- `backend/main.py` — FastAPI app, CORS middleware (origin from config), `/health`.
- `.env` (root, config values — no secrets, safe to commit for this project) and
  `.gitignore` (venv, `__pycache__`, `*.pt` model weights, `*.db`, frontend build output).

**Smoke test** (manual, via curl against `ultralytics`'s bundled `bus.jpg`):
- `/health` → `200 {"status": "ok"}`
- `/detect` on `bus.jpg` → 3 people detected, confidences 0.82–0.86, correctly
  filtered to person-only despite the image also containing a bus.
- `/detect` with an empty file → `400 "Uploaded file is empty"`
- `/detect` with a `.txt` file → `415 "Unsupported file type: text/plain"`

**Decisions made:**
- Model loading via `lru_cache` + `Depends()` instead of FastAPI `lifespan` — simpler,
  equally effective for a single-model app, and easier to override in tests later.
- `preprocess_image` resizes + CLAHE-adjusts explicitly (satisfies the assignment's
  "apply preprocessing" requirement) even though `ultralytics` also does its own
  internal letterboxing/normalization before feeding the network — these are two
  different concerns (frame quality vs. model input tensor format), not redundant.
- Response includes `image_width`/`image_height` of the *processed* frame (post-resize),
  since bounding boxes are relative to that frame, not the original upload — the
  frontend overlay must scale against these, not the original file's dimensions.
- Not yet wired to storage — `/detect` doesn't persist anything yet. That's Milestone 2.

**Not done yet / explicitly deferred:**
- No automated tests written yet (`backend/tests/` is empty) — smoke-tested manually.
  Will add `TestClient`-based tests once storage exists, so tests can cover the
  save-a-record side effect too.
- `yolov8n.pt` weights download to the project root on first run (ultralytics default
  cache behavior) — gitignored via `*.pt`.

**Next:** Milestone 2 — SQLite storage, wire `/detect` to save a summary record,
add `/history` and `/reset`.

### 2026-10-02 — Milestone 1 testing gate (passed)

- `test-planner` wrote `test-plans/milestone-1.md` and raised 12 open questions. The user
  resolved them all; see the plan's "Resolved decisions" section. Summary:
  - **Deferred:** base64 JSON input to `/detect` (to a later milestone); server-side
    performance logging (to M2, where inference time is persisted per request).
  - **App changes agreed:**
    - Missing file → 400 with a string `detail`.
    - Format checked by magic bytes, with a lenient declared Content-Type.
    - Each side clamped to ≥ 1px on resize.
    - `decode_image(b"")` raises `ValueError`.
    - 413 above `MAX_UPLOAD_BYTES` (default 10 MiB).
    - Model warm-up at startup via a lifespan (`WARMUP_MODEL`, default on). This reverses
      the earlier "no lifespan" decision: loading stays lazy and cached, and the lifespan
      just triggers it early.
  - **Documented as-is (ARCHITECTURE.md §3.3):**
    - Opt-in `return_annotated`.
    - `image_width`/`image_height`.
    - Float, predict-only `inference_time_ms`.
    - Threshold is strictly greater than `CONFIDENCE_THRESHOLD`.
- Test env fixed:
  - The stray `opencv-python` 4.11 was removed, leaving the pinned headless 4.10.
  - `pytest` and `httpx2` were added via `requirements-dev.txt`, and a root `pytest.ini`
    was added.
  - `pip check` warns that ultralytics wants `opencv-python`; the headless build provides
    the same `cv2` and works.
- Order: generate tests (the agreed app changes fail first), then fix the app, then run
  `test-healer` on any remaining failures.
- `test-generator` wrote 71 tests in `backend/tests/` (66 unit, 5 `integration` on the
  real model). The first run had 50 passing and 21 failing; every failure was one of the
  agreed app changes above, and none were unexpected.
- Implemented the app changes. These touched `config.py`, `main.py` (warm-up lifespan),
  `routes/detect.py` (missing file, declared type, size limit, magic-byte check) and
  `utils/preprocessing.py` (`sniff_image_format`, empty-bytes `ValueError`, 1px clamp).
- **Result: 71/71 pass.** `test-healer` was not needed: no failures were left to sort, and
  no human-review items came up.
- Run: `backend/.venv/bin/python -m pytest` (add `-m "not integration"` to skip the
  real-model tests).

### 2026-10-02 — Milestone 2: storage

Built and smoke-tested:

- `backend/models/record.py`: added `DetectionRecord` (id, timestamp, count,
  average_confidence, inference_time_ms), `ResetResponse` and the `CREATE TABLE` SQL,
  kept side by side as the single definition of a record. Adds an index on `timestamp`.
- `backend/services/storage.py`: `SQLiteStorage` with `save` / `list(filters)` / `clear`,
  the interface from ARCHITECTURE.md §3.1. `get_storage()` is the FastAPI dependency.
- `backend/routes/history.py`: `GET /history` (date and `min_confidence` filters) and
  `DELETE /reset`.
- `/detect` now saves one record per successful detection and logs one `INFO` line
  with count, average confidence, inference time and frame size. This covers M1's
  deferred performance logging (OQ-9).
- `main.py`: registers the history router. A `RequestValidationError` handler turns
  FastAPI's 422 list into `400 {"detail": "<string>"}` on every endpoint.
- `config.py`: a relative `DB_PATH` resolves from the project root, so starting the
  server from `backend/` no longer creates a second DB.

**Smoke test** (TestClient, real model, temp DB):
- 2x `bus.jpg` saves 2 records. An empty upload saves nothing.
- The filters behave as designed.
- Bad dates, a non-numeric `min_confidence` and a reversed range all return 400 with a
  string `detail`.
- `/reset` returns `count_removed: 2`, then `0`. The Milestone 1 suite still passes
  (71/71).

**Decisions made** (the spec is silent on these; documented in ARCHITECTURE.md §3.3):
- **Timestamps:** stored as fixed-width UTC strings (`YYYY-MM-DDTHH:MM:SS.ffffffZ`), so string
  comparison is chronological. Filter values without a timezone are taken as UTC.
  - The frontend should send UTC, e.g. `Date.toISOString()`, or include an offset.
- **Date filters:** a date-only `end_date` includes the whole day. A datetime
  `end_date` is exclusive.
- **`min_confidence`:** filters on the record's *average* confidence (≥), since per-box
  confidences aren't stored.
- **Order:** `/history` returns records oldest first, which suits a time-series chart.
- **Failed saves:** a failed save doesn't fail `/detect`. It's logged and the result is
  still returned.
- **Connections:** one SQLite connection per call, because FastAPI's threadpool can't
  share sqlite3 connections. There's no pooling or ORM; it isn't needed at this scale.
- **422 → 400:** validation errors now return 400 on every endpoint. This changes
  behavior beyond `/history`, e.g. `/detect?return_annotated=maybe` was 422 and is now
  400.

**Testing gate:** `test-planner` wrote `test-plans/milestone-2.md`. The user resolved its
open questions (see the plan's "Resolved decisions"):
- Empty filter values mean no filter.
- Extreme dates never return 500.
- `min_confidence` always keeps zero-person records.
- A record is saved only after the full response is built, so an annotation failure
  returns 500 and saves nothing.
- Date-only filters stay UTC days; this is recorded as an M4 FilterBar requirement below.

`test-generator` wrote 92 M2 tests:
- `test_storage.py`, `test_history.py` and `test_detect_persistence.py` are new.
- Additions to `test_config.py`, `test_cors.py`, `conftest.py` and `helpers.py`.
- A session-wide check that the suite never touches the real `backend/detecto.db`.

First run: 150 passed and 13 failed. Every failure was one of the agreed app changes,
and all 71 M1 tests passed.

App fixes:
- **Storage:** timestamps are written with `isoformat`, because `strftime("%Y")` doesn't
  zero-pad years below 1000. `min_confidence` uses `person_count = 0 OR
  average_confidence >= ?`.
- **`/history`:** filters are parsed as strings, so an empty value means no filter.
  `end_date=9999-12-31` means no upper bound. A UTC overflow gives a 400. NaN is
  rejected.
- **`/detect`:** annotation errors return 500 with a `detail`, and the record is saved
  after annotation.

**Result: 163/163 pass.** `test-healer` was not needed, because no failures were left
to sort.

### 2026-10-02 — Milestone 3: frontend detection view

Built:
- **Setup:** `frontend/` is Vite 8 + React 19 (JS/JSX, per ARCHITECTURE.md). Vitest,
  Testing Library and jsdom are set up from the start (`npm test`), so the testing gate
  doesn't begin with environment fixes like M1's did. `frontend/.env` sets
  `VITE_API_BASE_URL=http://localhost:8000`.
- **`src/api/client.js`:** `detectPeople(file)`. It's the only place that knows the URL
  and the response shape, and it raises `ApiError` with a displayable message.
- **`src/utils/bbox.js`:** `bboxToPercentRect`, which holds all the box math, plus
  formatting helpers.
- **Components:**
  - `ImageUploader`: file picker, drag-and-drop, and sample buttons read from
    `public/samples/index.json`.
  - `BoundingBoxOverlay`: percent-positioned boxes labelled `#n · NN%`.
  - `DetectionSummary`: count, average confidence, model time, total time and the list
    of people with their confidence. Hovering a list entry highlights its box, and
    hovering a box highlights its entry.
- **Pages:** `DetectionView`, plus a placeholder `HistoryView` (M4). `App` switches
  between them with state.
- **Samples:** `public/samples/` has `bus.jpg` and `zidane.jpg`, copied from
  ultralytics' bundled assets. M5 brings this to the required 10.

**Checked:**
- `vite build` succeeds.
- With both servers running, the CORS preflight from `localhost:5173` is allowed,
  `zidane.jpg` returns 2 people at 1280×720, and the wrong file type returns a readable
  415.
- A throwaway jsdom render showed the boxes and count on success, the backend's message
  on a 415, and "can't reach the server" on a network error.
- Not checked visually in a browser: the Chrome extension wasn't connected.

**Decisions made:**
- **Boxes as percentages of the processed frame,** not pixel scaling by displayed size.
  This needs no resize handling. ARCHITECTURE.md §4.2 is updated.
- **The `<img>` shows the original upload** (an object URL), and the boxes are drawn in
  the browser. `return_annotated` isn't used: it would roughly double the response size,
  and boxes in the DOM can be highlighted and toggled.
- **Format and size are validated by the backend only,** so its rules exist in one
  place. The file picker's `accept` attribute just narrows the dialog.
- **Stale responses:** if a new image is picked mid-request, the older response is
  ignored.
- **No router:** two pages managed with state.
- Streaming and webcam input are not part of M3; they're the bonus in instructions.md.

**M2 bug found and fixed:** the per-detection `INFO` log line never appeared under
uvicorn. The `backend` logger had no handler, and uvicorn only configures its own
loggers. M2's test passed anyway because pytest's log capture doesn't depend on handlers.
`main.py` now attaches a handler to the `backend` logger. Verified in the live server
log, and 163/163 backend tests pass.

**Testing gate:** `test-planner` wrote `test-plans/milestone-3.md` (64 automated cases
and 12 manual browser checks). A first browser check through Claude in Chrome
confirmed the boxes align on `zidane.jpg` and `bus.jpg`. The user resolved the open
questions (see the plan's "Resolved decisions"):
- **Uploader during a detection:** stays enabled, so a slow or hung request can be
  replaced.
- **Late sample downloads:** dropped once a newer selection has been made.
- **Missing samples:** a non-image sample download counts as a failed sample load.
- **`formatMs`:** rounds before choosing the unit.
- **Tall images:** the displayed image is capped at about 75% of the viewport height.
- **Accepted as is:** the hard-coded "up to 10 MB" hint (note it in the README in M5).
- **Leaving the Detect page discards the result:** revisit in M4.

`test-generator` wrote 78 frontend tests (Vitest, Testing Library) and 5 backend tests:
the logger reaching a real handler, including a live uvicorn run, and EXIF frame size.
First run: 74/78 frontend passed. All 4 failures were the agreed changes (OQ-1 to OQ-4),
and the backend had 168/168.

App fixes:
- The uploader stays enabled during a detection.
- Sample loads are dropped once a newer selection has been made, or if the uploader is
  disabled.
- A non-image sample download counts as a failed load.
- `formatMs` rounds first.
- `.overlay__image` has `max-height: 75vh`.

**Result:** frontend 78/78 and backend 168/168. `test-healer` was not needed.

**Manual checks (Claude in Chrome, real browser): all 12 pass.** Each was measured in the
DOM (box positions against the image rect, aspect ratios, elements) because screenshots
timed out. The first check was also confirmed visually.
- **Alignment:** at native size; through a resize to 500px, which gives the single-column
  layout; on a 4000px photo downscaled to 1280; on a 3000×600 panorama; on an
  EXIF-rotated photo, shown upright at 810×1080, matching the backend; and on a 200×150
  image shown at natural size.
- **Labels:** a top-edge label is readable and not covered.
- **Crowd of 36:** hover highlights the right box for 36 of 36 entries in about one frame,
  and the toggle hides and shows all boxes.
- **Errors:** GIF, .txt, a 0-byte file, an 11 MB file and a stopped backend each show a
  readable alert, and the page recovers.
- **Network:** one POST per upload, with no query parameters.
- **Height cap:** a tall image displays at 75vh.
- **Frozen backend (`kill -STOP`):** the uploader stays usable, and after `kill -CONT`
  only the newer image's result is shown.

## Open decisions for later milestones

- **M4 requirement (from M2 OQ-3):** `/history` date-only filters are UTC days. The
  History view's FilterBar must send datetimes with an offset, built from the user's
  *local* midnight (e.g. `new Date(y, m, d).toISOString()`), not bare `YYYY-MM-DD`
  dates. Otherwise a user at UTC+2 picking "Oct 2" gets 02:00 to 02:00 local time.

- Whether to persist bounding boxes in history (currently: no, only summary stats —
  see ARCHITECTURE.md §3.4). Revisit if History view ever needs per-box replay.
- Frontend charting library for History view (not yet chosen).
