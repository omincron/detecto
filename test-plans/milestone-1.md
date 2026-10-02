# Test plan — Milestone 1: Backend skeleton (FastAPI + YOLOv8n `/detect`)

## Scope

Milestone 1 (commit `4716d00`) added:
- `backend/config.py` — env-driven config (`MODEL_PATH`, `CONFIDENCE_THRESHOLD`, `CORS_ORIGINS`, `DB_PATH`).
- `backend/utils/preprocessing.py` — `decode_image`, `preprocess_image` (resize long edge to max 1280 + CLAHE), `encode_image_base64`.
- `backend/services/detector.py` — `PersonDetector` (YOLO, person class only, confidence threshold, timing, `annotate`) and cached `get_detector()` dependency.
- `backend/models/record.py` — `Detection`, `DetectionResponse` schemas.
- `backend/routes/detect.py` — `POST /detect` (multipart field `image`, optional `return_annotated` query flag).
- `backend/main.py` — app, CORS middleware, `GET /health`.

**In scope:** `/health`, `/detect` (happy paths, documented errors, edge cases), preprocessing pure functions, detector wrapper logic (with a mocked YOLO model), config parsing, CORS, and a small set of real-model integration tests.

**Out of scope (later milestones):** persistence / SQLite side effects of `/detect`, `/history`, `/reset` (Milestone 2), frontend (Milestones 3–4), accuracy evaluation on 10 sample images (Milestone 5). `DB_PATH` is read by config but unused in M1.

**Conventions for the generator:**
- Unit tests replace the detector with a fake via `app.dependency_overrides[get_detector]`. The fake returns a configurable list of `{"bbox": [x1,y1,x2,y2], "confidence": c}` plus a fixed `inference_time_ms`, records the array it received and how many times `detect` was called, and has an `annotate` method that returns a copy of the image.
- Test images are generated in-memory with numpy/cv2 (`cv2.imencode`).
- Integration tests (`@pytest.mark.integration`) use the real `yolov8n.pt` and the images bundled with ultralytics (`ultralytics.utils.ASSETS / "bus.jpg"`, `"zidane.jpg"`), because `backend/samples/` does not exist yet (see Open questions).
- "Error body" below means: response is JSON and `body == {"detail": <non-empty str>}`, as required by ARCHITECTURE.md §3.3 ("all with a `{"detail": "..."}` body the frontend can display directly").
- All open questions were resolved by the user on 2026-10-02 (see "Resolved decisions" at the end). Several resolutions are app changes that have not been made yet. Write the tests to the resolved behavior anyway: those tests are expected to fail until the app is fixed. Do not skip them or mark them xfail.
- Model warm-up at startup (OQ-8) is controlled by `config.WARMUP_MODEL`. Unit tests must run with it off (`monkeypatch.setattr(config, "WARMUP_MODEL", False)` or an autouse fixture), except the M1-startup cases.

## Test cases

### GET /health

- **ID** M1-health-01
- **Behavior:** The health endpoint reports the service is up without loading the model.
- **Source:** PROGRESS.md M1 (`/health` → `200 {"status": "ok"}`; model loads lazily on first `/detect`)
- **Setup:** TestClient. No dependency override. `config.WARMUP_MODEL = False`. `get_detector.cache_clear()` before the test, and `PersonDetector` / `YOLO` patched to raise if constructed.
- **Steps → Expected:** `GET /health` → `200`, body `{"status": "ok"}`, and the YOLO constructor was never called.
- **Type:** unit

### POST /detect — happy paths

