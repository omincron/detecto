# Detecto — Architecture

Real-time person detection and counting system. FastAPI backend serves a pretrained
object detection model; a React/Vite frontend uploads images, renders detections, and
visualizes history.

## 1. System overview

```
┌─────────────────────────┐        HTTP (multipart/JSON)        ┌───────────────────────────┐
│        Frontend         │ ───────────────────────────────────▶│         Backend            │
│   React + Vite (SPA)    │                                      │        FastAPI             │
│                          │ ◀─────────────────────────────────── │                             │
│  - Detection View        │        JSON (boxes, counts,          │  /detect                   │
│  - History View          │        confidences, image)           │  /history                   │
└─────────────────────────┘                                      │  /reset                     │
                                                                    │                             │
                                                                    │  detection pipeline:        │
                                                                    │   preprocess → YOLOv8       │
                                                                    │   → filter "person" → boxes │
                                                                    │                             │
                                                                    │  storage: SQLite            │
                                                                    └───────────────────────────┘
```

Design principle: **backend is a stateless inference service + a thin persistence
layer**; **frontend owns no detection logic**, only rendering and interaction. This
keeps both sides independently testable, per the project requirements.

## 2. Repository layout

```
detecto/
├── frontend/
│   ├── public/
│   │   └── samples/            # ≥10 demo images for manual testing
│   ├── src/
│   │   ├── api/
│   │   │   └── client.js       # fetch wrappers for /detect, /history, /reset
│   │   ├── components/
│   │   │   ├── ImageUploader.jsx
│   │   │   ├── BoundingBoxOverlay.jsx
│   │   │   ├── DetectionSummary.jsx
│   │   │   ├── HistoryTable.jsx
│   │   │   ├── HistoryChart.jsx
│   │   │   └── FilterBar.jsx
│   │   ├── pages/
│   │   │   ├── DetectionView.jsx
│   │   │   └── HistoryView.jsx
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── .env                    # VITE_API_BASE_URL
│   └── package.json
│
├── backend/
│   ├── main.py                 # FastAPI app, CORS, router registration
│   ├── routes/
│   │   ├── detect.py           # POST /detect
│   │   └── history.py          # GET /history, DELETE /reset
│   ├── models/
│   │   └── record.py           # Pydantic + SQLite schema for a Detection record
│   ├── services/
│   │   ├── detector.py         # loads YOLO model once, runs inference
│   │   └── storage.py          # read/write to SQLite
│   ├── utils/
│   │   └── preprocessing.py    # resize, normalize, decode image bytes
│   ├── samples/                # backend-side copies for CLI/test scripts
│   └── tests/
│       ├── test_detect.py
│       └── test_history.py
│
├── requirements.txt
├── README.md
└── .env                        # MODEL_PATH, CONFIDENCE_THRESHOLD, DB_PATH, etc.
```

## 3. Backend architecture

### 3.1 Layers

- **`routes/`** — HTTP layer only: parse request, call a service, shape the response.
  No inference or SQL here.
- **`services/detector.py`** — loads the YOLOv8 model **once** at startup (module-level
  singleton or FastAPI `lifespan`), exposes `detect(image: np.ndarray) -> DetectionResult`.
  Filters model output to COCO class `0` ("person") only.
- **`services/storage.py`** — all persistence. Swappable backend (SQLite now, could be
  Postgres later) behind a small interface: `save(record)`, `list(filters)`, `clear()`.
- **`utils/preprocessing.py`** — pure functions: decode upload → `np.ndarray`, resize,
  normalize. No I/O, no framework imports — easy to unit test.
- **`models/record.py`** — the single source of truth for what a "detection record"
  looks like, shared by the Pydantic response model and the SQLite table definition.

### 3.2 Detection pipeline (per request)

1. Receive image (multipart file; base64 JSON body deferred — see §3.3).
2. Validate: declared content-type, non-empty, size limit, magic bytes, decodable → else `400`/`413`/`415` with a clear message.
3. Preprocess: decode bytes → array, resize to model input size, normalize.
4. Run inference (`model.predict(...)`), timing the call.
5. Filter detections to `person` class, apply confidence threshold.
6. Build response: count, list of `{bbox: [x1,y1,x2,y2], confidence}`, inference time,
   average confidence.
7. Optionally draw overlays and return the annotated image as base64.
8. Persist a summary record (timestamp, count, avg confidence, inference time) via
   `storage.save(...)`.
9. Return JSON.

### 3.3 API contract

**`POST /detect`**
- Input: `multipart/form-data` (file field `image`). A `{"image_base64": "..."}` JSON body
  is planned but deferred past Milestone 1.
