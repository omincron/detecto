# Test plan — Milestone 3: Frontend detection view (upload + bounding box overlay)

## Scope

Milestone 3 (uncommitted on top of `f8f502f`) added:
- `frontend/`: Vite 8 + React 19 (JS/JSX), with Vitest + jsdom + Testing Library already configured (`src/test/setup.js`, `npm test`). `frontend/.env` sets `VITE_API_BASE_URL=http://localhost:8000`.
- `src/api/client.js`: `detectPeople(file, {annotated})` and `ApiError`. This is the only module that knows the base URL and the response shape. It maps snake_case to camelCase, and turns every failure into an `ApiError` with a displayable message.
- `src/utils/bbox.js`: `bboxToPercentRect` (all box math), `formatPercent`, `formatMs`.
- `src/components/`: `ImageUploader` (picker, drag-and-drop, samples from `public/samples/index.json`), `BoundingBoxOverlay` (percent-positioned boxes, labels `#n · NN%`, hover highlight), `DetectionSummary` (count, average confidence, model time, total time, per-person list, linked hover).
- `src/pages/DetectionView.jsx` (state machine idle → loading → done | error, stale-response guard, object-URL cleanup), `src/pages/HistoryView.jsx` (placeholder), and `src/App.jsx` (two pages switched by state, with no router).
- `public/samples/`: `bus.jpg` (810×1080), `zidane.jpg` (1280×720), `index.json`.
- `backend/main.py`: the `backend` logger now gets a `StreamHandler` at level INFO (the fix for the M2 bug where the per-detection INFO line never appeared under uvicorn).

**In scope:** unit tests for `bbox.js` and `client.js`. Component tests for the three components, `DetectionView` and `App`. A static check of the sample manifest. Backend tests for the logger fix and for the EXIF/frame-size assumption the overlay depends on. Manual browser checks for anything jsdom cannot see (real layout and box alignment on screen).

**Out of scope:** the History view (M4: table, chart, filters, `/history` and `/reset` from the UI), the 10-sample requirement and README metrics (M5), streaming/webcam (bonus), the `return_annotated` path in the UI (not used by design), and any real-browser E2E tool (none is installed).

**Conventions for the generator:**
- Frontend tests live next to the code or under `src/**/__tests__/` as `*.test.js(x)`. Run with `npm test` in `frontend/`. Note that `npm test` currently exits with code 1 because no test files exist.
- **Mock `fetch`** with `vi.stubGlobal("fetch", vi.fn(...))` and route by URL, because `ImageUploader` fetches `/samples/index.json` on mount in every `DetectionView`/`App` render. The default routes are: `/samples/index.json` → `[]` (unless the case says otherwise), `/samples/<file>` → a JPEG `Blob`, and `…/detect` → the case's response. Build responses with `new Response(body, {status, headers})`.
- **Standard response D2**, mirroring ARCHITECTURE.md §3.3 key for key:
  `{"count": 2, "detections": [{"bbox": [128, 72, 640, 360], "confidence": 0.91}, {"bbox": [640, 360, 1280, 720], "confidence": 0.62}], "average_confidence": 0.765, "inference_time_ms": 142.3, "image_width": 1280, "image_height": 720, "annotated_image_base64": null}`.
  Box 1 is then `left 10% / top 10% / width 40% / height 40%`, and box 2 is `50% / 50% / 50% / 50%`.
- **jsdom gaps:** `URL.createObjectURL` / `URL.revokeObjectURL` are not implemented. Stub them (`vi.fn()` returning `blob:mock/1`, `blob:mock/2`, …). For timing, spy on `performance.now`.
- **user-event v14 applies the input's `accept` attribute by default.** To send a `.txt` or `.gif` through the picker, use `userEvent.setup({ applyAccept: false })` or `fireEvent.change`. A real browser lets the user choose "All files" in the dialog.
- **Deferred promises** for ordering cases: a `/detect` mock that returns a promise the test resolves or rejects by hand.
- **Style assertions:** compare `element.style.left` and the rest as strings (`"50%"`), or `parseFloat(...)` with `toBeCloseTo(x, 6)` for non-integer values.
- Backend cases reuse `backend/tests/conftest.py` (`client`, `fake_detector`, the autouse temp `DB_PATH`). Cases that load the real model are marked `@pytest.mark.integration`.
- All open questions were resolved by the user on 2026-10-02 (see "Resolved decisions" at the end). Cases tagged **[OQ-n]** encode those decisions. OQ-1, OQ-2, OQ-3 and OQ-4 need app changes that haven't been made yet, so those tests are expected to fail until the app is fixed. Do not skip them or mark them xfail.

## Test cases

### utils/bbox.js — `bboxToPercentRect` (unit)

- **ID** M3-bbox-01
- **Behavior:** A box in frame pixels becomes left/top/width/height in percent of the frame.
- **Source:** ARCHITECTURE.md §4.2 ("converted to percentages of that frame")
- **Setup:** None.
- **Steps → Expected:** `bboxToPercentRect([128, 72, 640, 360], 1280, 720)` → `{left: 10, top: 10, width: 40, height: 40}`. `([0, 0, 1280, 720], 1280, 720)` → `{0, 0, 100, 100}`.
- **Type:** unit

