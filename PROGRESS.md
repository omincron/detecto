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

## Status: Milestone 1 complete — Backend skeleton

## Plan (milestones)

1. **Backend skeleton** — FastAPI app, YOLOv8 model loading, `/detect` on a single image *(in progress)*
2. **Storage** — SQLite schema, `/history`, `/reset`
3. **Frontend detection view** — upload + bounding box overlay
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

## Open decisions for later milestones

- Whether to persist bounding boxes in history (currently: no, only summary stats —
  see ARCHITECTURE.md §3.4). Revisit if History view ever needs per-box replay.
- Frontend charting library for History view (not yet chosen).