- Query params: `return_annotated` (bool, default `false`). The annotated image is opt-in.
- Accepted formats: JPEG and PNG, identified by the file's magic bytes. The declared
  Content-Type is only loosely checked: `image/jpeg`, `image/jpg`, `image/png`,
  `application/octet-stream` or none (case-insensitive) are let through to the byte check.
- Max upload size: `MAX_UPLOAD_BYTES` (default 10 MiB).
- Output:
```json
{
  "count": 3,
  "detections": [
    {"bbox": [x1, y1, x2, y2], "confidence": 0.91}
  ],
  "average_confidence": 0.87,
  "inference_time_ms": 142.3,
  "image_width": 1280,
  "image_height": 720,
  "annotated_image_base64": null   // base64 JPEG when return_annotated=true
}
```
  - `bbox` is in pixels of the *processed* frame (`image_width` x `image_height`, after
    the resize to max 1280px on the long edge, each side ≥ 1px), not the original upload.
  - `inference_time_ms` (float) is the model `predict` call only, excluding decode,
    preprocessing and annotation. The model is warmed at startup (`WARMUP_MODEL`), so the
    first request does not include warm-up.
  - A detection is kept only if its confidence is strictly greater than `CONFIDENCE_THRESHOLD`.
- Errors (all with a `{"detail": "<string>"}` body the frontend can display directly):
  - `400` missing, empty, corrupt or unrecognized file
  - `413` file larger than `MAX_UPLOAD_BYTES`
  - `415` unsupported format: a non-image declared type, or a real non-JPEG/PNG image
  - `500` inference failure

**`GET /health`**
- Returns `200 {"status": "ok"}` without loading the model. The frontend's sidebar
  status card polls it every 30 s, with a 5 s timeout.

**`GET /history`**
- Query params (all optional):
  - `start_date`, `end_date` take a date (`2026-10-02`) or an ISO datetime
    (`2026-10-02T14:30`, `…Z`, `…+02:00`). A value without a timezone is taken as UTC.
  - `start_date` is inclusive. A date-only `end_date` includes that whole day. A
    datetime `end_date` is exclusive.
  - `min_confidence` (0–1) keeps records whose *average* confidence is ≥ the value.
    Records with no people (`count == 0`) are always kept, so the chart doesn't lose
    its "nobody present" points when the threshold moves.
  - An empty value (`?min_confidence=`) means the same as leaving the parameter out.
- Output: array of stored records `{id, timestamp, count, average_confidence,
  inference_time_ms}`, oldest first. `timestamp` is UTC ISO 8601 with `Z`.
- Errors: `400` for an unparseable date or number, a date that can't be represented in
  UTC, `start_date` ≥ `end_date`, or `min_confidence` outside 0–1. Never `500` for a
  parseable date.

**`DELETE /reset`**
- Clears all stored records. Returns `{"status": "cleared", "count_removed": N}`.

**All endpoints:** request validation errors are `400` with a string `detail`, not
FastAPI's default `422` list.

**Persistence from `/detect`:** each *successful* detection saves one record (step 8).
Rejected uploads, inference failures and annotation failures save nothing: the
record is saved only once the full response has been built. If the save itself fails, the
error is logged and the detection result is still returned. Each detection also writes
one `INFO` log line (count, average confidence, inference time, frame size).

### 3.4 Storage schema (SQLite)

```sql
CREATE TABLE detections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  person_count INTEGER NOT NULL,
  average_confidence REAL NOT NULL,
  inference_time_ms REAL NOT NULL
);
```
Raw bounding boxes are not persisted by default (history is a trend view, not a replay
log) — keep that decision explicit rather than accidental; revisit only if the History
view later needs per-box detail.

### 3.5 Configuration (`.env`)

```
MODEL_PATH=yolov8n.pt
CONFIDENCE_THRESHOLD=0.5
DB_PATH=./backend/detecto.db       # relative paths resolve from the project root
CORS_ORIGINS=http://localhost:5173
MAX_UPLOAD_BYTES=10485760
WARMUP_MODEL=true
```

## 4. Frontend architecture

### 4.1 Pages

- **DetectionView** — upload/select an image (including from `public/samples/`),
  call `/detect`, render the returned image with `BoundingBoxOverlay`, show
  `DetectionSummary` (count, avg confidence, processing time). Handles and surfaces
  API errors inline.
  - **Upload pre-check** (`utils/validateUpload.js`): before uploading, the browser
    rejects an empty file, a file over `VITE_MAX_UPLOAD_MB`, or a declared type that's
    clearly not JPEG/PNG. An empty type or `application/octet-stream` is let through.
    The error is shown instantly in the same alert. This is only a fast path: the
    backend stays the authoritative validator (magic bytes, decoding, its own
    `MAX_UPLOAD_BYTES`). `VITE_MAX_UPLOAD_MB` must equal `MAX_UPLOAD_BYTES`, and a test
    checks that the two match.
