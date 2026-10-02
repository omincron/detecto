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

## Status: Milestone 4 complete — Frontend history view

## Plan (milestones)

1. **Backend skeleton** — FastAPI app, YOLOv8 model loading, `/detect` on a single image *(done)*
2. **Storage** — SQLite schema, `/history`, `/reset` *(done)*
3. **Frontend detection view** — upload + bounding box overlay *(done)*
4. **Frontend history view** — table/chart + filters *(done)*
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
- ~~**Format and size are validated by the backend only,** so its rules exist in one
  place. The file picker's `accept` attribute just narrows the dialog.~~
  *Superseded on 2026-10-02 by the browser-side upload pre-check (user decision). See
  "Open decisions" and ARCHITECTURE.md §4.1.*
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

### 2026-10-02 — Design pass (milestone 3b): Mantine rebuild

Built:
- **Mantine 9 with the agreed look** (theme in `src/theme.js`): neutral base, pastel
  palettes, IBM Plex fonts bundled through @fontsource, light mode only.
- **AppShell:** a sidebar with the wordmark, "Pages" navigation and a `BackendStatus`
  card. It collapses behind a burger below `sm`.
- **Detect page restyled:** upload bar, image card, pastel stat cards and a detections
  list with confidence bars. Box labels now sit inside the box's top-left corner.
- **Browser-side upload pre-check** (`utils/validateUpload.js`, user decision): rejects
  empty files, files over `VITE_MAX_UPLOAD_MB` (default 10; also drives the hint) and
  declared types that are clearly not JPEG/PNG. An empty type or `application/octet-stream`
  goes on to the backend.
- **`checkHealth()`** polls every 30 s with a 5 s timeout.
- **Test infrastructure:** `src/test/setup.js` polyfills `matchMedia` and
  `ResizeObserver` and wraps every `render` in the app's MantineProvider.

**Testing gate:**
- `test-planner` wrote `test-plans/milestone-3b.md` (48 cases, 13 manual checks). The
  user resolved:
  - **OQ-1:** octet-stream passes the pre-check.
  - **OQ-2:** the health check aborts after 5 s and shows "offline".
  - **OQ-3:** the offline hint shows the configured API URL.
  - **OQ-4:** the burger has `aria-expanded`/`aria-controls`, and the sidebar is an
    `aside`, so "Pages" is the only nav landmark.
  - **OQ-5:** docs updated (ARCHITECTURE.md §3.3 `/health`, §4.1 pre-check, §4.3 UI kit
    and settings).
- `test-generator` added 81 frontend tests and 2 backend tests. All failures were either
  the 7 agreed OQ changes or 5 old M3 tests.
- After the app fixes, **`test-healer` ran for the first time:**
  - M3-view-06 (3 rows) and M3-view-08 were outdated by the pre-check decision. It
    updated them and confirmed the replacement M3b tests pass first.
  - **M3-summary-01 escalated:** the redesign had dropped the `dl/dt/dd` pairing of stat
    labels and values (an accessibility loss). **The user chose to restore it**, so the
    stat cards are a `dl` again, and the test passes unchanged.
  - Report: `test-plans/milestone-3b-healer-report.md`.
- **Result:** frontend 156/156, backend 170/170, and the build passes.

**Live checks (Claude in Chrome, measured in the DOM and the network log):**
- **Pre-check:** .txt, .gif, a 0-byte file and 10 MiB + 1 byte are rejected with **0**
  POSTs. `PHOTO.JPG`, a file with no type and octet-stream each make exactly 1 POST.
- **Fonts:** load from the app; no Google Fonts requests.
- **Landmarks:** one nav landmark, and the stat `dl` pairing is present.
- **Frozen backend:** the card shows "Backend offline · Can't reach http://localhost:8000"
  11 s after `kill -STOP`, and "online" again 18 s after `kill -CONT`.
- **Not done:** visual comparison with the mockup, focus rings and contrast, because
  screenshots time out in the browser tool. Those are for the user to eyeball.

