# Test plan — Milestone 5: Evaluation and README

## Scope

M5 is uncommitted on top of `0563504` (M4). It adds or changes:
- **Evaluation set:** 16 COCO 2017 *val* images in `backend/samples/coco-<id>.jpg`, plus `ground_truth.json` (COCO person boxes as `[x, y, w, h]` in original pixels, `width`/`height`, `visible_persons`, licence and Flickr URL per image; `match_iou: 0.5`, `min_visible_height_px: 20`) and `CREDITS.md`.
- **`backend/scripts/evaluate.py`:**
  - `iou(a, b)`;
  - `score_image(detections, gt_xywh, min_visible_height, match_iou)`: greedy matching, highest confidence first;
  - `run(runs, threshold, model)`: the real `/detect` route through TestClient, with warm-up and a temp DB. It rescales boxes from the processed frame to the original image (`sx = width / image_width`, `sy = height / image_height`) and aggregates a summary;
  - `markdown()`;
  - `main()` (CLI `--runs/--threshold/--model/--out`).
- **Outputs:** `backend/samples/results.json` (official run) and `compare-<model>-<thr>.json` (4 comparison runs).
- **Default model:** `.env` and the `config.py` default changed from `yolov8n.pt` to `yolov8s.pt` (user decision, after the comparison).
- **Frontend samples:** `bus.jpg`/`zidane.jpg` removed; the 16 COCO images (byte-identical to the backend copies), a new `index.json` with scenario labels, and `CREDITS.md`.
- **`ImageUploader.jsx`:** more than `MAX_SAMPLE_CHIPS = 4` samples render a searchable Mantine `Select` (`aria-label="Try a sample image"`, `value={null}`, `onOptionSubmit`, `selectFirstOptionOnChange`) instead of chips.
- **Docs:** `README.md` and `docs/screenshots/{detect-beach,detect-night,history}.jpg`.

**Sources of expected behavior:**
- instructions.md:
  - "Testing & Validation": the metric definitions and targets;
  - "Dataset": at least 10 demo images in `frontend/public/samples/`;
  - "Code Quality": what the README must contain;
  - "Required Documentation": 2–3 screenshots, failure cases, what worked and what could be improved.
- ARCHITECTURE.md §2 (layout), §3.5 (configuration), §4.3 (samples manifest `[{file, label}]`) and §5 (model evaluation).
- PROGRESS.md "Milestone 5" and its RESUME CHECKLIST.
- `ground_truth.json`'s own `visible_rule`, which is the documented scoring rule the README repeats.

**In scope:**
- Unit tests for `iou`, `score_image`, and `run()`'s rescaling and aggregation, with the detector replaced by `FakeDetector` (via `app.dependency_overrides`) and a temp samples dir.
- Data-integrity tests over the two sample folders, `ground_truth.json`, `index.json` and both `CREDITS.md`.
- README-vs-data drift tests.
- Config and doc consistency for the model default.
- Component tests for the `ImageUploader` Select path and the 4/5 boundary.
- One slow integration test that runs `evaluate.run()` on the real model.

**Out of scope:**
- Re-testing `/detect`, `/history` and `/reset` themselves (see Regression).
- Re-deriving COCO's annotations: the 241 MB annotation zip isn't in the repo, so `persons_xywh` is trusted as given.
- Judging whether the manual-review calls are right (see Manual checks).

**Test-run rules:**
- `run()` mutates module globals: `config.DB_PATH`, `WARMUP_MODEL`, and optionally `CONFIDENCE_THRESHOLD`/`MODEL_PATH`. Tests must restore them. The autouse `isolated_config` fixture restores `DB_PATH` and `WARMUP_MODEL`; use `monkeypatch.setattr` on the other two before calling `run()`.
- Tests must call `get_detector.cache_clear()` before and after any real-model `run()`.
- Point `evaluate.SAMPLES` at a `tmp_path` for unit tests, using `monkeypatch.setattr(evaluate, "SAMPLES", tmp)`.
- Never touch `backend/detecto.db` or the servers on :8000/:5173.

## Test cases

### `iou` (unit, pure)

- **ID** M5-iou-01
- **Behavior:** IoU is 1 for identical boxes, 0 for disjoint or edge-touching boxes, and symmetric.
- **Source:** instructions.md "Testing & Validation" (correct = overlaps a person); evaluate.py docstring (IoU ≥ 0.5)
- **Setup:** none.
- **Steps → Expected:**
  - `iou([0,0,10,10],[0,0,10,10]) == 1.0`.
  - `iou([0,0,10,10],[20,20,30,30]) == 0.0`.
  - `iou([0,0,10,10],[10,0,20,10]) == 0.0` (shared edge only).
  - `iou(a,b) == iou(b,a)` for `a=[0,0,10,10]`, `b=[5,5,15,15]`, and that value `== pytest.approx(25/175)`.
- **Type:** unit

- **ID** M5-iou-02
- **Behavior:** Containment and degenerate boxes give defined values, with no division by zero.
- **Source:** evaluate.py `iou` contract (`[x1,y1,x2,y2]`); spec silent on degenerate boxes, so these only check that no exception is raised
- **Setup:** none.
- **Steps → Expected:**
  - `iou([0,0,10,10],[0,0,10,5]) == 0.5` exactly (containment, half area).
  - `iou([5,5,5,5],[5,5,5,5]) == 0.0` (zero-area boxes, union 0).
  - `iou([0,0,0,10],[0,0,10,10]) == 0.0`.
- **Type:** unit

### `score_image` (unit, pure)

All cases use `min_visible_height=20` and `match_iou=0.5` unless stated. Detections are `{"bbox": [x1,y1,x2,y2], "confidence": c}`, and ground truth is `[x, y, w, h]`.

- **ID** M5-score-01
- **Behavior:** Ground truth in xywh is converted to corners before matching: a detection equal to the converted box is correct.
- **Source:** ground_truth.json (`persons_xywh`); evaluate.py docstring
- **Setup:** GT `[[10,10,20,40]]`; detection `[10,10,30,50]` @0.9.
- **Steps → Expected:** `visible=1, correct=1, missed=0, false_positives=0, ignored_small=0, correct_confidences=[0.9]`.
- **Type:** unit

- **ID** M5-score-02
- **Behavior:** Matching is greedy by descending confidence, not by input order or IoU: the higher-confidence detection claims the person even when a lower-confidence one overlaps it better.
- **Source:** README "Method" ("greedy, highest confidence first"); evaluate.py docstring
- **Setup:** GT `[[0,0,100,100]]`. Detections in **ascending** confidence order: D1 `[0,0,100,100]` @0.6 (IoU 1.0), D2 `[0,0,100,60]` @0.9 (IoU 0.6).
- **Steps → Expected:** `correct=1, false_positives=1, correct_confidences=[0.9]` (D2 matched, D1 is the duplicate). Reversing the input list gives an identical result.
- **Type:** unit

- **ID** M5-score-03
- **Behavior:** Each person is matched at most once: a duplicate detection on an already-matched person is a false positive. **[OQ-2]**
- **Source:** README "Method" ("each person can be matched once"); OQ-2 on whether duplicates are FPs under the brief's wording
- **Setup:** GT `[[0,0,100,100]]`; three detections all `[0,0,100,100]` @0.9, @0.8, @0.7.
- **Steps → Expected:** `correct=1, false_positives=2, missed=0, correct_confidences=[0.9]`.
- **Type:** unit