- **ID** M3-bbox-02
- **Behavior:** Percentages are relative to the frame dimensions passed in (the backend's processed, possibly downscaled frame), not the original upload.
- **Source:** ARCHITECTURE.md §3.3 (`bbox` is in pixels of the processed frame), §4.2
- **Setup:** A 4000×3000 upload is processed at 1280×960.
- **Steps → Expected:** `([320, 240, 960, 720], 1280, 960)` → `{25, 25, 50, 50}`. The same bbox with `(4000, 3000)` gives `{8, 8, 16, 16}`, which shows the result depends only on the frame arguments. The test documents that the first is the correct call.
- **Type:** unit

- **ID** M3-bbox-03
- **Behavior:** Fractional YOLO coordinates are converted without rounding.
- **Source:** ARCHITECTURE.md §4.2
- **Setup:** None.
- **Steps → Expected:** `([10.5, 20.2, 110.5, 220.2], 200, 400)` → left ≈ 5.25, top ≈ 5.05, width ≈ 50, height ≈ 50 (`toBeCloseTo(…, 6)`).
- **Type:** unit

- **ID** M3-bbox-04
- **Behavior:** Boxes that spill over the frame edges are clamped to the frame.
- **Source:** PROGRESS.md M3 (`bbox.js` comment, "clamped to the frame so a box that spills slightly over an edge stays visible")
- **Setup:** Frame 1280×720.
- **Steps → Expected:** `[-10, -5, 1300, 730]` → `{0, 0, 100, 100}`. `[1200, 700, 1300, 760]` → left 93.75, top ≈ 97.2222, width 6.25, height ≈ 2.7778. No value is < 0 or > 100, and `left + width ≤ 100` and `top + height ≤ 100` in both.
- **Type:** unit

- **ID** M3-bbox-05
- **Behavior:** Swapped corners (x2 < x1 or y2 < y1) give the same rectangle as the ordered box.
- **Source:** ARCHITECTURE.md §4.2 (all box math in one function)
- **Setup:** None.
- **Steps → Expected:** `([640, 360, 128, 72], 1280, 720)` deep-equals the M3-bbox-01 result `{10, 10, 40, 40}`.
- **Type:** unit

- **ID** M3-bbox-06
- **Behavior:** Degenerate boxes produce finite values with zero size and never NaN.
- **Source:** ARCHITECTURE.md §4.2
- **Setup:** None.
- **Steps → Expected:** `([100, 100, 100, 100], 200, 200)` → `{50, 50, 0, 0}`. A box fully outside, `([1300, 800, 1400, 900], 1280, 720)`, → `{left: 100, top: 100, width: 0, height: 0}`. Every value satisfies `Number.isFinite`.
- **Type:** unit

- **ID** M3-bbox-07
- **Behavior:** Extreme aspect-ratio frames (the backend clamps each side to ≥ 1 px) still convert correctly.
- **Source:** ARCHITECTURE.md §3.3 ("each side ≥ 1px")
- **Setup:** None.
- **Steps → Expected:** `([0, 0, 640, 1], 1280, 1)` → `{0, 0, 50, 100}`.
- **Type:** unit

### utils/bbox.js — formatters (unit)

- **ID** M3-fmt-01
- **Behavior:** `formatPercent` renders a 0–1 fraction as a rounded whole percent.
- **Source:** instructions.md "Frontend" ("Show … confidence for each detection"); PROGRESS.md M3 (labels `#n · NN%`)
- **Setup:** None.
- **Steps → Expected:** `0.91 → "91%"`, `0 → "0%"`, `1 → "100%"`, `0.875 → "88%"`, `0.504 → "50%"`.
- **Type:** unit

- **ID** M3-fmt-02
- **Behavior:** `formatMs` shows whole milliseconds below one second and seconds with 2 decimals from one second up.
- **Source:** instructions.md "Frontend" ("Display processing time per frame"); ARCHITECTURE.md §4.3 (two timings)
- **Setup:** None.
- **Steps → Expected:** `142.3 → "142 ms"`, `0 → "0 ms"`, `999.4 → "999 ms"`, `1000 → "1.00 s"`, `1534 → "1.53 s"`. **[OQ-4]** `999.6 → "1.00 s"` (it currently gives `"1000 ms"`).
- **Type:** unit

### api/client.js — `detectPeople` (unit, mocked fetch)

- **ID** M3-api-01
- **Behavior:** `detectPeople` POSTs the file as multipart field `image` to `<base>/detect`, and lets the browser set the multipart Content-Type.
- **Source:** ARCHITECTURE.md §3.3 (multipart, field `image`), §4.3
- **Setup:** `fetch` resolves with D2 (200). `file = new File([bytes], "a.jpg", {type: "image/jpeg"})`.
- **Steps → Expected:** `fetch` is called once. Its URL is `"http://localhost:8000/detect"` (the `.env` value). `options.method === "POST"`, `options.body instanceof FormData`, and `options.body.get("image")` is that same file (same name, size and type). `options.headers` is absent or has no `content-type` key, in any case.
- **Type:** unit

- **ID** M3-api-02
- **Behavior:** `return_annotated` is sent only when asked for.
- **Source:** ARCHITECTURE.md §3.3 (query param `return_annotated`, default false)
- **Setup:** As M3-api-01.
- **Steps → Expected:** `detectPeople(file)` → the URL has no query string. `detectPeople(file, {annotated: true})` → the URL ends with `/detect?return_annotated=true`.
- **Type:** unit

- **ID** M3-api-03
- **Behavior:** The response is mapped to camelCase, and `detections` are passed through unchanged.
- **Source:** ARCHITECTURE.md §4.3 ("maps snake_case to camelCase")
- **Setup:** `fetch` resolves with D2.
- **Steps → Expected:** The result deep-equals `{count: 2, detections: <D2.detections>, averageConfidence: 0.765, inferenceTimeMs: 142.3, imageWidth: 1280, imageHeight: 720, annotatedImageBase64: null}`. With `annotated_image_base64` removed from the body, `annotatedImageBase64` is still `null`. With `"QUJD"`, it is `"QUJD"`.
- **Type:** unit

- **ID** M3-api-04
- **Behavior:** The base URL comes from `VITE_API_BASE_URL`, without a trailing slash, and falls back to `http://localhost:8000`.
- **Source:** ARCHITECTURE.md §4.3 ("only place that knows the backend base URL (`VITE_API_BASE_URL`)"); PROGRESS.md M3 Setup
- **Setup:** `vi.stubEnv("VITE_API_BASE_URL", …)`, then `vi.resetModules()` and a dynamic `import("../api/client.js")`. Run `vi.unstubAllEnvs()` afterwards.
- **Steps → Expected:** `"http://api.test:9000/"` → fetch URL `"http://api.test:9000/detect"`. Unset or `undefined` → `"http://localhost:8000/detect"`.
- **Type:** unit

- **ID** M3-api-05
- **Behavior:** Every documented backend error becomes an `ApiError` whose message is the backend's `detail`, verbatim, with the HTTP status.
- **Source:** ARCHITECTURE.md §3.3 (errors with `{"detail": "<string>"}` "the frontend can display directly"), §4.3; instructions.md "Display clear error messages for invalid or unsupported files"
- **Setup:** Parametrize the `fetch` response (JSON body):
  - `400 {"detail": "Uploaded file is empty"}`
  - `400 {"detail": "Could not decode image — unsupported or corrupt file"}`
  - `413 {"detail": "File too large (max 10 MB)"}`
  - `415 {"detail": "Unsupported file type: text/plain"}`
  - `415 {"detail": "Unsupported image format: GIF. Only JPEG and PNG are accepted"}`
  - `500 {"detail": "Inference failed: boom"}`
- **Steps → Expected:** The promise rejects with `err instanceof ApiError`, `err instanceof Error`, `err.name === "ApiError"`, `err.message === detail`, and `err.status === <status>`.
- **Type:** unit

- **ID** M3-api-06
- **Behavior:** An error whose `detail` is not a string falls back to a generic message with the status.
- **Source:** ARCHITECTURE.md §4.3 ("any failure into an ApiError whose message can be shown as-is")
- **Setup:** `fetch` → `422 {"detail": [{"loc": ["query"], "msg": "x"}]}`. Separately, `404 {}`.
- **Steps → Expected:** The messages are `"Request failed (HTTP 422)"` (status 422) and `"Request failed (HTTP 404)"` (status 404). The message never contains `[object Object]`.
- **Type:** unit

- **ID** M3-api-07
- **Behavior:** A non-JSON error body (e.g. a proxy error page) gives the generic message.
- **Source:** ARCHITECTURE.md §4.3
- **Setup:** `fetch` → `new Response("<html>Bad gateway</html>", {status: 502, headers: {"content-type": "text/html"}})`.
- **Steps → Expected:** Rejects with `ApiError`, message `"Request failed (HTTP 502)"`, status 502.
- **Type:** unit

- **ID** M3-api-08
- **Behavior:** A network failure (backend down, CORS refused) becomes a "can't reach the server" `ApiError` with no status.
- **Source:** ARCHITECTURE.md §4.3 ("or a 'can't reach the server' message")
- **Setup:** `fetch` rejects with `new TypeError("Failed to fetch")`.
- **Steps → Expected:** Rejects with `ApiError`, `status === null`, `message` matches `/can't reach/i` and contains `"http://localhost:8000"`. The raw `"Failed to fetch"` is not in the message.
- **Type:** unit

- **ID** M3-api-09
- **Behavior:** A 200 response whose body is not a JSON object is reported as unreadable rather than returned.
- **Source:** ARCHITECTURE.md §4.3
- **Setup:** `fetch` → `200` with body `"not json"`. Separately, `200` with body `"null"`.
- **Steps → Expected:** Both reject with `ApiError`, message `"The server sent an unreadable response"`, status 200.
- **Type:** unit

### components/BoundingBoxOverlay (component)

- **ID** M3-overlay-01
- **Behavior:** It renders the image and one box per detection, in order.
- **Source:** instructions.md "Frontend" ("Display bounding boxes for detected people"); ARCHITECTURE.md §4.2
- **Setup:** Render with `src="blob:mock/1"`, `alt="zidane.jpg"`, `frameWidth=1280`, `frameHeight=720`, and D2's detections plus a third `{bbox: [0, 0, 128, 72], confidence: 0.55}`.
- **Steps → Expected:** `getByRole("img", {name: "zidane.jpg"})` has `src` `blob:mock/1`. `getAllByTestId("bounding-box")` has length 3, and their aria-labels in DOM order are `"Person 1, 91% confidence"`, `"Person 2, 62% confidence"` and `"Person 3, 55% confidence"`.
- **Type:** unit

- **ID** M3-overlay-02
- **Behavior:** Box position and size come from the frame props, as percentages.
- **Source:** ARCHITECTURE.md §4.2 (contract: frame dimensions = backend `image_width`/`image_height`)
- **Setup:** A single detection `[640, 360, 1280, 720]`.
- **Steps → Expected:** With frame 1280×720, the box style is `left "50%"`, `top "50%"`, `width "50%"`, `height "50%"`. Re-rendered with frame 2560×1440, it is `"25%"` for all four. D2's box 1 at 1280×720 is `"10%" / "10%" / "40%" / "40%"`.
- **Type:** unit

- **ID** M3-overlay-03
- **Behavior:** Box placement does not depend on the image's natural or displayed size, so a downscaled processed frame still lines up.
- **Source:** ARCHITECTURE.md §4.2 ("no need to measure displayed dimensions or re-render on resize"; "not the uploaded file's own size")
- **Setup:** Before rendering, give `HTMLImageElement.prototype` `naturalWidth = 4000`, `naturalHeight = 3000`, `width`/`clientWidth = 400` and `clientHeight = 300` (use `Object.defineProperty`, and restore afterwards). Frame 1280×960, bbox `[320, 240, 960, 720]`.
- **Steps → Expected:** The box style is `25% / 25% / 50% / 50%`. After `fireEvent.load(img)` and `window.dispatchEvent(new Event("resize"))`, the style is unchanged.
- **Type:** unit

- **ID** M3-overlay-04
- **Behavior:** Each box is labelled with its number and confidence.
- **Source:** instructions.md "Frontend" ("confidence for each detection"); PROGRESS.md M3 (labels `#n · NN%`)
- **Setup:** D2.
- **Steps → Expected:** The text content of box 1 is `"#1 · 91%"` and of box 2 is `"#2 · 62%"`. The separator is U+00B7.
- **Type:** unit

- **ID** M3-overlay-05
- **Behavior:** `showBoxes=false` hides every box but keeps the image. An empty detection list renders the image with no boxes.
- **Source:** PROGRESS.md M3 ("boxes in the DOM can be highlighted and toggled"); instructions.md Tips ("visible but not cluttered")
- **Setup:** D2 with `showBoxes={false}`. Separately, `detections={[]}`.
- **Steps → Expected:** In both, `queryAllByTestId("bounding-box")` has length 0 and the `img` is present.
- **Type:** unit

- **ID** M3-overlay-06
- **Behavior:** The highlighted box gets the highlight class, and hovering a box reports its index.
- **Source:** PROGRESS.md M3 ("hovering a box highlights its entry")
- **Setup:** D2 plus a third detection. `highlightedIndex={1}`, `onHighlight=vi.fn()`.
- **Steps → Expected:** Only box 2 has class `overlay__box--highlighted`. `userEvent.hover(box3)` → `onHighlight` is called with `2`. `unhover(box3)` → it is called with `null`.
- **Type:** unit

- **ID** M3-overlay-07
- **Behavior:** Many detections all render with finite percent positions.
- **Source:** instructions.md "Frontend" ("smooth rendering even with multiple detections")
- **Setup:** 300 detections on a 1280×720 frame, `bbox = [i, i, i + 40, i + 80]` for `i` in 0..299, confidence `0.5 + i/1000`.
- **Steps → Expected:** There are 300 boxes. Every `parseFloat(style.left/top/width/height)` is finite and in [0, 100]. The last box's label is `"#300 · 80%"`. Rerendering with only `highlightedIndex` changed (`rerender`) leaves exactly 1 box with the highlight class. (Perceived smoothness is a manual check.)
- **Type:** unit

### components/DetectionSummary (component)

- **ID** M3-summary-01
- **Behavior:** It shows the count, average confidence, model time, total time and processed frame size.
- **Source:** instructions.md "Frontend" ("total count", "processing time per frame"); ARCHITECTURE.md §4.1, §4.3 (model time and total time)
- **Setup:** `result` = `detectPeople`'s mapping of D2. `roundTripMs = 250.4`.
- **Steps → Expected:** `getByTestId("person-count")` has text `"2"`. Each `dt` is followed by its `dd`: "Average confidence" → `"77%"`, "Model time" → `"142 ms"` and "Total time" → `"250 ms"`. The text `"Processed at 1280 × 720 px"` is present.
- **Type:** unit

- **ID** M3-summary-02
- **Behavior:** It lists each person with their confidence, numbered like the boxes.
- **Source:** instructions.md "Frontend" ("confidence for each detection"); PROGRESS.md M3
- **Setup:** As M3-summary-01.
- **Steps → Expected:** There are 2 `listitem`s. Item 1 contains `"Person #1"` and `"91%"`, and item 2 contains `"Person #2"` and `"62%"`.
- **Type:** unit

- **ID** M3-summary-03
- **Behavior:** With zero people, it shows an explicit empty state and no average.
- **Source:** ARCHITECTURE.md §3.3 (average is 0 with no detections); PROGRESS.md M3
- **Setup:** `result` with `count: 0`, `detections: []`, `averageConfidence: 0`.
- **Steps → Expected:** `person-count` is `"0"`. "Average confidence" → `"—"` (not `"0%"`). The text `"No people detected in this image."` is present, and there is no `list`.
- **Type:** unit

- **ID** M3-summary-04
- **Behavior:** Total time is shown only when a round trip was measured.
- **Source:** ARCHITECTURE.md §4.3
- **Setup:** D2 with `roundTripMs = null`.
- **Steps → Expected:** `queryByText("Total time")` is null. "Model time" is still shown.
- **Type:** unit

- **ID** M3-summary-05
- **Behavior:** List hover reports the index, and the highlighted entry gets the highlight class.
- **Source:** PROGRESS.md M3 ("Hovering a list entry highlights its box")
- **Setup:** D2, `highlightedIndex={0}`, `onHighlight=vi.fn()`.
- **Steps → Expected:** Item 1 has class `is-highlighted` and item 2 does not. Hovering item 2 → `onHighlight(1)`. Unhovering it → `onHighlight(null)`.
- **Type:** unit

### components/ImageUploader (component)

- **ID** M3-upl-01
- **Behavior:** Sample buttons are built from `/samples/index.json`, with the label falling back to the file name.
- **Source:** ARCHITECTURE.md §4.1 ("including from `public/samples/`"), §4.3 (`index.json` `[{file, label}]`)
- **Setup:** `fetch("/samples/index.json")` → `[{"file": "bus.jpg", "label": "Street with bus"}, {"file": "x.png"}]`.
- **Steps → Expected:** `fetch` is called once with `"/samples/index.json"`. Buttons named `"Street with bus"` and `"x.png"` appear (`findByRole`), after the text `"Or try a sample:"`.
- **Type:** unit

- **ID** M3-upl-02
- **Behavior:** A missing or invalid manifest hides the sample row silently, and the picker still works.
- **Source:** PROGRESS.md M3 (`ImageUploader`); code comment ("no samples is fine")
- **Setup:** Parametrize the manifest response: `404`; `fetch` rejects; `200 {}` (not an array); `200` with an HTML body (what Vite returns for a missing path).
- **Steps → Expected:** In every case (after awaiting the fetch), `queryByText("Or try a sample:")` is null, no `role="alert"` or error text is shown, and the "Choose an image" button is enabled.
- **Type:** unit

- **ID** M3-upl-03
- **Behavior:** Picking a file calls `onSelect` with that `File`, and the same file can be picked again.
- **Source:** instructions.md "Frontend" ("Upload … frames"); PROGRESS.md M3
- **Setup:** `onSelect=vi.fn()`. The input is `getByTestId("file-input")`.
- **Steps → Expected:** The input has `accept="image/jpeg,image/png"` and `type="file"`. `userEvent.upload(input, file)` → `onSelect` is called once with `file`, and then `input.value === ""`. Uploading the same `file` again → `onSelect` has been called twice.
- **Type:** unit

- **ID** M3-upl-04
- **Behavior:** The "Choose an image" button opens the file dialog.
- **Source:** PROGRESS.md M3 (file picker)
- **Setup:** `vi.spyOn(HTMLInputElement.prototype, "click")`.
- **Steps → Expected:** Clicking `getByRole("button", {name: "Choose an image"})` → `click` is called once, on the `file-input` element.
- **Type:** unit

- **ID** M3-upl-05
- **Behavior:** Drag-and-drop shows an active state and selects the first dropped file.
- **Source:** PROGRESS.md M3 (drag-and-drop)
- **Setup:** `onSelect=vi.fn()`. Two files `a.jpg` and `b.png`.
- **Steps → Expected:** `fireEvent.dragOver(dropzone)` → the dropzone has class `dropzone--active`. `fireEvent.dragLeave` → the class is gone. `fireEvent.drop(dropzone, {dataTransfer: {files: [a, b]}})` → `onSelect` is called exactly once, with `a`, and the dropzone is not active. A drop with `files: []` → `onSelect` is not called.
- **Type:** unit

- **ID** M3-upl-06
- **Behavior:** Clicking a sample fetches it and calls `onSelect` with a `File` that has the sample's name and image type.
- **Source:** ARCHITECTURE.md §4.1; PROGRESS.md M3
- **Setup:** Manifest `[{"file": "zidane.jpg", "label": "Two people"}]`. `/samples/zidane.jpg` → 200 with `Blob([jpegBytes], {type: "image/jpeg"})`.
- **Steps → Expected:** Click "Two people" → `fetch` is called with `"/samples/zidane.jpg"`. `onSelect` is called once with a `File` where `name === "zidane.jpg"`, `type === "image/jpeg"` and `size === jpegBytes.length`.
- **Type:** unit

- **ID** M3-upl-07
- **Behavior:** A sample that fails to load shows an inline message naming it, and the message clears on the next successful sample.
- **Source:** instructions.md "Display clear error messages"; PROGRESS.md M3
- **Setup:** Manifest with "Two people" (`zidane.jpg`) and "Street with bus" (`bus.jpg`). `/samples/zidane.jpg` → 404 (separately: `fetch` rejects). `bus.jpg` → 200 JPEG.
- **Steps → Expected:** Click "Two people" → the text `Couldn't load the sample "Two people".` appears and `onSelect` is not called. Click "Street with bus" → the message is gone and `onSelect` is called once with `bus.jpg`.
- **Type:** unit

- **ID** M3-upl-07b
- **Behavior:** **[OQ-3]** A sample URL that answers 200 with something other than an image (e.g. the dev server's `text/html` fallback for a missing file) is treated as a failed sample load, not uploaded.
- **Source:** OQ-3 resolution
- **Setup:** Manifest with "Two people" (`zidane.jpg`). `/samples/zidane.jpg` → `200` with body `"<!doctype html>…"` and `Content-Type: text/html`.
- **Steps → Expected:** Click "Two people" → the text `Couldn't load the sample "Two people".` appears, and `onSelect` is not called.
- **Type:** unit

- **ID** M3-upl-08
- **Behavior:** When `disabled`, every input path is inert.
- **Source:** ImageUploader `disabled` prop, used by DetectionView while loading
- **Setup:** `disabled={true}`, with a manifest of one sample. `onSelect=vi.fn()`.
- **Steps → Expected:** "Choose an image" and the sample button are `toBeDisabled()`. The dropzone has class `dropzone--disabled`. `dragOver` does not add `dropzone--active`. A drop with a file and a `fireEvent.change` on the input with a file both leave `onSelect` uncalled.
- **Type:** unit

- **ID** M3-upl-09
- **Behavior:** **[OQ-2]** A sample whose download finishes after the uploader became disabled, or after another image was picked, does not start a detection.
- **Source:** ARCHITECTURE.md §4.3 ("only the latest response is shown"); OQ-2
- **Setup:** Manifest with "Two people". `/samples/zidane.jpg` → deferred. `onSelect=vi.fn()`.
- **Steps → Expected:** Click "Two people". Then `userEvent.upload(input, b)` → `onSelect(b)`. Rerender with `disabled={true}`, then resolve the sample fetch. `onSelect` has been called exactly once, with `b`. (It currently fails: the sample bypasses `disabled` and calls `onSelect` a second time.)
- **Type:** unit

- **ID** M3-upl-10
- **Behavior:** The dropzone states the accepted formats and size limit.
- **Source:** instructions.md "Backend" (JPEG, PNG); ARCHITECTURE.md §3.3 (10 MiB default)
- **Setup:** Default render.
- **Steps → Expected:** The text `"JPEG or PNG, up to 10 MB"` is present. (See OQ-5 on the hard-coded limit.)
- **Type:** unit

### public/samples manifest (static)

- **ID** M3-samples-01
- **Behavior:** Every manifest entry points to a real JPEG/PNG in `public/samples/`.
- **Source:** ARCHITECTURE.md §4.3 (`index.json` `[{file, label}]`); instructions.md "Dataset" (demo images in `frontend/public/samples/`)
- **Setup:** A Vitest test reads `public/samples/index.json` and the files with `node:fs`.
- **Steps → Expected:** It parses to an array. Each entry has non-empty string `file` and `label`, and the `file` values are unique. Each file exists, has a `.jpg`, `.jpeg` or `.png` extension, and starts with JPEG (`FF D8 FF`) or PNG (`89 50 4E 47 0D 0A 1A 0A`) magic bytes. Today there are 2 entries. The ≥ 10 requirement is M5's, so do not assert it here.
- **Type:** unit

### pages/DetectionView (component, mocked fetch)

- **ID** M3-view-01
- **Behavior:** The initial state shows only the uploader.
- **Source:** ARCHITECTURE.md §4.1
- **Setup:** Render `<DetectionView/>` with the manifest returning `[]`.
- **Steps → Expected:** The dropzone and an enabled "Choose an image" button are present. There is no `role="alert"`, no `role="status"`, no `img` and no "Detection summary" region.
- **Type:** unit

- **ID** M3-view-02
- **Behavior:** While detecting, a loading indicator is shown over a preview of the picked image, with no boxes or summary.
- **Source:** ARCHITECTURE.md §4.1; PROGRESS.md M3
- **Setup:** `/detect` → deferred. `createObjectURL` → `"blob:mock/1"`. Upload `zidane.jpg`.
- **Steps → Expected:** `getByRole("status")` has text `"Detecting people…"`. One `img` has `src` `"blob:mock/1"`. There are 0 `bounding-box` elements and no "Detection summary" region. `fetch` was called with `…/detect`. (The uploader's enabled or disabled state while loading is covered by M3-view-15.)
- **Type:** unit

- **ID** M3-view-03
- **Behavior:** On success, it shows the image with positioned boxes, the count, per-person confidences and both timings, and the uploader is usable again.
- **Source:** instructions.md "Frontend" (Detection View, all four bullets); ARCHITECTURE.md §4.1, §4.3
- **Setup:** `/detect` → D2. Mock `performance.now` to return 1000 at the start and 1250.4 at the end. Upload `zidane.jpg`.
- **Steps → Expected:** `findByTestId("person-count")` is `"2"`. There are 2 `bounding-box` elements with styles `10%/10%/40%/40%` and `50%/50%/50%/50%`. The image is named `"zidane.jpg"` with `src` `"blob:mock/1"`. "Model time" is `"142 ms"` and "Total time" is `"250 ms"`. Two list items show `91%` and `62%`. `queryByRole("status")` is null. "Choose an image" is enabled. The "Show bounding boxes" checkbox is checked.
- **Type:** unit

- **ID** M3-view-04
- **Behavior:** Boxes are placed against the backend's processed frame size, even when the upload was larger and was downscaled.
- **Source:** ARCHITECTURE.md §3.3 (`bbox` in processed-frame pixels), §4.2 (contract)
- **Setup:** Upload `big.jpg` (a 4000×3000 file in the scenario). `/detect` → `{count: 1, detections: [{bbox: [320, 240, 960, 720], confidence: 0.8}], average_confidence: 0.8, inference_time_ms: 50, image_width: 1280, image_height: 960, annotated_image_base64: null}`.
- **Steps → Expected:** The single box's style is `left "25%"`, `top "25%"`, `width "50%"`, `height "50%"`. The text `"Processed at 1280 × 960 px"` is present.
- **Type:** unit

- **ID** M3-view-05
- **Behavior:** A zero-person result shows the image, no boxes and the empty-state message.
- **Source:** ARCHITECTURE.md §4.1
- **Setup:** `/detect` → `count 0`, `detections []`, `average_confidence 0`, 1280×720.
- **Steps → Expected:** `person-count` is `"0"`. There are 0 boxes, the image is present, and `"No people detected in this image."` is shown. There is no alert.
- **Type:** unit

- **ID** M3-view-06
- **Behavior:** Invalid or unsupported files are sent to the backend unchanged, and its message is shown in an alert that names the file.
- **Source:** instructions.md "Display clear error messages for invalid or unsupported files"; PROGRESS.md M3 decision ("validated by the backend only"); ARCHITECTURE.md §4.1 ("surfaces API errors inline")
- **Setup:** `userEvent.setup({applyAccept: false})`. Parametrize the file and the `/detect` response:
  - `notes.txt` (`text/plain`) → `415 "Unsupported file type: text/plain"`
  - `anim.gif` → `415 "Unsupported image format: GIF. Only JPEG and PNG are accepted"`
  - `empty.jpg` (0 bytes) → `400 "Uploaded file is empty"`
  - `huge.jpg` → `413 "File too large (max 10 MB)"`
  - `ok.jpg` → `500 "Inference failed: boom"`
- **Steps → Expected:** `fetch` is called with `…/detect`, and the form's `image` is that file (there is no client-side rejection). `findByRole("alert")` has text containing `"Couldn't analyse <name>."` and the exact detail. There is no `img`, no `bounding-box`, no summary and no `status`. "Choose an image" is enabled.
- **Type:** unit

- **ID** M3-view-07
- **Behavior:** If the backend is unreachable, the alert says so.
- **Source:** ARCHITECTURE.md §4.3
- **Setup:** `/detect` rejects with `TypeError("Failed to fetch")`.
- **Steps → Expected:** The `alert` text contains `"Couldn't analyse zidane.jpg."` and matches `/can't reach/i`.
- **Type:** unit

- **ID** M3-view-08
- **Behavior:** After an error, picking a valid image clears the error and shows the result.
- **Source:** ARCHITECTURE.md §4.1
- **Setup:** The first `/detect` → 415. The second → D2.
- **Steps → Expected:** After the second upload, `queryByRole("alert")` is null, `person-count` is `"2"` and there are 2 boxes.
- **Type:** unit

- **ID** M3-view-09
- **Behavior:** Picking a new image immediately removes the previous result, so old boxes never sit over the new image.
- **Source:** ARCHITECTURE.md §4.2 (boxes must refer to the displayed frame), §4.3
- **Setup:** First upload `a.jpg` → D2 (wait for the result). The second `/detect` is deferred. `createObjectURL` returns `blob:mock/1` and then `blob:mock/2`.
- **Steps → Expected:** Right after uploading `b.jpg`: 0 `bounding-box` elements, no summary, `status` present, and the only `img` has `src` `"blob:mock/2"`. Hover state is cleared: after the deferred resolves with D2, no box or list item has a highlight class, even though one was highlighted before the second upload.
- **Type:** unit

- **ID** M3-view-10
- **Behavior:** When two detections overlap, only the latest selection's response is shown, whatever order the responses arrive in.
- **Source:** ARCHITECTURE.md §4.3 ("only the latest response is shown"); PROGRESS.md M3 "Stale responses"
- **Setup:** Two selections have to happen while the first is in flight. Because of OQ-1 the real uploader may be disabled, so `vi.mock("../components/ImageUploader.jsx")` with a stub that exposes `onSelect` (for example, buttons that call `onSelect(a)` and `onSelect(b)`, ignoring `disabled`). `/detect` for A and B are separate deferreds. A's result has `count 1` and B's has `count 3` (with 1 and 3 detections).
- **Steps → Expected:** Select A, then B. (a) Resolve B, then A → `person-count` is `"3"` with 3 boxes, and it stays that way after A resolves (flush with `await act(...)`). (b) Fresh render: resolve A first, then B → while only A has resolved, `status` is still shown with no count or boxes. After B resolves, `"3"` with 3 boxes. Throughout, the image `src` is B's object URL.
- **Type:** unit

- **ID** M3-view-11
- **Behavior:** A late error from a superseded request is ignored.
- **Source:** ARCHITECTURE.md §4.3; PROGRESS.md M3 "Stale responses"
- **Setup:** As M3-view-10.
- **Steps → Expected:** Select A, then B. B resolves with `count 3`, and then A rejects with `415`. There is no `alert`, `person-count` is `"3"`, and there are 3 boxes. In reverse: B rejects with `415` and A resolves later → the alert for B's file is shown, and there is no count or boxes from A.
- **Type:** unit

- **ID** M3-view-12
- **Behavior:** The "Show bounding boxes" toggle hides and shows the boxes without touching the image or summary.
- **Source:** PROGRESS.md M3 ("toggled"); instructions.md Tips ("visible but not cluttered")
- **Setup:** `/detect` → D2. Upload.
- **Steps → Expected:** Uncheck "Show bounding boxes" → 0 boxes, the `img` is still present, and `person-count` is `"2"`. Check it again → 2 boxes with the same styles as before.
- **Type:** unit

- **ID** M3-view-13
- **Behavior:** Hovering a list entry highlights the matching box, and hovering a box highlights the matching entry.
- **Source:** PROGRESS.md M3 (DetectionSummary hover linking)
- **Setup:** `/detect` → D2. Upload.
- **Steps → Expected:** Hovering list item 2 → box 2 has `overlay__box--highlighted`, and box 1 does not. Unhovering → no box is highlighted. Hovering box 1 → list item 1 has class `is-highlighted`. Unhovering → none.
- **Type:** unit

- **ID** M3-view-14
- **Behavior:** Each preview object URL is released when it's replaced and on unmount.
- **Source:** PROGRESS.md M3 (`DetectionView`); code comment (object URL cleanup)
- **Setup:** Stub `createObjectURL` (returning `blob:mock/1`, `blob:mock/2`) and `revokeObjectURL` (a spy). `/detect` → D2.
- **Steps → Expected:** Upload A, then B → `createObjectURL` is called twice, once with each file, and `revokeObjectURL` is called with `"blob:mock/1"` but not `"blob:mock/2"`. `unmount()` → `revokeObjectURL` is also called with `"blob:mock/2"`.
- **Type:** unit

- **ID** M3-view-15
- **Behavior:** **[OQ-1]** The uploader stays enabled while a detection is in flight, so a user can replace a slow or hung request.
- **Source:** ARCHITECTURE.md §4.3 ("If a new image is picked while one is still processing…"); OQ-1
- **Setup:** `/detect` for the first upload is a deferred that never resolves. The second → D2. The real `ImageUploader` is used.
- **Steps → Expected:** While the first is pending, "Choose an image" is enabled. Uploading a second file → `fetch` is called again with `…/detect`, and the result for the second file (`person-count` `"2"`) is shown. (It currently fails: the uploader is disabled while loading. If the user keeps the current behavior, this case becomes: "Choose an image" and the sample buttons are disabled while loading, and they are re-enabled after success and after error.)
- **Type:** unit

- **ID** M3-view-16
- **Behavior:** Choosing a demo sample runs a detection on it.
- **Source:** ARCHITECTURE.md §4.1 ("upload/select an image (including from `public/samples/`)")
- **Setup:** Manifest `[{"file": "zidane.jpg", "label": "Two people"}]`. `/samples/zidane.jpg` → JPEG blob. `/detect` → D2.
- **Steps → Expected:** Click "Two people" → `fetch` is called with `"/samples/zidane.jpg"`, then with `…/detect`, and the form's `image.name` is `"zidane.jpg"`. Then `person-count` is `"2"`, there are 2 boxes, and the image is named `"zidane.jpg"`.
- **Type:** unit

### App (component)

- **ID** M3-app-01
- **Behavior:** The app opens on the Detect page, with navigation for the two pages.
- **Source:** instructions.md "Frontend" ("Build two main pages"); ARCHITECTURE.md §4.3 (state navigation)
- **Setup:** Render `<App/>` with the manifest returning `[]`.
- **Steps → Expected:** The heading "Detecto" is present. The `navigation` named "Pages" has buttons "Detect" (`aria-current="page"`) and "History" (no `aria-current`). The dropzone is present.
- **Type:** unit

- **ID** M3-app-02
- **Behavior:** Switching pages swaps the content without changing the URL, and makes no backend calls for the placeholder.
- **Source:** ARCHITECTURE.md §4.3 ("plain component state, with no router"); PROGRESS.md M3 (HistoryView placeholder)
- **Setup:** As M3-app-01. Record `window.location.href`.
- **Steps → Expected:** Click "History" → the text `"Detection history is coming in the next milestone."` is shown, there is no dropzone, "History" has `aria-current="page"`, and no `fetch` call URL contains `/history`. Click "Detect" → the dropzone is back. `window.location.href` is unchanged throughout.
- **Type:** unit

### Backend — logger fix and frame-size assumption

- **ID** M3-log-01
- **Behavior:** Importing the app gives the `backend` logger a stream handler at INFO.
- **Source:** ARCHITECTURE.md §3.3 ("Each detection also writes one `INFO` log line"); instructions.md "Backend" ("simple performance logging"); PROGRESS.md M3 "M2 bug found and fixed"
- **Setup:** `import backend.main`.
- **Steps → Expected:** `logging.getLogger("backend")` has at least one `logging.StreamHandler` and level `logging.INFO`. `logging.getLogger("backend.routes.detect").isEnabledFor(logging.INFO)` is `True`.
- **Type:** unit

- **ID** M3-log-02
- **Behavior:** A successful detection's INFO line reaches the app's handler output, not only pytest's capture.
- **Source:** as M3-log-01
- **Setup:** `client`, `fake_detector`. Find the `StreamHandler` on `logging.getLogger("backend")` and call `old = handler.setStream(io.StringIO())`. Restore it in `finally`. Do not use `caplog`.
- **Steps → Expected:** POST an 80×50 PNG → 200. The StringIO contains exactly one line with `"INFO"`, `"backend.routes.detect"`, `"count=2"`, `"inference_ms=12.5"` and `"size=80x50"`. A rejected upload (`text/plain` → 415) adds no `"detect: count="` line.
- **Type:** unit

- **ID** M3-log-03
- **Behavior:** Importing or reloading the app more than once does not add duplicate handlers.
- **Source:** PROGRESS.md M3 (fix); "one INFO line per detection" (ARCHITECTURE.md §3.3)
- **Setup:** A subprocess (keeps the test process's `app` untouched): `backend/.venv/bin/python -c "import importlib, logging, backend.main as m; importlib.reload(m); print(len(logging.getLogger('backend').handlers))"`, with cwd at the project root.
- **Steps → Expected:** The exit code is 0 and stdout is `"1"`.
- **Type:** unit

- **ID** M3-log-04
- **Behavior:** Under a real uvicorn process, a detection's INFO line appears in the server output (the original symptom).
- **Source:** PROGRESS.md M3 ("the per-detection INFO log line never appeared under uvicorn")
- **Setup:** `@pytest.mark.integration`. Start `uvicorn backend.main:app --port <free port>` as a subprocess with env `DB_PATH=<tmp_path>/i.db` and `WARMUP_MODEL=false`. Do not use port 8000 (a dev server may be running). Poll `/health` until it responds, with a 60 s timeout.
- **Steps → Expected:** POST `frontend/public/samples/zidane.jpg` to `/detect` → 200. Terminate the server. Its combined stdout/stderr contains a line matching `INFO:\s+backend\.routes\.detect - detect: count=\d+ .* size=1280x720`. The real `backend/detecto.db` is not touched (its mtime is unchanged).
- **Type:** integration (real YOLO model)

- **ID** M3-exif-01
- **Behavior:** For an EXIF-rotated JPEG, the backend's `image_width`/`image_height` follow the displayed (rotated) orientation, as browsers render it, so the percent boxes line up.
- **Source:** ARCHITECTURE.md §4.2 ("The processed frame is a uniform downscale of the upload, so the aspect ratios match")
- **Setup:** `fake_detector`. Use PIL to build a 40×20 RGB JPEG with EXIF Orientation = 6 (rotate 90° CW).
- **Steps → Expected:** POST it → 200, `image_width == 20`, `image_height == 40`, and the array passed to `fake_detector.detect` has shape `(40, 20, 3)`. (This was verified while planning: OpenCV 4.10 `imdecode` applies EXIF orientation.)
- **Type:** unit

## Regression

- **Backend baseline: 163 tests.** `backend/.venv/bin/python -m pytest backend/tests` gave **163 passed** (about 5 s, integration included) on the M3 working tree during planning. After M3's tests are added, the earlier 163 must still pass unchanged. In particular:
  - `M2-detect-log-01` (`test_one_info_log_line_per_detection`) and the failed-save ERROR log test must still pass, now that the `backend` logger has its own handler and level. The caplog capture and the new handler must coexist, with exactly one INFO record per detection in caplog.
  - CORS tests (`test_cors.py`): the preflight from `http://localhost:5173` for POST `/detect` is allowed, which the frontend depends on. (This was confirmed live during planning: `access-control-allow-origin: http://localhost:5173`.)
  - The resize rule (max 1280 on the long edge, each side ≥ 1 px) and the `image_width`/`image_height` values in the `/detect` response. The overlay's correctness depends on them (M1 tests).
  - Error status codes and `{"detail": <str>}` bodies for 400/413/415/500 (M1 tests), which `client.js` shows verbatim.
- **Frontend:** `npm run build` (`vite build`) still succeeds. It writes the gitignored `frontend/dist/`.

## Manual checks (real browser; jsdom cannot verify layout)

Run them with the backend on :8000 and `npm run dev` on :5173. Each has a pass/fail criterion.

1. **Alignment at native size:** for `zidane.jpg` (1280×720, not downscaled), each box's edges sit on the person's outline to within about 2 px at full width.
2. **Alignment through resize:** with the same result, drag the window from about 1100 px wide down to about 400 px. The boxes stay on the people at every width without re-uploading. Below 760 px the layout becomes a single column.
3. **Downscaled upload:** for a photo larger than 1280 px on the long edge (e.g. 4000×3000), the summary says `Processed at 1280 × 960 px` and the boxes align with the people on the displayed image.
4. **Portrait and odd aspect ratios:** `bus.jpg` (810×1080) and a very wide panorama (e.g. 3000×600). The boxes align, and the image is never stretched (its aspect ratio is preserved).
5. **EXIF-rotated phone photo** (portrait shot stored as landscape with Orientation 6): the image displays upright and the boxes align with it.
6. **Small image** (e.g. 200×150): it shows at its natural size, not stretched, and the boxes align, so the overlay container hugs the image.
7. **Edge labels:** a person touching the top edge of the frame has a readable `#n · NN%` label that is not cut off or hidden behind other UI.
8. **Many detections:** a crowd image with 30 or more people. Hovering list entries and boxes highlights immediately with no visible lag. With the toggle off, all boxes disappear, and with it on they return.
9. **Error messages:** with a `.txt` (choose "All files" in the dialog), a `.gif`, a 0-byte `.jpg`, a file over 10 MB, and the backend stopped, each shows a readable red alert naming the file and the reason, and the page recovers on the next valid upload.
10. **Network tab:** a single upload makes exactly one POST to `http://localhost:8000/detect`, with `multipart/form-data; boundary=…`, and no `return_annotated` query.
11. **[OQ-7] Tall images fit the window:** with the browser window about 900 px tall, `bus.jpg` (portrait) is shown whole without scrolling the page past the image: its height is capped at about 75% of the window height, its aspect ratio is preserved, and the boxes still align. A landscape image (`zidane.jpg`) is unaffected at normal window sizes.
12. **[OQ-1] Replacing a pending request:** stop the backend process with `kill -STOP` (so connections hang), upload an image, and pick another one while "Detecting people…" shows. The uploader is usable. After `kill -CONT`, only the second image's result is shown.

## Resolved decisions (user, 2026-10-02)

The planner's open questions, plus one raised in the browser check, with the user's resolution. "App change" means the code must change, and the tests encode the new behavior.

- **OQ-1 — Uploader during a detection:** **app change.** The uploader (file picker, drop zone and samples) stays enabled while a detection is in flight. The `latestRequest` guard makes that safe, and it lets a user replace a slow or hung request. No request timeout for now. M3-view-15 and manual check 12. M3-upl-08 still holds, because `ImageUploader` keeps its `disabled` prop.
- **OQ-2 — Late sample downloads:** **app change.** A sample whose download finishes after a later selection (another sample, a file pick or a drop), or after the uploader became disabled, is dropped and does not call `onSelect`. M3-upl-09.
- **OQ-3 — Missing sample served as HTML:** **app change.** A sample download that is not `image/*` counts as a failed load and shows the "Couldn't load the sample" message. New case M3-upl-07b. M3-samples-01 stays as the guard against the manifest and the folder drifting apart.
- **OQ-4 — `formatMs` boundary:** **app change.** Round before choosing the unit, so 999.5–999.99 ms shows `"1.00 s"`. M3-fmt-02.
- **OQ-5 — Hard-coded size hint:** accepted as is for M3. M3-upl-10 tests the current text. Noted for the README (M5).
- **OQ-6 — Leaving the Detect page discards the result:** accepted for M3, and revisited in M4 when History becomes a real page. Recorded in PROGRESS.md.
- **OQ-7 — Tall images (from the browser check):** **app change (CSS).** The displayed image's height is capped at about 75% of the viewport, with the aspect ratio preserved. The overlay container shrinks to the image, so the percentage boxes stay aligned. jsdom can't verify layout, so this is manual check 11 only.