- **ID** M1-detect-01
- **Behavior:** A valid PNG upload returns 200 with the full response schema.
- **Source:** ARCHITECTURE.md §3.3, instructions.md "Backend" (`/detect` returns count, coordinates, confidence per person), PROGRESS.md M1 (`image_width`/`image_height`)
- **Setup:** Fake detector returns `[{"bbox":[1,2,30,40],"confidence":0.9},{"bbox":[5,5,20,20],"confidence":0.6}]`, `inference_time_ms=12.5`. Upload an 80x50 (WxH) black PNG as `image`, content type `image/png`.
- **Steps → Expected:** `200`. Body has keys `count`, `detections`, `average_confidence`, `inference_time_ms`, `image_width`, `image_height`, `annotated_image_base64`. `count == 2`. `detections == [{"bbox":[1.0,2.0,30.0,40.0],"confidence":0.9},{"bbox":[5.0,5.0,20.0,20.0],"confidence":0.6}]`. Every `bbox` has exactly 4 numbers.
- **Type:** unit

- **ID** M1-detect-02
- **Behavior:** A valid JPEG upload is accepted.
- **Source:** instructions.md "Backend" (accepts JPEG, PNG)
- **Setup:** Same fake. 80x50 JPEG, content type `image/jpeg`.
- **Steps → Expected:** `200`, `count == 2`.
- **Type:** unit

- **ID** M1-detect-03
- **Behavior:** `average_confidence` is the arithmetic mean of the returned detections' confidences, and `count` equals `len(detections)`.
- **Source:** instructions.md "AI & Processing" (average confidence), ARCHITECTURE.md §3.2 step 6
- **Setup:** Fake returns 3 detections with confidences 0.9, 0.6, 0.75.
- **Steps → Expected:** `200`, `count == 3`, `len(detections) == 3`, `average_confidence == pytest.approx(0.75)`.
- **Type:** unit

- **ID** M1-detect-04
- **Behavior:** An image with no people returns an empty result, not an error.
- **Source:** ARCHITECTURE.md §3.3 (count/detections contract); PROGRESS.md M1 (avg confidence 0 when no detections)
- **Setup:** Fake returns `[]`.
- **Steps → Expected:** `200`, `count == 0`, `detections == []`, `average_confidence == 0.0`.
- **Type:** unit

- **ID** M1-detect-05
- **Behavior:** `image_width`/`image_height` report the processed frame's size. A small image is not upscaled.
- **Source:** PROGRESS.md M1 decisions ("Response includes image_width/image_height of the processed frame (post-resize)"; resize to max 1280px)
- **Setup:** Fake detector. Upload an 80x50 PNG.
- **Steps → Expected:** `image_width == 80`, `image_height == 50`. The array passed to the fake has shape `(50, 80, 3)`.
- **Type:** unit

- **ID** M1-detect-06
- **Behavior:** A large image is downscaled so the long edge is 1280 before inference, and the response dimensions match what the detector received.
- **Source:** PROGRESS.md M1 (resize to max 1280px on the long edge; boxes are relative to the processed frame)
- **Setup:** Fake detector. Upload a 3000x1000 (WxH) PNG.
- **Steps → Expected:** `200`, `image_width == 1280`, `image_height` in {426, 427}. The fake received exactly one array with shape `(image_height, image_width, 3)`.
- **Type:** unit

- **ID** M1-detect-07
- **Behavior:** No annotated image is returned unless requested.
- **Source:** ARCHITECTURE.md §3.3 (`annotated_image_base64` optional), PROGRESS.md M1 (`return_annotated=true`)
- **Setup:** Fake detector. PNG upload with no query params.
- **Steps → Expected:** `200`, `annotated_image_base64` is `null` or absent. Fake `annotate` not called. (OQ-3: opt-in is the agreed contract.)
- **Type:** unit

- **ID** M1-detect-08
- **Behavior:** With `return_annotated=true`, the response contains a base64 JPEG of the processed frame.
- **Source:** instructions.md "Backend" (processed image as base64), PROGRESS.md M1
- **Setup:** Fake detector with 2 detections. 80x50 PNG upload. `POST /detect?return_annotated=true`.
- **Steps → Expected:** `200`. `annotated_image_base64` is a non-empty str. `base64.b64decode` succeeds, the bytes start with `FF D8 FF`, and `cv2.imdecode` gives shape `(50, 80, 3)`. The fake's `annotate` was called once with the detections list.
- **Type:** unit

