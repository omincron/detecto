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

1. Receive image (multipart file or base64 JSON body).
2. Validate: content-type, non-empty, decodable → else `400` with a clear message.
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
- Input: `multipart/form-data` (file field `image`) *or* `{"image_base64": "..."}`.
- Output:
```json
{
  "count": 3,
  "detections": [
    {"bbox": [x1, y1, x2, y2], "confidence": 0.91}
  ],
  "average_confidence": 0.87,
  "inference_time_ms": 142,
  "annotated_image_base64": "..."   // optional
}
```
- Errors: `400` invalid/missing file, `415` unsupported format, `500` inference failure
  (all with a `{"detail": "..."}` body the frontend can display directly).

**`GET /history`**
- Query params: `start_date`, `end_date`, `min_confidence` (all optional).
- Output: array of stored records `{id, timestamp, count, average_confidence,
  inference_time_ms}`.

**`DELETE /reset`**
- Clears all stored records. Returns `{"status": "cleared", "count_removed": N}`.

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
DB_PATH=./backend/detecto.db
CORS_ORIGINS=http://localhost:5173
```

## 4. Frontend architecture

### 4.1 Pages

- **DetectionView** — upload/select an image (including from `public/samples/`),
  call `/detect`, render the returned image with `BoundingBoxOverlay`, show
  `DetectionSummary` (count, avg confidence, processing time). Handles and surfaces
  API errors inline.
- **HistoryView** — on mount, call `/history`; render `HistoryTable` and
  `HistoryChart` (timestamp vs. count); `FilterBar` re-queries `/history` with
  date/time/confidence params.

### 4.2 Key component: `BoundingBoxOverlay`

The most bug-prone piece. Contract: it receives the **natural image dimensions**
(width/height at inference time) and the **displayed dimensions** (after CSS
scaling), and scales each `bbox` by `displayed / natural` before drawing — either as
absolutely-positioned `<div>`s over an `<img>`, or as an SVG/`<canvas>` layer. Keep
box-scaling math in one place so it's tested once, not per-usage.

### 4.3 State & data flow

- No global state library needed at this scope — `useState`/`useEffect` per page is
  sufficient. If the webcam bonus is added, a small `useDetectionStream` hook can
  encapsulate the polling/websocket loop.
- `src/api/client.js` is the only place that knows the backend base URL
  (`VITE_API_BASE_URL`) and response shape — pages/components consume typed
  JS objects, not raw fetch calls.

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