- **ID** M5-score-04
- **Behavior:** A detection takes the untaken person with the highest IoU, and skips persons already taken.
- **Source:** evaluate.py docstring (greedy; each person matched at most once)
- **Setup:** GT A `[0,0,100,100]`, B `[50,0,100,100]` (corners `[50,0,150,100]`).
  - D1 @0.9 `[40,0,140,100]`: IoU with B ≈ 0.818, with A ≈ 0.429.
  - D2 @0.8 `[0,0,100,100]`: IoU with A = 1.0, with B ≈ 0.333.
- **Steps → Expected:** D1 matches B and D2 matches A: `correct=2, false_positives=0, missed=0`.
  - Variant: add D3 @0.7 `[0,0,100,100]`. Expected `false_positives=1` (A is taken; B's IoU is below 0.5).
- **Type:** unit

- **ID** M5-score-05
- **Behavior:** IoU exactly 0.5 counts as a match, and just below it doesn't.
- **Source:** instructions-derived rule "IoU ≥ 0.5" (README "Method", ground_truth.json `match_iou`)
- **Setup:** GT `[[0,0,10,10]]`.
- **Steps → Expected:**
  - Detection `[0,0,10,5]` (IoU = 0.5 exactly): `correct=1, false_positives=0`.
  - Detection `[0,0,10,4.9]` (IoU 0.49): `correct=0, false_positives=1, missed=1`.
  - Detection `[0,0,10,5.1]` (IoU 0.51): `correct=1`.
- **Type:** unit

- **ID** M5-score-06
- **Behavior:** `match_iou` is honoured as passed, not hard-coded.
- **Source:** ground_truth.json `match_iou`; `score_image` signature
- **Setup:** GT `[[0,0,10,10]]`; detection `[0,0,10,6]` (IoU 0.6).
- **Steps → Expected:** with `match_iou=0.5`, `correct=1`; with `match_iou=0.7`, `correct=0, false_positives=1`.
- **Type:** unit

- **ID** M5-score-07
- **Behavior:** People shorter than `min_visible_height` are ignored. A detection matching one is neither correct nor a false positive, and an undetected one is not missed.
- **Source:** ground_truth.json `visible_rule`; README "Method" ("Visible persons")
- **Setup:** GT: big `[0,0,50,100]` and small `[200,200,10,19.9]`.
- **Steps → Expected:**
  - Detection on the small box only (`[200,200,210,219.9]` @0.6): `visible=1, correct=0, missed=1, false_positives=0, ignored_small=1, correct_confidences=[]`.
  - No detections: `visible=1, missed=1, ignored_small=0` (the small person isn't missed).
  - Detections on both: `correct=1, ignored_small=1, false_positives=0, missed=0`.
- **Type:** unit

- **ID** M5-score-08
- **Behavior:** The visibility boundary is inclusive: a box exactly 20 px tall is visible, and 19.99 px is not.
- **Source:** ground_truth.json `visible_rule` ("at least 20px tall")
- **Setup:** GT `[[0,0,10,20]]`, then `[[0,0,10,19.99]]`; no detections.
- **Steps → Expected:** `visible=1, missed=1` for the first; `visible=0, missed=0` for the second.
- **Type:** unit

- **ID** M5-score-09
- **Behavior:** An image with no ground truth counts every detection as a false positive.
- **Source:** instructions.md "False Positives"; README negatives (statue, doll)
- **Setup:** GT `[]`; detections @0.79 and @0.55.
- **Steps → Expected:** `visible=0, correct=0, missed=0, false_positives=2, ignored_small=0, correct_confidences=[]`.
- **Type:** unit

- **ID** M5-score-10
- **Behavior:** No detections means every visible person is missed and nothing is a false positive. Both inputs empty gives all zeros.
- **Source:** instructions.md "Detection Accuracy"
- **Setup:** GT with 3 visible persons and `[]` detections; then GT `[]` and detections `[]`.
- **Steps → Expected:**
  - `visible=3, correct=0, missed=3, false_positives=0, correct_confidences=[]`.
  - Then `visible=0, correct=0, missed=0, false_positives=0, ignored_small=0, correct_confidences=[]`.
- **Type:** unit

- **ID** M5-score-11
- **Behavior:** The counts are always consistent: `correct + false_positives + ignored_small == len(detections)`, `correct + missed == visible`, and `len(correct_confidences) == correct`.
- **Source:** the definitions in instructions.md "Testing & Validation"
- **Setup:** reuse every input from M5-score-01..10.
- **Steps → Expected:** the three identities hold for each.
- **Type:** unit

- **ID** M5-score-12
- **Behavior:** `score_image` doesn't mutate its inputs.
- **Source:** design hygiene (`run()` reuses `body["detections"]` for `detected`)
- **Setup:** deep-copy the inputs of M5-score-02.
- **Steps → Expected:** after the call, the inputs equal their copies (the order of `detections` is unchanged).
- **Type:** unit

### `run()`: rescaling, aggregation and isolation (unit, `FakeDetector`, temp samples dir)

**Shared setup:**
- `tmp/ground_truth.json` (`match_iou 0.5`, `min_visible_height_px 20`) and synthetic JPEGs in `tmp` (`helpers.jpeg_bytes`).
- `monkeypatch.setattr(evaluate, "SAMPLES", tmp)`.
- `app.dependency_overrides[get_detector] = lambda: fake` (the lifespan warm-up uses the override, so no real model loads).

- **ID** M5-run-01
- **Behavior:** Boxes from the processed (downscaled) frame are rescaled to original-image coordinates before scoring.
- **Source:** PROGRESS.md M5; README "How a detection flows" step 4 (boxes are in processed-frame coordinates); ground truth is in original pixels
- **Setup:** one 2560×1440 JPEG (the backend resizes it to 1280×720). GT `[[200,200,200,200]]`. The fake returns `[100,100,200,200]` @0.9.
- **Steps → Expected:** the entry has `status=200, correct=1, false_positives=0, missed=0`. Without rescaling the IoU would be 0, so this proves the scaling.
- **Type:** unit

- **ID** M5-run-02
- **Behavior:** X and Y use separate scale factors, taken from the response's `image_width`/`image_height`.
- **Source:** evaluate.py (`sx`, `sy`)
- **Setup:** one 3000×1000 JPEG. Use whatever processed size the backend reports (expected 1280 × ≈427). The fake returns the full frame `[0,0,W',H']`, with W' and H' read from a first probe response, or `[0,0,1280,427]`. GT `[[0,0,3000,1000]]`.
- **Steps → Expected:** `correct=1`. A second GT variant `[[1500,0,1500,1000]]` with the fake box `[640,0,1280,427]` also gives `correct=1`.
- **Type:** unit

- **ID** M5-run-03
- **Behavior:** Images at or below 1280 px aren't rescaled (factor 1).
- **Source:** README "How a detection flows" (resize only above 1280 px)
- **Setup:** a 640×480 JPEG; GT `[[10,10,100,200]]`; the fake returns `[10,10,110,210]`.
- **Steps → Expected:** `correct=1`. The rescaled box equals the input: it would still match at `match_iou=0.99`.
- **Type:** unit

- **ID** M5-run-04
- **Behavior:** Each image is sent `runs` times, and the per-image model time is the mean of the runs.
- **Source:** README "Method" ("mean model time over 3 runs per image, after warm-up")
- **Setup:** 2 images; the fake returns `inference_time_ms` 10, 20, 30 on successive calls for each image (a small fake subclass).
- **Steps → Expected:**
  - With `run(3)`, the fake's `detect_calls == 1 + 2*3` (one warm-up).
  - Each entry has `inference_ms == 20.0` and `round_trip_ms > 0`.
  - `summary["runs_per_image"] == 3` and `summary["avg_inference_ms"] == 20.0`.
- **Type:** unit

- **ID** M5-run-05
- **Behavior:** The summary metrics follow the brief's formulas.
- **Source:** instructions.md "Testing & Validation"; README "Method"
- **Setup:** 3 images, with fakes chosen per image (e.g. keyed by the received frame's shape):
  - Image A: 2 visible persons; 1 correct @0.8 and 1 FP @0.6.
  - Image B: 1 visible person; 1 correct @0.9.
  - Image C: 0 persons; no detections.
- **Steps → Expected:**
  - `visible_persons=3`, `correct_detections=2`, `missed=1`, `false_positives=1`.
  - `detection_accuracy_pct == pytest.approx(66.667, abs=1e-3)`.
  - `false_positive_pct == pytest.approx(33.333, abs=1e-3)` (1 of 3).
  - `avg_confidence == pytest.approx(0.85)` (correct detections only; the FP's 0.6 is excluded).
  - `reliability_pct == 100.0`.
  - `images == 3`.
- **Type:** unit

- **ID** M5-run-06
- **Behavior:** The false-positive rate's denominator is the detections that were scored; detections on ignored small people are left out. **[OQ-1]**
- **Source:** evaluate.py docstring ("unmatched detections / all scored detections") vs README "÷ all detections" (OQ-1)
- **Setup:** 1 image: GT has one visible and one 10 px person. Detections: 1 correct, 1 on the small person, 1 FP.
- **Steps → Expected:** under the docstring rule, `false_positive_pct == 50.0`; under the README wording it would be 33.3. Assert the rule agreed in OQ-1.
- **Type:** unit

- **ID** M5-run-07
- **Behavior:** Reliability counts images answered with 200. A failing image is reported with its status and excluded from scoring, and the remaining images are still scored.
- **Source:** instructions.md "System Reliability"
- **Setup:** 2 images. The fake raises `RuntimeError` for image 2 only, which the route turns into a 500.
- **Steps → Expected:**
  - `results[1]["status"] == 500`, and the entry has no `visible`/`correct` keys.
  - `results[0]` is scored.
  - `reliability_pct == 50.0`; the accuracy and averages come from image 1 only.
- **Type:** unit

- **ID** M5-run-08
- **Behavior:** A failure on a later run of the same image marks that image as failed. Runs stop at the first failure, and no partial timing is used.
- **Source:** instructions.md "System Reliability" (the image must be processed without errors)
- **Setup:** 1 image; the fake succeeds on its first detect after warm-up, then raises.
- **Steps → Expected:**
  - With `run(3)`, `results[0]["status"] == 500` and `reliability_pct == 0.0`.
  - `avg_inference_ms is None`, `detection_accuracy_pct is None` (no visible persons scored) and `avg_confidence is None`.
  - The fake made 1 warm-up and 2 detect calls.
- **Type:** unit

- **ID** M5-run-09
- **Behavior:** The edge-case summary values are defined: no visible persons gives accuracy `None`, and no scored detections gives an FP rate of `0.0`.
- **Source:** evaluate.py summary; spec silent
- **Setup:** 1 image with GT `[]`; the fake returns `[]`.
- **Steps → Expected:** `detection_accuracy_pct is None`, `false_positive_pct == 0.0` and `avg_confidence is None`.
- **Type:** unit

- **ID** M5-run-10
- **Behavior:** Evaluation never writes to the real history DB. It uses a temp DB that receives one record per request.
- **Source:** PROGRESS.md M5 ("temp DB"); README "Method" ("with a temporary database")
- **Setup:** record `REAL_DB`'s existence, mtime and size; 2 images, `run(2)`.
- **Steps → Expected:**
  - `REAL_DB` is unchanged.
  - During the run, `config.DB_PATH != str(REAL_DB)`; capture it inside the fake's `detect`.
  - That DB holds exactly 4 records (`SQLiteStorage(path).list()`).
- **Type:** unit

- **ID** M5-run-11
- **Behavior:** The `threshold` and `model` overrides reach `config` before the detector is built, and are reported in the summary.
- **Source:** evaluate.py CLI `--threshold/--model`; README comparison table
- **Setup:**
  - `monkeypatch.setattr` both config attributes first (for restore), then `get_detector.cache_clear()`.
  - Patch `backend.services.detector.PersonDetector` with a stub that records its constructor args and returns no detections. Don't use `dependency_overrides` here.
- **Steps → Expected:**
  - `run(1, threshold=0.35, model="m.pt")` builds the stub with `("m.pt", 0.35)`.
  - `summary["model"] == "m.pt"` and `summary["confidence_threshold"] == 0.35`.
  - Clear the cache afterwards.
- **Type:** unit

- **ID** M5-cli-01
- **Behavior:** `main()` writes `{"summary", "images"}` JSON to `SAMPLES/<--out>` and prints the Markdown table.
- **Source:** evaluate.py usage; README "Method" command
- **Setup:** the shared setup with 1 image; `sys.argv = ["evaluate", "--runs", "1", "--out", "x.json"]`; `capsys`.
- **Steps → Expected:**
  - `tmp/x.json` exists, its keys are `{"summary", "images"}`, and `images[0]["file"]` is the sample.
  - Stdout contains `"| Image | Scenario |"` and `"- Reliability: 100% (1 images)"`.
  - `tmp/results.json` isn't created.
- **Type:** unit

- **ID** M5-md-01
- **Behavior:** `markdown()` renders one row per image, `HTTP <status>` for failed images, and the five metric lines.
- **Source:** evaluate.py `markdown`; README per-image table layout
- **Setup:** a hand-built summary and results with one 200 entry and one 500 entry.
- **Steps → Expected:**
  - The 500 row is `| f.jpg | s | — | HTTP 500 | — | — | — | — |`.
  - The 200 row has `inference_ms` formatted as `:.0f` + `" ms"`.
  - The lines "Detection accuracy: c/v = x.x%" and "False positives: …" match the summary.
- **Type:** unit

- **ID** M5-md-02
- **Behavior:** `markdown()` doesn't crash when a metric is `None` (no visible persons, or every image failed). **[OQ-8]**
- **Source:** spec silent (OQ-8). Today `f"{None:.1f}"` raises `TypeError`.
- **Setup:** the summary from M5-run-09 or M5-run-08.
- **Steps → Expected:** per the OQ-8 decision: returns a string with `n/a` (or a similar placeholder) in place of the missing metrics, and raises nothing.
- **Type:** unit

### Sample set integrity (unit, file reads only)

- **ID** M5-set-01
- **Behavior:** The evaluation and demo sets have at least 10 images.
- **Source:** instructions.md "Dataset" (≥ 10 in `frontend/public/samples/`) and "Testing & Validation" (≥ 10 test images)
- **Setup:** none.
- **Steps → Expected:** `len(ground_truth["images"]) >= 10`, and `index.json` has `>= 10` entries (both are 16 today).
- **Type:** unit

- **ID** M5-set-02
- **Behavior:** Every ground-truth entry has a file in both sample folders, and the two copies are byte-identical.
- **Source:** ARCHITECTURE.md §2 (backend copies for scripts); PROGRESS.md M5 checklist step 2
- **Setup:** none.
- **Steps → Expected:**
  - For each `file` in `ground_truth.json`, `backend/samples/<file>` and `frontend/public/samples/<file>` exist.
  - Their SHA-256 hashes are equal.
  - The `file` names are unique.
- **Type:** unit

- **ID** M5-set-03
- **Behavior:** `index.json` lists exactly the ground-truth files, each with a non-empty label, and neither folder has extra images.
- **Source:** ARCHITECTURE.md §4.3 (`[{file, label}]`); PROGRESS.md M5 (bus/zidane removed)
- **Setup:** none.
- **Steps → Expected:**
  - `{e.file for e in index.json} == {gt files}`, with no duplicates.
  - Every `label` is a non-empty string.
  - The `*.jpg|*.jpeg|*.png` files in `frontend/public/samples/` == `{gt files}`; in particular `bus.jpg` and `zidane.jpg` are absent.
  - The image files in `backend/samples/` == `{gt files}`.
- **Type:** unit

- **ID** M5-set-04
- **Behavior:** Each ground-truth entry is internally consistent with its image.
- **Source:** ground_truth.json schema; README "Test set"
- **Setup:** decode with PIL.
- **Steps → Expected:** for each entry:
  - The decoded `(width, height)` equals the entry's `width`/`height`.
  - The EXIF orientation tag is absent or 1. Otherwise the backend's EXIF transpose would swap axes and break the rescale in `run()`.
  - `file == f"coco-{coco_id}.jpg"`.
  - Every `[x,y,w,h]` has `w > 0`, `h > 0`, and lies within the image (0.5 px tolerance).
  - `visible_persons == count(h >= min_visible_height_px)`.
  - `scenario` and `description` are non-empty.
- **Type:** unit

- **ID** M5-set-05
- **Behavior:** The set totals match what the docs claim: 69 visible persons, 3 images with no persons, and every listed scenario present.
- **Source:** README "Test set"; PROGRESS.md M5
- **Setup:** none.
- **Steps → Expected:**
  - `sum(visible_persons) == 69`.
  - Exactly 3 entries have `persons_xywh == []`.
  - The scenario set ⊇ `{"single", "small-group", "group", "crowd", "occlusion", "distant", "low-light", "negative"}`.
  - `match_iou == 0.5` and `min_visible_height_px == 20`, as the README states.
- **Type:** unit

- **ID** M5-set-06
- **Behavior:** Every image is licensed CC BY 2.0 or CC BY-SA 2.0.
- **Source:** PROGRESS.md M5 ("Only CC BY / CC BY-SA"); README "Image credits"
- **Setup:** none.
- **Steps → Expected:**
  - Every `license_url` is in `{"http://creativecommons.org/licenses/by/2.0/", "http://creativecommons.org/licenses/by-sa/2.0/"}`.
  - Every `license` is in `{"Attribution License", "Attribution-ShareAlike License"}`, consistent with the URL.
  - Every `flickr_url` starts with `http`.
- **Type:** unit

- **ID** M5-set-07
- **Behavior:** Both `CREDITS.md` files are identical and list every image exactly once, with its COCO id, the same licence URL as the ground truth, and its Flickr URL.
- **Source:** README "Image credits" (links `frontend/public/samples/CREDITS.md`); PROGRESS.md M5 step 2
- **Setup:** parse the Markdown table rows `| file | id | [CC …](url) | [Flickr](url) |`.
- **Steps → Expected:**
  - The two files' bytes are equal.
  - The set of rows' files == the gt files, and the count == the number of gt entries.
  - For each row, the id, licence URL and Flickr URL equal the ground truth.
  - The licence text is "CC BY 2.0" for the by URL and "CC BY-SA 2.0" for the by-sa URL.
- **Type:** unit

### README claims match the data (unit, drift guard)

**Shared setup:** parse `README.md` with regexes on the known table headers, and load `backend/samples/results.json`. Each case fails if the README and the JSON drift apart.

- **ID** M5-readme-01
- **Behavior:** The "Automatic (IoU ≥ 0.5)" column of the results table equals `results.json["summary"]`.
- **Source:** instructions.md "Document all results in a table … with actual numbers"; PROGRESS.md M5 checklist step 1
- **Setup:** the rows of the table under "### Results".
- **Steps → Expected:**
  - **Accuracy:** "85.5 %" == `f"{detection_accuracy_pct:.1f}"`, and "(59/69)" == `correct_detections/visible_persons`.
  - **FP:** "9.2 %" == `f"{false_positive_pct:.1f}"`, and "(6/65)" == `false_positives/(correct_detections+false_positives)`.
  - **Inference:** "152 ms" == `round(avg_inference_ms)`, and "171 ms round trip" == `round(avg_round_trip_ms)`.
  - **Confidence:** "0.793" == `f"{avg_confidence:.3f}"`.
  - **Reliability:** "100 %" == `reliability_pct`, and "(16/16)" == `ok/images`.
- **Type:** unit

- **ID** M5-readme-02
- **Behavior:** The results heading names the model and threshold that produced `results.json`, and those are the current defaults.
- **Source:** README "Results (YOLOv8s, confidence threshold 0.5)"; PROGRESS.md M5 step 1
- **Setup:** none.
- **Steps → Expected:**
  - `summary["model"] == "yolov8s.pt"`, `summary["confidence_threshold"] == 0.5`, `summary["images"] == len(gt)` and `runs_per_image == 3` (the README says 3 runs).
  - The heading contains "YOLOv8s" and "0.5".
  - The model and threshold equal `.env`'s `MODEL_PATH`/`CONFIDENCE_THRESHOLD`.
- **Type:** unit

- **ID** M5-readme-03
- **Behavior:** The per-image table has one row per `results.json` image in the same order, and every numeric cell equals the JSON.
- **Source:** instructions.md "Log test cases and failures"; README `<details>` table
- **Setup:** parse the rows under the header `| Image | Scenario | Visible | Detected | Correct | Missed | False pos. | Model time |`. Strip the `†`/`‡` markers and whitespace from cells. Ignore the Scenario column: the README uses prose ("small group, dim") and the JSON uses slugs ("small-group").
- **Steps → Expected:**
  - The list of row files == `[r["file"] for r in images]`.
  - For each row, Visible/Detected/Correct/Missed/False pos. equal the JSON ints, and Model time == `f"{round(inference_ms)} ms"`.
  - Every JSON entry has `status == 200` and `detected == correct + false_positives + ignored_small`.
- **Type:** unit

- **ID** M5-readme-04
- **Behavior:** The "After manual review" numbers are arithmetically consistent: their percentages match their fractions, they share the automatic denominators, and they differ from the automatic numbers only by the footnoted reclassification.
- **Source:** README "Method" ("Manual review") and footnote †; PROGRESS.md M5 step 1. **[OQ-6]** After the resolution, the README's manual-review numbers must also **equal `results.json` → `summary.manual_review`** (see M5-review-01).
- **Setup:** none.
- **Steps → Expected:**
  - "87.0 % (60/69)": `60/69` → 87.0, and 69 == `visible_persons`.
  - "7.7 % (5/65)": `5/65` → 7.7, and 65 == the automatic scored count.
  - manual correct − auto correct == auto FP − manual FP == the number of `†` rows (1).
- **Type:** unit

- **ID** M5-readme-05
- **Behavior:** Each row of the model comparison table matches its comparison run file. **[OQ-5]**
- **Source:** README "Model and threshold comparison"; PROGRESS.md M5 comparison
- **Setup:** load `backend/samples/compare-<model>-<thr>.json`.
- **Steps → Expected:**
  - For the rows v8n@0.35, v8n@0.25 and v8s@0.35, accuracy `:.1f`, FP `:.1f`, confidence `:.3f` and `round(avg_inference_ms)` equal the file's summary.
  - The "(current)" row equals `results.json` (152 ms, not the compare file's 154 ms).
  - **[OQ-5]** The "v8n @ 0.50 (original)" row equals `compare-yolov8n.pt-0.5.json` (re-run per the resolution). Not xfail.
- **Type:** unit

- **ID** M5-readme-06
- **Behavior:** The README's narrative numbers match the data.
- **Source:** README "Features", "Test set", "Test cases and failures"
- **Setup:** none.
- **Steps → Expected:**
  - "pick one of 16 sample images" → 16 == `len(index.json)`.
  - "69 visible people" → `sum(visible)`.
  - "three images with no people" → 3 (M5-set-05).
  - "5 of 13 people missed" (coco-441543) → `missed=5, visible=13`.
  - "8 of 9" (coco-352684) → `correct=8, visible=9`.
  - "distant people (5/5)" (coco-392722) → `correct=5, visible=5`.
  - "the beach group (all 13)" (coco-274460) → `correct=13, visible=13`.
  - "one person missed in each" for 23899/389109/538364 → `missed == 1` each.
  - "all 3 people found, plus one extra" (532690) → `correct=3, false_positives=1`.
  - "kitchen negative (0 detections)" (34873) → `detected=0`.
- **Type:** unit

- **ID** M5-readme-07
- **Behavior:** Every image link in the README resolves to an existing image file, and there are 2–3 screenshots.
- **Source:** instructions.md "Required Documentation" (2–3 screenshots) and "Code Quality" (screenshots)
- **Setup:** extract every `![…](path)` from the README.
- **Steps → Expected:**
  - Each path exists relative to the repo root, starts with JPEG or PNG magic bytes, and has an extension matching its bytes.
  - The number of distinct `docs/screenshots/*` targets is between 2 and 3 (3 today).
  - Every file in `docs/screenshots/` is referenced.
- **Type:** unit

- **ID** M5-readme-08
- **Behavior:** Every relative Markdown link in the README resolves, and every table-of-contents anchor matches a heading.
- **Source:** instructions.md "Code Quality" (README completeness)
- **Setup:** extract `[…](target)` links that aren't `http(s)://`.
- **Steps → Expected:**
  - Files and dirs (`ARCHITECTURE.md`, `PROGRESS.md`, `test-plans/`, `frontend/public/samples/CREDITS.md`) exist.
  - Each `#anchor` in "Contents" equals the GitHub slug (lowercase, punctuation stripped, spaces to `-`) of some `##` heading.
- **Type:** unit

- **ID** M5-readme-09
- **Behavior:** The README has the sections the brief requires.
- **Source:** instructions.md "Code Quality" (README must include …) and "Required Documentation"
- **Setup:** none.
- **Steps → Expected:**
  - Headings exist for "Architecture", "Setup and run", "Backend" and "Frontend" (setup), "Tests", "Evaluation: methodology and results", "Test cases and failures" and "What worked, what could be improved".
  - The results table contains the five metric names from the brief and the targets "≥ 85 %", "≤ 10 %", "≤ 1.5 s", "≥ 0.7" and "100 %".
- **Type:** unit

- **ID** M5-readme-10
- **Behavior:** The README's settings table defaults equal `config.py`'s real defaults.
- **Source:** README "Setup and run" table; ARCHITECTURE.md §3.5
- **Setup:** disable `load_dotenv` and clear the relevant env vars (the `test_db_path_default` pattern in `test_config.py`), then reload config.
- **Steps → Expected:** for each README row:
  - `MODEL_PATH` "yolov8s.pt" == `config.MODEL_PATH`.
  - `CONFIDENCE_THRESHOLD` "0.5" == `str(config.CONFIDENCE_THRESHOLD)`.
  - `MAX_UPLOAD_BYTES` "10485760" == `config.MAX_UPLOAD_BYTES`.
  - `WARMUP_MODEL` "true" → `config.WARMUP_MODEL is True`.
  - `CORS_ORIGINS` "http://localhost:5173" == `config.CORS_ORIGINS[0]`.
  - `DB_PATH` `./backend/detecto.db` resolves to the same path as `config.DB_PATH`.
- **Type:** unit

### Model default (unit)

- **ID** M5-cfg-01
- **Behavior:** With no env var and no `.env`, the model default is `yolov8s.pt` and the threshold is 0.5.
- **Source:** PROGRESS.md M5 checklist step 1 (user decision)
- **Setup:** the `env` fixture from `test_config.py`, with `dotenv.load_dotenv` patched to a no-op and `MODEL_PATH`/`CONFIDENCE_THRESHOLD` deleted; reload.
- **Steps → Expected:** `config.MODEL_PATH == "yolov8s.pt"` and `config.CONFIDENCE_THRESHOLD == 0.5`.
- **Type:** unit

- **ID** M5-cfg-02
- **Behavior:** The shipped `.env` selects `yolov8s.pt` at threshold 0.5.
- **Source:** PROGRESS.md M5 checklist step 1
- **Setup:** `dotenv.dotenv_values(ROOT/".env")`.
- **Steps → Expected:** `["MODEL_PATH"] == "yolov8s.pt"` and `["CONFIDENCE_THRESHOLD"] == "0.5"`.
- **Type:** unit

- **ID** M5-cfg-03
- **Behavior:** ARCHITECTURE.md §3.5's sample `.env` agrees with the shipped `.env` on `MODEL_PATH`. **[OQ-4]**
- **Source:** ARCHITECTURE.md §3.5 (currently `MODEL_PATH=yolov8n.pt`); PROGRESS.md M5 step 1 ("update docs")
- **Setup:** extract the fenced block under "### 3.5" and parse `KEY=VALUE` lines.
- **Steps → Expected:** `MODEL_PATH == "yolov8s.pt"`, plus `CONFIDENCE_THRESHOLD`, `DB_PATH` (ignoring the trailing comment) and `CORS_ORIGINS` equal to `.env`. This **fails today**, which is expected until OQ-4 is applied.
- **Type:** unit

- **ID** M5-cfg-04
- **Behavior:** No current-state doc or code comment names YOLOv8n as the model in use. **[OQ-4]**
- **Source:** PROGRESS.md M5 step 1 ("update docs")
- **Setup:** grep for `YOLOv8n` (case-insensitive) in `ARCHITECTURE.md`, `pytest.ini`, `backend/scripts/evaluate.py`, `backend/tests/test_integration.py` (docstring) and `README.md`.
- **Steps → Expected:** every remaining match is in an allow-list of explicitly historical or comparative text:
  - README "Model and threshold comparison" and the `MODEL_PATH` row's "`yolov8n.pt` is faster…";
  - ARCHITECTURE §7, if OQ-4 keeps it as history with a note.
  Today `evaluate.py` line 7 ("real YOLOv8n model"), the `pytest.ini` marker text and §3.5 fail this check.
- **Type:** unit

### ImageUploader: Select path and threshold (component, `mockFetch`)

**Shared setup:** `mockFetch({ manifest: N entries })`. Sample downloads return a JPEG blob (the existing `helpers` pattern from M3-upl-06). `userEvent.setup()`. Query the control as `getByRole("combobox", { name: "Try a sample image" })`; Mantine 9 sets `role="combobox"` on the searchable input.

- **ID** M5-upl-01
- **Behavior:** With exactly 4 samples the chips are shown (4 buttons and "Or try a sample:") and there is no combobox.
- **Source:** PROGRESS.md M5 step 4 ("chips for 4 or fewer"); the M3 chip behavior is unchanged
- **Setup:** a manifest of 4 entries.
- **Steps → Expected:**
  - The 4 `button`s are named by their labels.
  - The text "Or try a sample:" is present.
  - `queryByRole("combobox", {name: "Try a sample image"})` is null.
- **Type:** e2e (component)

- **ID** M5-upl-02
- **Behavior:** With 5 samples, a single combobox replaces the chips.
- **Source:** PROGRESS.md M5 step 4 ("a searchable Select for more")
- **Setup:** a manifest of 5 entries.
- **Steps → Expected:**
  - The combobox "Try a sample image" exists, with placeholder "Or try a sample…".
  - No sample-label buttons and no "Or try a sample:" text.
  - "Choose an image" is still present.
- **Type:** e2e (component)

- **ID** M5-upl-03
- **Behavior:** Opening the combobox lists every sample as an option, labelled by `label` or by file name when the label is missing.
- **Source:** ARCHITECTURE.md §4.3 manifest; M3-upl-01 label fallback
- **Setup:** 5 entries, one without `label` (`{file: "x.png"}`).
- **Steps → Expected:** click the combobox; the `listbox` (named "Try a sample image") has 5 `option`s whose names equal the labels, with "x.png" for the unlabelled entry, in manifest order.
- **Type:** e2e (component)

- **ID** M5-upl-04
- **Behavior:** Clicking an option downloads that sample and calls `onSelect` once with a `File` named after it.
- **Source:** PROGRESS.md M5 step 4; M3-upl-06 contract
- **Setup:** 5 entries, including `{file: "coco-274460.jpg", label: "Beach group"}`.
- **Steps → Expected:**
  - Open the list and click the option "Beach group".
  - `fetch` was called with `"/samples/coco-274460.jpg"`.
  - `onSelect` was called once with a `File` where `name === "coco-274460.jpg"` and `type` starts with `image/`.
- **Type:** e2e (component)

- **ID** M5-upl-05
- **Behavior:** Typing a search and pressing Enter loads the first matching sample.
- **Source:** PROGRESS.md M5 step 4 ("Keyboard bug found and fixed … `selectFirstOptionOnChange` and `onOptionSubmit`")
- **Setup:** 5 entries with labels "One person", "Night dinner", "Night street", "Beach group", "Kitchen (no people)".
- **Steps → Expected:**
  - `user.type(combobox, "night{Enter}")` calls `onSelect` once with the "Night dinner" file (first match in manifest order).
  - `user.type(combobox, "beach{Enter}")` calls it with the "Beach group" file.
- **Type:** e2e (component)

- **ID** M5-upl-06
- **Behavior:** A search with no match, followed by Enter, loads nothing and shows no error.
- **Source:** PROGRESS.md M5 step 4; spec silent beyond "no load"
- **Setup:** 5 entries.
- **Steps → Expected:** `user.type(combobox, "zzz{Enter}")`. `onSelect` isn't called, there is no `/samples/<file>` fetch, and no "Couldn't load" text appears.
- **Type:** e2e (component)

- **ID** M5-upl-07
- **Behavior:** The Select is a launcher: after a pick it's empty again, and picking the same sample a second time loads it again. **[OQ-3]**
- **Source:** ImageUploader comment ("it stays empty and each pick … loads that sample"); PROGRESS.md M5 step 4
- **Setup:** 5 entries.
- **Steps → Expected:**
  - After clicking "Beach group": the combobox `value === ""`, and no option has `aria-selected="true"` on reopen.
  - After `type "beach{Enter}"`: the combobox `value === ""` immediately, without a blur (OQ-3: the code likely keeps "beach" until blur).
  - Picking "Beach group" again calls `onSelect` a 2nd time.
- **Type:** e2e (component)

- **ID** M5-upl-08
- **Behavior:** When `disabled`, the Select is disabled and can't load a sample by click or keyboard.
- **Source:** M3-upl-08 ("when disabled, every input path is inert"), extended to the new path
- **Setup:** 5 entries; `disabled`.
- **Steps → Expected:**
  - The combobox is `toBeDisabled()`.
  - A click doesn't show a `listbox`.
  - `user.type(combobox, "beach{Enter}")` doesn't call `onSelect` and doesn't fetch `/samples/...`.
- **Type:** e2e (component)

- **ID** M5-upl-09
- **Behavior:** Disabling the uploader (or picking a newer file) while a Select-initiated download is in flight drops the late result.
- **Source:** M3-upl-09 [OQ-2] (latest pick wins), applied to the Select path
- **Setup:** 5 entries; the sample fetch is a `deferred`.
- **Steps → Expected:**
  - Pick "Beach group", then rerender with `disabled`, then resolve the download: `onSelect` isn't called.
  - Variant: pick, then choose a file in `file-input`, then resolve: `onSelect` was called only with the chosen file.
- **Type:** e2e (component)

- **ID** M5-upl-10
- **Behavior:** A failed sample download from the Select shows the same error text as the chips.
- **Source:** M3-upl-07/07b; instructions.md "clear error messages"
- **Setup:** 5 entries; `/samples/coco-274460.jpg` → 404.
- **Steps → Expected:** after picking "Beach group", the text `Couldn't load the sample "Beach group".` appears and `onSelect` isn't called.
- **Type:** e2e (component)

- **ID** M5-upl-11
- **Behavior:** The shipped manifest takes the Select path.
- **Source:** README "Features" ("pick one of 16 sample images from a searchable list")
- **Setup:** `mockFetch({ manifest: <contents of public/samples/index.json> })`.
- **Steps → Expected:** the combobox exists; opening it shows 16 options; there are no chip buttons.
- **Type:** e2e (component)

### Evaluation on the real model (integration, `@pytest.mark.integration`)

- **ID** M5-int-01
- **Behavior:** The full evaluation runs end to end on the current default model, processes every image, and reproduces `results.json` per image.
- **Source:** instructions.md "System Reliability"; PROGRESS.md M5 ("official run"); README results
- **Setup:**
  - `get_detector.cache_clear()` before and after.
  - Leave `MODEL_PATH`/`CONFIDENCE_THRESHOLD` at their config values (yolov8s, 0.5).
  - The autouse fixture restores `DB_PATH`/`WARMUP_MODEL`.
  - `run(1)` over the real `backend/samples` (16 images, about 10 s after model load).
- **Steps → Expected:**
  - `reliability_pct == 100.0` and every `status == 200`.
  - `summary["model"] == "yolov8s.pt"`.
  - For each image, `(visible, detected, correct, missed, false_positives, ignored_small)` equals `results.json` exactly.
  - `REAL_DB` is unchanged (mtime and size).
- **Type:** integration (real YOLO model)

- **ID** M5-int-02
- **Behavior:** **Regression guard (not proof of accuracy):** with the current model and threshold, the summary meets the brief's targets on this set. **[OQ-7]**
- **Source:** instructions.md "Testing & Validation" targets
- **Setup:** the summary from M5-int-01 (shared module-scoped fixture).
- **Steps → Expected:**
  - `detection_accuracy_pct >= 85.0`, `false_positive_pct <= 10.0`, `avg_inference_ms <= 1500`, `avg_confidence >= 0.7` and `reliability_pct == 100.0`.
  - The test docstring must say: this set is only 16 images (69 people), and the settings were picked by comparing on this same set. A pass means "no regression since the official run", not "the model meets 85 % in general". Accuracy clears the target by one person (59/69 = 85.5 %; 58/69 = 84.1 %).
- **Type:** integration (real YOLO model)

- **ID** M5-int-03
- **Behavior:** The README's named look-alike and near-miss facts hold on the real model.
- **Source:** README "Test cases and failures" (statue 0.79, doll 0.55) and footnote † (IoU 0.45)
- **Setup:** POST `coco-23751.jpg`, `coco-180296.jpg` and `coco-96493.jpg` through the TestClient with the real model (or capture them in M5-int-01).
- **Steps → Expected:**
  - Statue: `count == 1`, confidence `round(c, 2) == 0.79`.
  - Doll: `count == 1`, `round(c, 2) == 0.55`.
  - For 96493, `0.40 <= iou(det, gt) < 0.50` (rescaled; the scale is 1 here).
- **Type:** integration (real YOLO model)

## Regression

**Baselines (measured while planning, 2026-10-02):**
- Backend `pytest`: **170 passed, 1 failed** (about 19 s).
- Frontend `npx vitest run`: **230/230** (29 files).

**The 1 backend failure, classified for the healer:**
- **Test:** `test_logging.py::test_uvicorn_prints_detection_info_line` (M3-log-04) fails with `FileNotFoundError` on `frontend/public/samples/zidane.jpg`.
- **Classification: test-fixture bug, not an app bug.** M5 deliberately removed that file (user-approved). The test's intent (uvicorn prints the detection INFO line, and the real DB is untouched) is unaffected.
- **Fix:** read `ultralytics.utils.ASSETS / "zidane.jpg"`, as `test_integration.py` already does. It is also 1280×720, so the `size=1280x720` regex and every other assertion stay unchanged. Don't weaken the regex.
- Using a `backend/samples` image would also work, but then the size in the regex must change to that image's real size.

**Re-check unchanged:**
- **M1 integration** (`test_integration.py`):
  - bus 3–4 people at 810×1080;
  - zidane exactly 2 at 1280×720;
  - blank frame 0;
  - annotated image shape;
  - warm mean < 1500 ms.

  These counts were written for YOLOv8n. They pass under YOLOv8s today (in the 170), but they're the most model-sensitive tests, so re-run them on every model change. If one fails after a model change, classify it as a **test expectation tied to the old model** and escalate. Don't silently widen ranges.
- **Timing:** YOLOv8s is about 2× slower (about 150 ms vs 70 ms per image on the dev CPU).
  - M1-int-05 (< 1500 ms) still has about 10× margin.
  - M3-log-04 starts uvicorn with `WARMUP_MODEL=false`, so its first `/detect` includes loading the 22 MB weights; its 60 s request timeout must still be ample.
  - On a fresh clone, the first integration run downloads `yolov8s.pt` (needs network). Note this if CI is ever added.
- **`test_detect_persistence.py` real-model case** (uses ASSETS `bus.jpg`): it must still pass under v8s.
- **M3-samples-01** (`src/test/samples.test.js`) now validates the 16-entry manifest: each file exists and has JPEG magic bytes. It must stay green.
- **M3-upl-01..10 and the DetectionView tests** use mocked manifests with ≤ 2 entries, so they still exercise the chip path. They must stay green unchanged, and M5-upl-01 pins the boundary.
- **DetectionView manual flow:** loading a sample through the Select must still run the pre-check and the upload exactly like a chip did (covered by M5-upl-04 at component level, and by manual check 2).
- **`frontend` build:** `npm run build` still succeeds; `Select` is already in `@mantine/core`.

## Manual checks

Use the servers on :8000/:5173 **read-only**. Picking a sample creates a history record on :8000, which is the user's data. Do that only with the user's OK, or against a sandbox backend (`DB_PATH=<scratch>/sandbox.db … --port 8001` and a second Vite instance on 5174, as in M4). **Never call `DELETE /reset`.**

1. **README rendering:** view `README.md` rendered (the GitHub preview or a Markdown viewer).
   - The 2+1 screenshots display.
   - The `<details>` per-image table expands.
   - The † and ‡ footnotes are readable.
   - The architecture diagram's box borders line up in a monospace font.
2. **Select in a real browser (sandbox):**
   - At ≥ 1200 px, the upload bar stays one line high with the 240 px Select.
   - The dropdown (max 320 px) fits the viewport and scrolls.
   - Type "night" + Enter: "Night dinner" loads.
   - The field is empty afterwards; record whether it empties before blur (OQ-3).
   - At 360 px, the bar wraps cleanly with no horizontal page scroll.
   - The screen-reader name is "Try a sample image" (the Accessibility pane).
3. **Screenshots are current and licensed:**
   - The three `docs/screenshots/*.jpg` show the current Mantine UI and the default model's results (beach group 13 boxes).
   - They show only images from the CC set; the night one is a CC BY-SA image, and CREDITS notes that derivatives stay BY-SA.
4. **Manual-review judgements:** look at coco-96493 (the † claim that the box covers the whole boy) and coco-274460 (the ‡ "real, unannotated background person"). The human confirms or rejects the README's reading. This can't be automated.
5. **Fresh-clone instructions:**
   - In a scratch copy, follow README "Setup and run" exactly: the venv, `pip install`, uvicorn from the project root, and `npm install && npm run dev`.
   - Both start, and the first start downloads `yolov8s.pt`.
   - Run `python -m backend.scripts.evaluate --runs 1 --out scratch.json`, and delete `scratch.json` afterwards; don't overwrite `results.json`.

> **Note (after healing, 2026-10-02):** M5-score-05/06 as written use a 10 px-tall ground-truth box, which the 20 px visible rule always ignores, so they couldn't test the IoU boundary. The tests use the same IoU values on a ×10 geometry (ground truth `[0,0,100,100]`). See `milestone-5-healer-report.md`.

## Resolved decisions (user, 2026-10-02)

"App change" means code must change, and the tests encode the new behaviour. **Docs/data** changes were made **before generation**, so their tests should pass on the first run.

- **OQ-1 — False-positive denominator:** keep the code's rule (correct + false positives; detections on ignored small people are left out). **Docs:** the README now says "÷ all detections, except those on ignored small people". M5-run-06.
- **OQ-2 — Duplicates and edge rules:** keep all three rules (duplicate = FP; best-overlap-small = ignored; ties go to the later box). **Docs:** the README says duplicates count as false positives.
- **OQ-3 — Select resets immediately:** **app change.** The search text is controlled and set to "" when an option is submitted, so after a click *or* type + Enter the combobox value is "" with no blur. M5-upl-07.
- **OQ-4 — Stale YOLOv8n docs:** **docs.**
  - ARCHITECTURE.md §3.5 says `yolov8s.pt`; §7 is amended to "n at first, s since M5"; §2 lists `backend/scripts/` and `docs/screenshots/`.
  - The `evaluate.py` docstring, the `pytest.ini` marker and the `test_integration.py` docstring say YOLOv8s or "the real model".
  - `.claude/agents/test-planner.md` says YOLOv8s (user approved). The copy outside the repo is not to be touched.
  - PROGRESS's `.png` → `.jpg`.
  - M5-cfg-03 and M5-cfg-04.
- **OQ-5 — Comparison data:** **data.** `backend/samples/compare-yolov8n.pt-0.5.json` was re-run and the README row updated to it. The "(current)" row stays tied to `results.json`, with a note in the README. M5-readme-05.
- **OQ-6 — Manual review is data, not prose:** **app change.**
  - `ground_truth.json` gets a top-level `"manual_review"` list of `{"file", "decision": "count_as_correct", "reason"}`. The only entry is `coco-96493.jpg` (the box-shape mismatch). The beach background person (274460) stays a false positive, which is the conservative call.
  - `evaluate.run()` returns `summary["manual_review"] = {"correct", "false_positives", "detection_accuracy_pct", "false_positive_pct", "applied": [files]}`, computed by applying each `count_as_correct` entry. Each entry turns one false positive plus one miss on that image into one correct; it's only valid if that image has ≥ 1 FP and ≥ 1 miss, else `run()` raises `ValueError`.
  - The README's "After manual review" numbers equal that block.
  - **New case M5-review-01:** unit tests on a temp samples dir for the reclassification arithmetic, an invalid entry (no FP or no miss → `ValueError`), no entries (manual == automatic), and the real `results.json` holding 60/69 and 5/65.
- **OQ-7 — Target test strictness:** keep the targets exact. Exact per-image equality with `results.json` is the main drift check. On failure, re-run the evaluation and update the README; never loosen. M5-int-02 is a regression guard.
- **OQ-8 — `markdown()` with missing metrics:** **app change.** A `None` metric prints "n/a"; no crash. M5-md-02.
- **OQ-9 — `run()` global state:** **app change, small.** `run()` uses a self-cleaning temporary directory for its DB (removed when `run()` returns). Config mutation stays (it's a CLI). Tests isolate it with monkeypatch and `get_detector.cache_clear()`, as in the Test-run rules. New check in M5-run: after `run()`, the temp DB's directory no longer exists.

## Original open questions (resolved above)

- **OQ-1: false-positive denominator.**
  - **Spec:** the brief says "Count any bounding boxes that don't contain a person". The README says FP = "detections that match no person ÷ all detections".
  - **Code:** it divides by `correct + false_positives`, so detections on ignored small people are left out of the denominator.
  - **Why it matters:** the two give identical numbers today (`ignored_small` is 0 everywhere), but will diverge silently if a future image triggers the ignore rule. It decides M5-run-06.
  - **Recommendation:** keep the code's rule (it's the consistent counterpart of ignoring small people) and fix the README wording to "÷ all detections, except those on ignored small people".
- **OQ-2: duplicates and other matching edge rules.**
  - **Spec:** the brief only says FPs are boxes that "don't contain a person".
  - **Code:** a second box on an already-matched person is an FP (it does contain a person). A detection whose best IoU is with an ignored small person is ignored, even if it also overlaps an untaken visible person above 0.5. IoU ties go to the later GT index.
  - **Why it matters:** these rules change the reported numbers, and the README only states "each person can be matched once".
  - **Recommendation:** keep all three (standard detection-benchmark practice), and add one README sentence: "a second box on the same person counts as a false positive".
- **OQ-3: Select search text after Enter.**
  - **Spec:** the code comment and PROGRESS describe a launcher that "stays empty" after each pick.
  - **Code:** it passes `value={null}` but doesn't control `searchValue`. In Mantine 9.6.3's `Select`, `onOptionSubmit` only resets the search when the component is uncontrolled, and the `value === null` effect doesn't re-run. So after typing "beach" + Enter, the typed text likely stays until blur. I inferred this from Mantine's source; it hasn't been run.
  - **Why it matters:** it decides M5-upl-07. Leftover text also filters the list on the next open.
  - **Recommendation:** clear it immediately: control `searchValue`/`onSearchChange` and reset to `""` in `onOptionSubmit`.
- **OQ-4: stale "YOLOv8n" docs.**
  - **Spec:** PROGRESS M5 step 1 says "update docs" after the switch.
  - **Current state:** ARCHITECTURE.md §3.5 still shows `MODEL_PATH=yolov8n.pt`, and §7 says "YOLOv8n via ultralytics". Other stale mentions:
    - the `evaluate.py` docstring ("real YOLOv8n model");
    - the `pytest.ini` marker ("runs the real YOLOv8n model");
    - the `test_integration.py` docstring;
    - `.claude/agents/test-planner.md` ("FastAPI + YOLOv8n backend").

    Also, PROGRESS M5 step 3 says the screenshot links point to `.png`, but the files and links are `.jpg`, and ARCHITECTURE §2 doesn't list `backend/scripts/` or `docs/screenshots/`.
  - **Why it matters:** M5-cfg-03/04 fail until it's resolved, and readers get the wrong default.
  - **Recommendation:**
    - Update §3.5, the `evaluate.py` docstring, the `pytest.ini` marker and the test docstring to YOLOv8s.
    - Amend §7 to "YOLOv8 (n at first, s since M5's evaluation)" and allow-list it.
    - Add the two dirs to §2.
    - Fix ".png" → ".jpg" in PROGRESS.
    - The agent prompt is the user's call.
- **OQ-5: comparison rows without a backing file.**
  - **Current state:** the README row "YOLOv8n @ 0.50 (original)" (75.4 % / 5.5 % / 0.772 / 70 ms) has no `compare-yolov8n.pt-0.5.json`; `results.json` was overwritten by the v8s run. The "(current)" row quotes `results.json` (152 ms), while `compare-yolov8s.pt-0.5.json` says 154 ms.
  - **Why it matters:** every published number should be reproducible from a committed file. It decides M5-readme-05.
  - **Recommendation:**
    - Re-run `--model yolov8n.pt --threshold 0.5 --out compare-yolov8n.pt-0.5.json`, then update the row if the numbers differ (the timing will vary slightly).
    - Keep the "(current)" row tied to `results.json`, and say so in a table note.
- **OQ-6: manual-review numbers have no data file.**
  - **Current state:** "87.0 % (60/69)" and "7.7 % (5/65)" exist only in the README and PROGRESS, so drift can only be tested arithmetically (M5-readme-04).
  - **Why it matters:** if the auto numbers change, the manual column can go stale without failing a strict test.
  - **Recommendation:** add a small `manual_review` block to `ground_truth.json` (e.g. `{"coco-96493.jpg": {"reclassify_fp_as_correct": 1, "reason": "…"}}`), so M5-readme-04 can compute the column. Otherwise accept the arithmetic check.
- **OQ-7: how strict the target test is.**
  - **Background:** 59/69 = 85.5 % clears the 85 % target by one person. A torch/ultralytics upgrade that flips one box fails M5-int-02.
  - **Why it matters:** it decides whether a model-library upgrade can be blocked by a one-person change on 16 images.
  - **Recommendation:**
    - Keep M5-int-01's exact per-image equality with `results.json` as the primary drift detector.
    - Keep M5-int-02 at the brief's targets with no tolerance.
    - On failure, re-run the official evaluation and update the README and `results.json`. Never relax the thresholds.
- **OQ-8: `markdown()` with missing metrics.**
  - **Current state:** with no visible persons, or all images failed, `summary` holds `None`, and `markdown()` raises `TypeError` (`f"{None:.1f}"`). The spec is silent.
  - **Why it matters:** the CLI would crash after writing the JSON, on exactly the failure runs where a report is most needed.
  - **Recommendation:** print "n/a" for `None` metrics (M5-md-02). This is low priority.
- **OQ-9: `run()` leaves global state behind.**
  - **Current state:** `run()` sets `config.DB_PATH`, `WARMUP_MODEL`, `CONFIDENCE_THRESHOLD` and `MODEL_PATH` without restoring them. It leaves the `mkdtemp()` directory behind. Its `model`/`threshold` overrides are ignored if `get_detector` is already cached in the process.
  - **Why it matters:** this is harmless for the CLI, but it leaks into any in-process caller, including the M5 tests.
  - **Recommendation:** leave the script as is, and have the tests isolate it (monkeypatch + `cache_clear`, as in "Test-run rules"). Optionally, use `TemporaryDirectory` for the DB.