- **ID** M1-detect-09
- **Behavior:** `inference_time_ms` is a non-negative number taken from the detector's timing.
- **Source:** ARCHITECTURE.md §3.2 step 4, §3.3; instructions.md "Backend" (performance logging)
- **Setup:** Fake returns `inference_time_ms=12.5`.
- **Steps → Expected:** `inference_time_ms == 12.5`, type is int or float, value ≥ 0.
- **Type:** unit

- **ID** M1-detect-10
- **Behavior:** A grayscale PNG is accepted and passed to the detector as a 3-channel image.
- **Source:** instructions.md "Backend" (PNG accepted); ARCHITECTURE.md §3.2 step 3
- **Setup:** Fake detector. 80x50 single-channel PNG.
- **Steps → Expected:** `200`. The fake received an array with shape `(50, 80, 3)` and dtype `uint8`.
- **Type:** unit

- **ID** M1-detect-11
- **Behavior:** `/detect` accepts a base64-encoded image in a JSON body.
- **Status:** **Deferred (OQ-1)**, so not part of M1. Do not generate this test. It is kept here so the milestone that adds base64 input picks it up.
- **Source:** instructions.md "Backend" ("via multipart/form-data or base64"), ARCHITECTURE.md §3.3 (`{"image_base64": "..."}`)
- **Setup:** Fake detector. JSON body `{"image_base64": <base64 of an 80x50 PNG>}`.
- **Steps → Expected:** `200`, `count == 2`, `image_width == 80`, `image_height == 50`.
- **Type:** unit

### POST /detect — errors

- **ID** M1-detect-err-01
- **Behavior:** An empty upload is rejected with 400 and the detector is not called.
- **Source:** ARCHITECTURE.md §3.2 step 2, §3.3 (`400` invalid/missing file); instructions.md "Backend" (empty uploads); PROGRESS.md smoke test
- **Setup:** Fake detector. `image` = 0 bytes, content type `image/jpeg`.
- **Steps → Expected:** `400`, error body, and `detail` contains "empty" (case-insensitive). Fake `detect` call count == 0.
- **Type:** unit

- **ID** M1-detect-err-02
- **Behavior:** A non-image content type is rejected with 415.
- **Source:** ARCHITECTURE.md §3.3 (`415` unsupported format); instructions.md "Backend"; PROGRESS.md smoke test
- **Setup:** Fake detector. `image` = `b"hello"`, filename `a.txt`, content type `text/plain`.
- **Steps → Expected:** `415`, error body, and `detail` contains `text/plain`. Fake not called.
- **Type:** unit

- **ID** M1-detect-err-03
- **Behavior:** Image formats other than JPEG/PNG are rejected with 415, whether they are identified by the declared type or by the file's actual bytes.
- **Source:** instructions.md "Backend" ("accepts an image file (JPEG, PNG)"), ARCHITECTURE.md §3.3; OQ-4 resolution
- **Setup:** Fake detector. Parametrize:
  - (a) a valid BMP (`cv2.imencode(".bmp")`) declared `image/bmp`
  - (b) any bytes declared `image/gif`
  - (c) a valid BMP declared `image/jpeg`
  - (d) GIF bytes (`b"GIF89a" + 50 zero bytes`) declared `image/jpeg`
  - (e) a WEBP (`cv2.imencode(".webp")`) declared `image/png`
- **Steps → Expected:** `415` for each, error body, and the fake is not called. For (c)–(e), `detail` mentions JPEG and PNG.
- **Type:** unit

- **ID** M1-detect-err-04
- **Behavior:** Corrupt bytes declared as JPEG are rejected with 400 and the detector is not called.
- **Source:** ARCHITECTURE.md §3.2 step 2 ("decodable → else 400"), §5 ("corrupt file")
- **Setup:** Fake detector. `image` = `b"notanimage"`, content type `image/jpeg`.
- **Steps → Expected:** `400`, error body. Fake not called.
- **Type:** unit