- **HistoryView** — on mount, call `/history`; render `HistoryTable` and
  `HistoryChart` (timestamp vs. count); `FilterBar` re-queries `/history` with
  date/time/confidence params.

### 4.2 Key component: `BoundingBoxOverlay`

The most bug-prone piece. Contract: it receives the **frame dimensions the boxes
refer to**, which are the backend's `image_width`/`image_height` (the processed, possibly
downscaled frame), not the uploaded file's own size.

*As built (M3):*
- Each `bbox` is converted to **percentages of that frame**
  (`utils/bbox.js → bboxToPercentRect`) and drawn as an absolutely-positioned `<div>`
  over the `<img>`.
- Because the boxes are in percentages, they follow the displayed image at any size
  through CSS alone. There's no need to measure displayed dimensions or re-render on
  resize, which also keeps rendering smooth with many detections.
- The processed frame is a uniform downscale of the upload, so the aspect ratios match.
- All the box math lives in that one function, so it's tested once.

### 4.3 State & data flow

- No global state library needed at this scope — `useState`/`useEffect` per page is
  sufficient. If the webcam bonus is added, a small `useDetectionStream` hook can
  encapsulate the polling/websocket loop.
- `src/api/client.js` is the only place that knows the backend base URL
  (`VITE_API_BASE_URL`) and response shape — pages/components consume typed
  JS objects, not raw fetch calls. It maps snake_case to camelCase, and turns any failure into an
  `ApiError` whose message can be shown as-is: the backend's `detail`, or a "can't reach
  the server" message.
- Navigation between the two pages is plain component state, with no router dependency.
- UI kit: Mantine, with the theme in `src/theme.js` (neutral base, pastel palettes,
  IBM Plex fonts bundled through @fontsource, light mode only). The app shell is a Mantine
  `AppShell`: a sidebar with the "Pages" navigation and a `BackendStatus` card
  (`/health`), collapsing behind a burger button below the `sm` breakpoint.
- Frontend settings (`frontend/.env`): `VITE_API_BASE_URL` and `VITE_MAX_UPLOAD_MB`.
- Demo images in `public/samples/` are listed in `public/samples/index.json`
  (`[{file, label}]`), because a static site can't list a folder.
- DetectionView shows two timings:
  - **model time**, the backend's `inference_time_ms`;
  - **total time**, the browser's round trip: upload, server and response.

  If a new image is picked while one is still processing, only the latest response is
  shown.

## 5. Testing & evaluation

- **Backend unit tests**: `utils/preprocessing.py` (pure functions), `services/storage.py`
  (CRUD against a temp SQLite file), route tests via `TestClient` for `/detect` (valid
  image, missing file, corrupt file) and `/history`/`/reset`.
- **Frontend**: component tests for `BoundingBoxOverlay` scaling math and
  `FilterBar` query construction.
- **Model evaluation**: run the 10+ sample images through `/detect`, manually count
  ground-truth people per image, compute accuracy/false-positive rate/avg
  confidence/avg inference time exactly as specified in `instructions.md`, record in
  `README.md`.

## 6. Extension points (bonus features)

Each maps to a specific seam already in this architecture, so they're additive, not
rework:

| Bonus | Extends |
|---|---|
| Webcam/live feed | New `useDetectionStream` hook in frontend; backend `/detect` reused per-frame, or a new `/detect/stream` WebSocket route |
| Region-based alerts | New rule check in `services/detector.py` after box filtering, before response |
| Heatmaps / tracking lines | New aggregation in `services/storage.py` over stored (x,y) centroids — requires persisting box centroids, a schema addition |
| Hourly stats panel | New query in `services/storage.py` (`GROUP BY strftime('%H', timestamp)`) + `/history/stats` route |
| CSV/Excel export | New `/history/export` route streaming a CSV built from `storage.list()` |

## 7. Tech stack rationale

- **YOLOv8n via `ultralytics`**: pretrained on COCO (includes `person`), CPU-friendly,
  minimal setup — avoids training entirely, matching the project's "pretrained model"
  requirement.
- **SQLite**: zero-setup persistence that still supports the date/confidence filtering
  `/history` needs (vs. flat JSON, which would require loading the whole file to filter).
- **FastAPI**: async-capable, automatic OpenAPI docs (useful for manually exercising
  `/detect` while building the frontend), built-in `UploadFile` handling.
- **Vite + React**: fast dev loop for iterating on the bounding-box overlay, which
  needs a lot of visual trial-and-error.
