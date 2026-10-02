# Detecto — Project Log

Running log of what's been built, what's in progress, and what's planned. Read
`ARCHITECTURE.md` first for the design; this file tracks status over time.

Workflow: built in milestones (see plan below). Each milestone is implemented, then
summarized here with the decisions made, before moving to the next.

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

## Open decisions for later milestones

- Whether to persist bounding boxes in history (currently: no, only summary stats —
  see ARCHITECTURE.md §3.4). Revisit if History view ever needs per-box replay.
- Frontend charting library for History view (not yet chosen).