- **ID** M1-detect-err-05
- **Behavior:** A truncated PNG (valid header, missing data) is rejected with 400.
- **Source:** ARCHITECTURE.md §3.2 step 2
- **Setup:** Fake detector. First 30 bytes of a valid PNG, content type `image/png`.
- **Steps → Expected:** `400`, error body. Fake not called.
- **Type:** unit

- **ID** M1-detect-err-06
- **Behavior:** A request with no file returns 400 with a displayable `detail` string.
- **Source:** ARCHITECTURE.md §3.3 (`400` invalid/missing file, `{"detail": "..."}`); instructions.md "Backend" (missing files)
- **Setup:** Fake detector. Parametrize: (a) `POST /detect` with no body, (b) multipart with the file under field name `file` instead of `image`.
- **Steps → Expected:** `400`, error body (`detail` is a non-empty str, not a list). Fake not called. (OQ-2.)
- **Type:** unit

- **ID** M1-detect-err-07
- **Behavior:** A failure in the detector returns 500 with a `detail` message.
- **Source:** ARCHITECTURE.md §3.3 (`500` inference failure)
- **Setup:** Fake detector whose `detect` raises `RuntimeError("kaboom")`. Valid PNG upload.
- **Steps → Expected:** `500`, error body, and `detail` starts with "Inference failed".
- **Type:** unit

- **ID** M1-detect-err-08
- **Behavior:** An image with an extreme aspect ratio is processed: no side is resized below 1px.
- **Source:** instructions.md "Testing & Validation" (process images without crashes); OQ-5 resolution (clamp to ≥ 1px)
- **Setup:** Fake detector. Parametrize: 4000x1 (WxH) PNG and 1x4000 PNG. (Unclamped downscaling would make one side 0.)
- **Steps → Expected:** `200`. For 4000x1: `image_width == 1280`, `image_height == 1`. For 1x4000: `image_width == 1`, `image_height == 1280`. The fake received an array with exactly that shape plus 3 channels.
- **Type:** unit

- **ID** M1-detect-err-09
- **Behavior:** `/detect` only accepts POST.
- **Source:** ARCHITECTURE.md §3.3 (`POST /detect`)
- **Setup:** TestClient.
- **Steps → Expected:** `GET /detect` → `405`.
- **Type:** unit

- **ID** M1-detect-err-10
- **Behavior:** The declared Content-Type is treated leniently, and the file's actual bytes decide the format.
- **Source:** OQ-4 resolution
- **Setup:** Fake detector (2 detections). Parametrize with a valid 80x50 PNG or JPEG:
  - (a) a PNG declared `image/jpg`
  - (b) a PNG declared `IMAGE/PNG`
  - (c) a PNG declared `application/octet-stream`
  - (d) a PNG declared `image/jpeg` (mismatch)
  - (e) a JPEG declared `image/png` (mismatch)
  - (f) a JPEG declared `image/jpeg; charset=binary` (header with parameters)
- **Steps → Expected:** `200`, `count == 2` for each.
- **Type:** unit

- **ID** M1-detect-err-11
- **Behavior:** Uploads larger than `config.MAX_UPLOAD_BYTES` are rejected with 413 before decoding.
- **Source:** OQ-11 resolution
- **Setup:** Fake detector. `monkeypatch.setattr(config, "MAX_UPLOAD_BYTES", 1000)`. Parametrize: a valid PNG padded to 1001 bytes (or any PNG larger than 1000 bytes), and a PNG of exactly 1000 bytes or less.
- **Steps → Expected:** The oversized file gets `413`, an error body, and the fake is not called. A file within the limit gets `200`. The limit is read at request time, not at import.
- **Type:** unit

### utils/preprocessing.py

- **ID** M1-prep-01
- **Behavior:** `decode_image` turns valid JPEG and PNG bytes into a BGR `uint8` array of the original size.
- **Source:** PROGRESS.md M1 (`decode_image` bytes → array); ARCHITECTURE.md §3.1 (pure functions)
- **Setup:** Encode a 80x50 3-channel image as JPEG and as PNG.
- **Steps → Expected:** Each returns an `np.ndarray` with shape `(50, 80, 3)` and dtype `uint8`.
- **Type:** unit