**Height fixes (from a user-requested viewport check):**
- **Wasted strip:** AppShell reserved the mobile header's 56px on desktop too, leaving an
  empty band above the sidebar and the page. It's now `header.height: {base: 56, sm: 0}`.
- **Portrait overflow:** `bus.jpg` overflowed an 871px window by 128px, because the 75vh
  cap ignored the roughly 300px of page above the image. The cap is now
  `max(320px, calc(100dvh - 300px))`.
- **Re-measured:**
  - the sidebar is at y = 0;
  - the portrait image is 571px and its card ends at 840 of 871, with no scroll;
  - landscape also fits with no scroll;
  - a 382px-tall window keeps the 320px floor and scrolls;
  - at 500px wide the header is 56px with the title below it.
- **Lesson:** the M3 check confirmed the 75vh cap was applied, not that the whole card
  fit on screen. Manual check 14 in the 3b plan now measures the full layout.

### 2026-10-02 — Milestone 4: frontend history view

Built:
- **Dependencies:** `@mantine/dates` (+ dayjs) for the date-time pickers, and `recharts`
  for the chart.
- **`api/client.js`:** `getHistory(params)` (camelCase records, `timestamp` as a `Date`)
  and `clearHistory()`.
- **`utils/history.js`:** `toApiInstant` (local picker value to UTC instant),
  `buildHistoryParams`, `validateRange`, `summarize` (KPIs), `formatTimestamp` and
  `localTimeZone`.
- **Components:**
  - `FilterBar`: From/To `DateTimePicker`s and a confidence `Slider`, with Apply, Reset
    and inline range validation.
  - `HistoryStats`: KPI `dl`.
  - `HistoryChart`: Recharts time axis plus a text summary for screen readers.
  - `HistoryTable`: newest first, paginated.
  - `ClearHistoryButton`: the agreed scoped confirmation, with the unfiltered count.
- **Pages:** `HistoryView` with loading, error and empty states (plus "Go to Detect").
  `App` passes `onNavigate` to pages.

**Live check (Claude in Chrome, real backend with 33 records):**
- KPIs show 33 / 4.4 / 36 / 121 ms.
- The chart has 33 points on a time axis.
- The table has 15 rows on page 1 of 3.
- The time zone is named (Europe/Athens).
- The slider at 85% sends `?min_confidence=0.85` and shows the 1 matching record.
- The clear dialog fetched the unfiltered total. Its rendering couldn't be checked
  because the Chrome tab was hidden; the dialog was cancelled and nothing was deleted.
- **Bug found and fixed while checking:** the confidence slider's focusable thumb had no
  accessible name, because `aria-labelledby` landed on Mantine's wrapper. It now uses
  `thumbLabel`.

**Root cause of the recurring browser-tool timeouts:** the Chrome window is hidden
(`visibilityState: "hidden"`). Chrome throttles timers and skips animation frames there,
so screenshots time out and Mantine's transitions (the Modal) never run. Visual checks
need the Chrome window visible.

**Known test impact:** 5 shell tests (M3-app-02, M3b-shell-02..05) open the History tab
and expect the old placeholder and no `/history` call. M4 changes that on purpose, so
these go to the healer at the gate.

**Testing gate — status and RESUME CHECKLIST (written 2026-10-02, mid-gate):**

Done:
- [x] `test-planner` wrote `test-plans/milestone-4.md` (59 cases, 13 manual checks).
- [x] The user resolved all open questions. See the plan's "Resolved decisions" and
  "Cases added by the resolutions". Summary: OQ-1 keep Detect mounted, OQ-2 inclusive
  "To", OQ-3 reset filters after clear, OQ-4 pagination names, OQ-5 singular wording,
  OQ-7 trim timestamps, OQ-10 dots-only chart. OQ-6 and OQ-8 are accepted as is.
- [x] OQ-9 docs: ARCHITECTURE.md §2 file tree updated, and the charting library is
  recorded as Recharts.
- [x] Visual check in Chrome (window in front): the Detect page matches the mockup. On
  History, the pickers send local time as UTC (18:30 Athens → `…T15:30:00.000Z`), and
  the dialog said "Delete all 34 records" with 24 filtered. It was cancelled; no DELETE.