- **ID** M1-prep-02
- **Behavior:** `decode_image` normalizes grayscale and RGBA PNGs to 3 channels.
- **Source:** ARCHITECTURE.md §3.2 step 3 (decode bytes → array for the model)
- **Setup:** 10x10 single-channel PNG. 10x10 4-channel PNG.
- **Steps → Expected:** Both return shape `(10, 10, 3)` and dtype `uint8`.
- **Type:** unit

- **ID** M1-prep-03
- **Behavior:** `decode_image` raises `ValueError` on undecodable bytes.
- **Source:** PROGRESS.md M1 ("raises on corrupt/unsupported files")
- **Setup:** None.
- **Steps → Expected:** `decode_image(b"notanimage")` raises `ValueError`. So does a truncated PNG (first 30 bytes).
- **Type:** unit

- **ID** M1-prep-04
- **Behavior:** `decode_image(b"")` raises `ValueError`.
- **Source:** PROGRESS.md M1 ("raises on corrupt/unsupported files")
- **Setup:** None.
- **Steps → Expected:** `ValueError` is raised. (OQ-6.)
- **Type:** unit

- **ID** M1-prep-05
- **Behavior:** `preprocess_image` does not resize images whose long edge is ≤ 1280, and never upscales.
- **Source:** PROGRESS.md M1 ("resize to max 1280px on the long edge")
- **Setup:** Parametrize input shapes `(50, 80, 3)`, `(720, 1280, 3)`, `(1280, 720, 3)`, `(2, 2, 3)`.
- **Steps → Expected:** Output shape equals input shape.
- **Type:** unit

- **ID** M1-prep-06
- **Behavior:** `preprocess_image` scales images with a long edge > 1280 so the long edge is exactly 1280, keeping the aspect ratio within 1px.
- **Source:** PROGRESS.md M1
- **Setup:** Parametrize (H, W) inputs: `(1000, 3000)` landscape, `(4000, 2000)` portrait, `(10, 1281)` just over the boundary.
- **Steps → Expected:** Outputs `(1000,3000)` → `(426±1, 1280)`. `(4000,2000)` → `(1280, 640)`. `(10,1281)` → `(9 or 10, 1280)`. All have 3 channels.
- **Type:** unit

- **ID** M1-prep-06b
- **Behavior:** `preprocess_image` never produces a side smaller than 1px.
- **Source:** OQ-5 resolution
- **Setup:** Parametrize (H, W) inputs `(1, 4000)`, `(4000, 1)` and `(2, 5000)`.
- **Steps → Expected:** Outputs `(1, 1280)`, `(1280, 1)` and `(1, 1280)`, each with 3 channels.
- **Type:** unit

- **ID** M1-prep-07
- **Behavior:** `preprocess_image` returns a 3-channel `uint8` array and does not modify its input.
- **Source:** ARCHITECTURE.md §3.1 (pure functions)
- **Setup:** Random `uint8` image of shape `(100, 120, 3)`, plus a copy.
- **Steps → Expected:** Output dtype is `uint8` and the output has 3 channels. Afterwards the input array equals the copy (`np.array_equal`).
- **Type:** unit

- **ID** M1-prep-08
- **Behavior:** `preprocess_image` increases local contrast on a low-contrast frame.
- **Source:** instructions.md "AI & Processing" (contrast adjustment); PROGRESS.md M1 (CLAHE on luminance)
- **Setup:** 200x200 grayscale-as-BGR image with a horizontal gradient from 100 to 115.
- **Steps → Expected:** The standard deviation of the output's grayscale is greater than the input's.
- **Type:** unit

- **ID** M1-prep-09
- **Behavior:** `encode_image_base64` returns a base64 string of a JPEG that decodes to the same dimensions.
- **Source:** instructions.md "Backend" (processed image as base64); PROGRESS.md M1
- **Setup:** 80x50 3-channel image.
- **Steps → Expected:** Returns `str`. `base64.b64decode(s)` starts with `b"\xff\xd8\xff"`. `cv2.imdecode` gives shape `(50, 80, 3)`.
- **Type:** unit

### services/detector.py (YOLO mocked)

- **ID** M1-detector-01
- **Behavior:** `PersonDetector.detect` asks the model for person class only (COCO 0) at the configured confidence threshold.
- **Source:** ARCHITECTURE.md §3.1 ("Filters model output to COCO class 0"), §3.2 step 5
- **Setup:** Patch `backend.services.detector.YOLO` with a mock whose `predict` returns one result with 2 boxes. Each box has `xyxy[0].tolist()` → `[10,20,30,40]` and `conf[0]` → 0.8. Build `PersonDetector("x.pt", 0.42)`.
- **Steps → Expected:** `predict` was called once with `classes=[0]` and `conf=0.42`. The return value is `(detections, t)` where `detections == [{"bbox":[10,20,30,40],"confidence":0.8}] * 2`, every confidence is a Python `float`, and `t` is a float ≥ 0.
- **Type:** unit

- **ID** M1-detector-02
- **Behavior:** `detect` returns an empty list when the model finds nothing.
- **Source:** ARCHITECTURE.md §3.2
- **Setup:** Same mock with zero boxes.
- **Steps → Expected:** `detections == []`, `t >= 0`.
- **Type:** unit

- **ID** M1-detector-03
- **Behavior:** `annotate` draws on a copy and leaves the input image unchanged.
- **Source:** instructions.md "AI & Processing" (image with overlays); ARCHITECTURE.md §3.2 step 7
- **Setup:** Detector with patched YOLO. Black image of shape `(100, 100, 3)`. Detections `[{"bbox":[10,20,60,80],"confidence":0.9}]`.
- **Steps → Expected:** Output shape is `(100,100,3)`. The output is not identical to the input (pixels differ). The input is still all zeros. With `detections=[]`, the output equals the input.
- **Type:** unit

- **ID** M1-detector-04
- **Behavior:** `get_detector` builds the model once (cached) from `config.MODEL_PATH` and `config.CONFIDENCE_THRESHOLD`.
- **Source:** ARCHITECTURE.md §3.1 (load model once); PROGRESS.md M1 (`lru_cache`)
- **Setup:** Patch `YOLO`. `get_detector.cache_clear()`. Monkeypatch `config.MODEL_PATH="m.pt"` and `config.CONFIDENCE_THRESHOLD=0.33`.
- **Steps → Expected:** Two calls return the same object (`is`). `YOLO` was called once, with `"m.pt"`. `confidence_threshold == 0.33`. Clear the cache in teardown.
- **Type:** unit

### Startup warm-up (main.py lifespan)

- **ID** M1-startup-01
- **Behavior:** With `WARMUP_MODEL` on, app startup loads the detector and runs one inference on a dummy frame before serving requests.
- **Source:** OQ-8 resolution
- **Setup:** `config.WARMUP_MODEL = True`. A fake detector set via `app.dependency_overrides[get_detector]` (startup must resolve the detector through `dependency_overrides` when one is set). `with TestClient(app):` to run the lifespan.
- **Steps → Expected:** Right after entering the context, before any request, the fake's `detect` has been called exactly once with a 3-channel `uint8` array. A following `/detect` request brings the count to 2.
- **Type:** unit

- **ID** M1-startup-02
- **Behavior:** With `WARMUP_MODEL` off, startup does not touch the detector.
- **Source:** OQ-8 resolution
- **Setup:** `config.WARMUP_MODEL = False`, fake override, `with TestClient(app):`.
- **Steps → Expected:** The fake's `detect` call count is 0 after startup. `/health` → 200.
- **Type:** unit

### config.py