In progress when this was written:
- [x] `test-generator` wrote the M4 tests: 230 frontend and 171 backend. The first run had
  215/230 frontend (9 agreed-change failures, the 5 shell tests, and 1 ICU alias quirk
  for M4-fmt-02) and 171/171 backend.
- [x] **Step 1 done:** all 7 app changes, plus a fix found by the generator: the modal's
  close button now has `aria-label="Close"`. All 9 agreed-change tests pass.
- Note: the original "if the session ended before it reported" fallback is kept below
  for reference. **If the session ended before it reported:**
  run `npm test` in `frontend/` and `backend/.venv/bin/python -m pytest` from the root.
  Check `git status` for new `*.test.js(x)` files and whether every plan case (including
  "Cases added by the resolutions") has a test. Re-run `test-generator` with the plan if
  coverage is incomplete.
  - Expected after generation: the OQ-1/2/3/4/5/7/10 tests fail (app not changed yet),
    the 5 shell tests below still fail, and everything else passes.

Still to do, in this order:
1. **App changes** (each has failing tests that pin it):
   - **OQ-1** `App.jsx`: keep `DetectionView` mounted while History is shown, hidden
     (`hidden` attribute / `display:none`, so it's out of the a11y tree). Mount
     `HistoryView` only when active, so it refreshes per visit. An in-flight detection
     must survive the switch.
   - **OQ-2** `FilterBar.jsx`: when a *day* is picked in "To" (value time 00:00, date
     changed), set it to that day at 23:59:00. Time-only edits keep their time.
     `utils/history.js`: `buildHistoryParams` and `validateRange` treat "To" as
     inclusive of its minute, so `end_date` = `toApiInstant(to)` + 60 s. Update the
     ARCHITECTURE.md §4.1 Filters bullet.
   - **OQ-3** `HistoryView.jsx`: on a successful clear, reset the draft and applied
     filters, reload unfiltered, and show "Deleted N records." plus "No detections yet."
   - **OQ-4** `HistoryTable.jsx`: name the pagination's previous and next controls
     "Previous page" and "Next page" (Mantine `Pagination` `getControlProps`).
   - **OQ-5** singular wording: the dialog says "This deletes the only record in the
     history." and the button "Delete 1 record"; the chart summary says "1 detection";
     the notice says "Deleted 1 record." (already singular).
   - **OQ-7** `api/client.js` `getHistory`: trim fractional seconds to 3 digits before
     `new Date(...)`.
   - **OQ-10** `HistoryChart.jsx`: dots only, no connecting line (e.g. a Recharts
     `Scatter`, or `Line` with `stroke="none"`). Keep the time axis and the a11y summary.
2. ✅ **Done:** `test-healer` (re-run) fixed all 11 as test bugs: 5 outdated by M4, 5 by
   OQ-2, and M4-fmt-02 (accepts either Kolkata alias). No app changes, and nothing
   needed human review. Report: `test-plans/milestone-4-healer-report.md`. Docs updated
   (ARCHITECTURE.md §4.1 and §4.3 for OQ-1/2/3/5/10), and the plan has a note on its
   pre-OQ-2 case bodies.
3. ✅ **Done:** frontend 230/230, backend 171/171, and the build passes.
   (Superseded text of step 2 follows.) **Run `test-healer`** (it was the NEXT STEP; the first run was cut off by the usage limit before it
   changed anything, so it was re-run from scratch. If no `test-plans/milestone-4-healer-report.md`
   exists, it didn't finish: re-run it). 11 frontend tests fail: the 5 shell tests, 5 M4
   cases written before the OQ-2 resolution (M4-params-02, M4-range-01, M4-tz-03,
   M4-filter-05, M4-view-05; "To" is now inclusive of its minute, and From == To is now
   valid), and M4-fmt-02 (Node/ICU reports "Asia/Calcutta" for "Asia/Kolkata"). Original
   note: expected are only the 5 shell tests
   M3-app-02 and M3b-shell-02..05, which the plan's Regression section classifies as
   outdated by M4. With OQ-1, "no dropzone on History" becomes "dropzone not visible".
   Show any "needs human review" items to the user.
3. **Full runs:** `npm test`, `npx vite build` and backend pytest, all green.
4. ✅ **Done (live, Chrome in front, read-only against :8000):**
   - **OQ-1:** the Detect result (count 2, both boxes) survives Detect → History →
     Detect, and History unmounts when left.
   - **OQ-10:** the chart draws dots only, and History shows fresh data (the new 10:42 PM
     record).
   - **OQ-2:** picking Oct 1 in "To" snaps to "Oct 1, 2026 23:59", and Apply sends
     `end_date=2026-10-01T21:00:00.000Z` (Athens midnight at the end of Oct 1), giving
     the filtered empty state. "Reset filters" restores everything.
   - **OQ-4:** pagination names "Previous page", 1–3, "Next page".
   - **Dialog:** "Delete all 35 records" with the scope lines, and the × is named
     "Close". Escape dismissed it, with no `/reset`.
   - **Not run live (unit-tested only):** confirming a delete (needs a sandbox
     backend), singular wording (needs exactly 1 record), the Firefox/Safari timestamp
     check, and contrast.
   (Original text of step 4 follows.) **Manual checks** from the plan, with the Chrome window in front (check
   `document.visibilityState === "visible"`). Never confirm a delete against :8000;
   the user's records live there. Delete-confirm checks use a sandbox backend on another
   port with a temp `DB_PATH`.
5. ✅ Entry updated and M4 marked done. **Remaining: commit (ask the user first).**

Optional, noted: `vite build` warns that the JS bundle is over 500 kB (Mantine, dates,
Recharts). Lazy-loading `HistoryView` with `React.lazy` would split it.

**Dev servers** (if not running):
- Backend, from the root: `backend/.venv/bin/python -m uvicorn backend.main:app --port 8000`.
- Frontend, in `frontend/`: `npx vite --port 5173`.
- A detached backend may still be running from this session (PID in the scratchpad's
  `uv.pid`).

## Open decisions for later milestones

- **Design direction (agreed 2026-10-02):** Mantine, light mode only, a neutral base
  with pastel accents, and IBM Plex Sans/Mono. No logo yet; the product name is a text
  wordmark. Reference mockup: https://claude.ai/artifact/Y59trr8m7kAdmZCJgQSExS (Detect
  and History pages). Rebuild the Detect page in Mantine before M4, then build M4 in it.
- **Browser-side upload pre-check (user decision 2026-10-02, part of the Mantine pass):**
  reject empty files, files over the size limit, and a declared type other than
  JPEG/PNG before uploading, so the error is instant. The backend stays the real
  validator (magic bytes, decoding). The limit comes from one frontend setting
  (`VITE_MAX_UPLOAD_MB`, default 10), which also drives the "up to N MB" hint (closes
  M3 OQ-5). It must match the backend's `MAX_UPLOAD_BYTES`; note that in the README.
- **Clear history (user decision 2026-10-02, M4):** a confirmation dialog stating the
  scope: deletes *all* records, ignores the current filters, can't be undone, and shows
  the record count. `/reset` stays "delete everything"; filtered deletion is not planned.
  No auth on `/reset` is a known limitation, to be noted in the README.

- **M4 requirement (from M2 OQ-3):** `/history` date-only filters are UTC days. The
  History view's FilterBar must send datetimes with an offset, built from the user's
  *local* midnight (e.g. `new Date(y, m, d).toISOString()`), not bare `YYYY-MM-DD`
  dates. Otherwise a user at UTC+2 picking "Oct 2" gets 02:00 to 02:00 local time.

- Whether to persist bounding boxes in history (currently: no, only summary stats —
  see ARCHITECTURE.md §3.4). Revisit if History view ever needs per-box replay.
- ~~Frontend charting library for History view (not yet chosen).~~ Chosen in M4:
  Recharts used directly, for a true time axis.