- **ID** M1-config-01
- **Behavior:** Environment variables override `.env` defaults and are parsed to the right types.
- **Source:** instructions.md "Code Quality" (env vars for configuration); ARCHITECTURE.md §3.5
- **Setup:** Monkeypatch env `CONFIDENCE_THRESHOLD=0.25`, `CORS_ORIGINS=http://a.com,http://b.com`, `MODEL_PATH=foo.pt`, `MAX_UPLOAD_BYTES=2048`, `WARMUP_MODEL=false`, then `importlib.reload(backend.config)`. Reload again in teardown after restoring the env.
- **Steps → Expected:** `CONFIDENCE_THRESHOLD == 0.25` (a float). `CORS_ORIGINS == ["http://a.com", "http://b.com"]`. `MODEL_PATH == "foo.pt"`. `MAX_UPLOAD_BYTES == 2048` (an int). `WARMUP_MODEL is False`. Also parametrize `WARMUP_MODEL` with `"0"` → `False` and `"true"` → `True`. With the variables unset: `MAX_UPLOAD_BYTES == 10 * 1024 * 1024` and `WARMUP_MODEL is True`.
- **Type:** unit

### CORS

- **ID** M1-cors-01
- **Behavior:** A preflight from the configured frontend origin is allowed.
- **Source:** ARCHITECTURE.md §3.5 (`CORS_ORIGINS=http://localhost:5173`)
- **Setup:** TestClient with the default config.
- **Steps → Expected:** `OPTIONS /detect` with `Origin: http://localhost:5173` and `Access-Control-Request-Method: POST` → `200`, and `access-control-allow-origin == "http://localhost:5173"`.
- **Type:** unit

- **ID** M1-cors-02
- **Behavior:** A preflight from an origin that is not configured is not granted.
- **Source:** ARCHITECTURE.md §3.5
- **Setup:** Same as above with `Origin: http://evil.example`.
- **Steps → Expected:** The response has no `access-control-allow-origin` header (status ≠ 200).
- **Type:** unit

### Integration (real YOLOv8n, `@pytest.mark.integration`)

- **ID** M1-int-01
- **Behavior:** The real model detects people in `bus.jpg` and does not count the bus.
- **Source:** instructions.md "AI & Processing", ARCHITECTURE.md §3.2; PROGRESS.md smoke test (3 people, conf 0.82–0.86)
- **Setup:** No override. Upload `ultralytics.utils.ASSETS/"bus.jpg"` (810x1080) as `image/jpeg`.
- **Steps → Expected:** `200`. `3 <= count <= 4`. `image_width == 810`, `image_height == 1080`. Every confidence is in `[0.5, 1.0]` (the configured threshold). `average_confidence == approx(mean(confidences))`. Every bbox satisfies `0 <= x1 < x2 <= 810` and `0 <= y1 < y2 <= 1080`.
- **Type:** integration

- **ID** M1-int-02
- **Behavior:** The real model counts the 2 people in `zidane.jpg`.
- **Source:** instructions.md "AI & Processing"
- **Setup:** Upload `ASSETS/"zidane.jpg"` (1280x720).
- **Steps → Expected:** `200`, `count == 2`, `image_width == 1280`, `image_height == 720`.
- **Type:** integration

- **ID** M1-int-03
- **Behavior:** A blank frame yields zero detections.
- **Source:** ARCHITECTURE.md §3.3
- **Setup:** 640x480 all-black JPEG.
- **Steps → Expected:** `200`, `count == 0`, `detections == []`, `average_confidence == 0.0`.
- **Type:** integration

- **ID** M1-int-04
- **Behavior:** The real annotation path returns a decodable JPEG the same size as the processed frame.
- **Source:** instructions.md "Backend" (processed image as base64)
- **Setup:** `bus.jpg`, `?return_annotated=true`.
- **Steps → Expected:** `200`. `annotated_image_base64` decodes to a JPEG with shape `(image_height, image_width, 3)`.
- **Type:** integration

- **ID** M1-int-05
- **Behavior:** Warm inference time is reported and is within the assignment's per-image target.
- **Source:** instructions.md "Testing & Validation" (Average Inference Time ≤ 1.5 s)
- **Setup:** `config.WARMUP_MODEL = True`, `get_detector.cache_clear()`, and `with TestClient(app):` so startup warm-up runs. Send `bus.jpg` 3 times.
- **Steps → Expected:** Every `inference_time_ms > 0`, including the first request, which comes after the startup warm-up. The mean over the 3 requests is `< 1500`. (Depends on hardware. `inference_time_ms` is the model `predict` time only, per OQ-8.)
- **Type:** integration

## Regression

Milestone 1 is the first milestone, so there is no earlier behavior to regress. Later milestones must re-run the following as a baseline:
- M1-health-01, M1-detect-01..10, M1-detect-err-01..11, M1-startup-* (the `/detect` contract, error codes and startup)
- M1-prep-* (the preprocessing changes how boxes relate to `image_width`/`image_height`)
- M1-int-01..04

## Resolved decisions (user, 2026-10-02)

The planner's original open questions, with the user's resolution. "App change" means the code must change, and the tests encode the new behavior.

- **OQ-1 — Base64 JSON input:** **deferred** past M1 and recorded in PROGRESS.md. M1-detect-11 is not generated.
- **OQ-2 — Missing file:** **app change.** Return `400` with a string `detail` (no FastAPI 422 list), both when the body is absent and when the field name is wrong.
- **OQ-3 — Annotated image:** opt-in via `?return_annotated=true` is the contract. ARCHITECTURE.md §3.3 is updated.
- **OQ-4 — Format validation:** **app change.**
  - Declared Content-Type is normalized (lowercase, parameters stripped). `image/jpeg`, `image/jpg`, `image/png`, `application/octet-stream` and a missing type pass. Any other declared type gets `415`.
  - The actual format is then sniffed from magic bytes. JPEG/PNG continue. Recognized other image formats (GIF, BMP, WEBP, TIFF) get `415`, with a `detail` naming JPEG and PNG as the accepted formats. Unrecognized bytes, or JPEG/PNG that fail to decode, get `400`.
- **OQ-5 — Extreme aspect ratios:** **app change.** `preprocess_image` clamps each side to ≥ 1px. Such images are processed (`200`).
- **OQ-6 — `decode_image(b"")`:** **app change.** It raises `ValueError`.
- **OQ-7 — Response contract:** ARCHITECTURE.md §3.3 is updated to match the code: `image_width`/`image_height`, float `inference_time_ms`, and `annotated_image_base64` that is always present and may be `null`.
- **OQ-8 — Inference timing and warm-up:** `inference_time_ms` stays **model-predict time only** (documented). **App change:** a FastAPI lifespan warms the model at startup (loads the detector and runs one dummy inference) when `config.WARMUP_MODEL` is true (env `WARMUP_MODEL`, default true; `false`/`0` disable it). The lifespan resolves the detector through `app.dependency_overrides` when one is set.
- **OQ-9 — Performance logging:** deferred to M2, where per-request inference time is persisted. Recorded in PROGRESS.md. No M1 tests.
- **OQ-10 — Threshold boundary:** documented in ARCHITECTURE.md as "strictly greater than `CONFIDENCE_THRESHOLD`" (ultralytics behavior). No unit test.
- **OQ-11 — Upload size limit:** **app change.** `config.MAX_UPLOAD_BYTES` (env `MAX_UPLOAD_BYTES`, default 10 MiB = 10485760). Larger uploads get `413` with an error body, checked after the empty-file check and before decoding.
- **OQ-12 — Test environment:**
  - Fixed. `backend/.venv` now has only `opencv-python-headless==4.10.0.84`, plus `pytest` and `httpx2`, which starlette 1.6's TestClient prefers.
  - `requirements-dev.txt` and a root `pytest.ini` (with `testpaths = backend/tests` and the `integration` marker) were added. Run with `backend/.venv/bin/python -m pytest` from the repo root.
  - Integration tests use ultralytics' bundled `bus.jpg`/`zidane.jpg` for M1. `backend/samples/` comes in M5.
