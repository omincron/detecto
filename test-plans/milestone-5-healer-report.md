# Healer report — Milestone 5
Final result: 283 passed, 0 failed, 0 skipped (backend, `backend/.venv/bin/python -m pytest -rA`).
Frontend `npm test`: 244/244 (30 files), unchanged.
Starting point: backend 280 passed, 3 failed.

## Needs human review (C)
None of the failures needs human review. Two follow-ups for the user:
- **Plan text, M5-score-05/06:** `test-plans/milestone-5.md` still lists the 10 px ground
  truth `[[0,0,10,10]]`, which is under the 20 px visible rule. The healer may not edit the
  plan, so the tests now differ from its literal coordinates (see A below). Recommended:
  update the plan to `[[0,0,100,100]]` with detections `[0,0,100,50|49|51|60]`.
- **M5-int-01 fragility (not a flake):** two values sit close to a boundary. One detection
  in `coco-441543.jpg` has confidence **0.50211** against the 0.5 threshold. One detection
  in `coco-541055.jpg` has IoU **0.512** against `match_iou` 0.5. Results are bit-identical
  on this machine (see "Investigated, not reproduced"). A different CPU, torch or
  ultralytics version could flip either one and break the exact per-image equality. Per
  OQ-7, that should be handled by re-running the evaluation and updating the README, not
  by loosening the test. This is noted only; nothing was changed.

## Fixed — test bugs (A)
- `test_evaluate.py::test_score_iou_threshold_is_inclusive` (M5-score-05) and
  `::test_score_honours_match_iou` (M5-score-06).
  - **Cause:** the plan's geometry has a mechanical bug. The ground truth `[0,0,10,10]`
    is 10 px tall, and `score_image` uses `min_visible_height=20`. So the person was
    never visible, and the matching detection was counted as `ignored_small` instead of
    `correct`. The tests could not reach the IoU boundary the plan states as their intent.
  - **App:** `score_image` (`h >= min_visible_height`, then `overlap >= match_iou`)
    matches ARCHITECTURE/README and was not touched.
  - **Change:** scaled the geometry ×10, keeping the default `min_visible_height=20` and
    exactly the same IoU values:
    - GT `[[0,0,100,100]]`;
    - detections `[0,0,100,50]` (IoU 0.5 exactly), `[0,0,100,49]` (0.49),
      `[0,0,100,51]` (0.51) and `[0,0,100,60]` (0.6, with `match_iou` 0.5 vs 0.7).
  - **Assertions:** every original assertion is kept. I added `visible == 1`, so the tests
    can't silently go vacuous again, and an `iou == approx(0.6)` sanity check in score-06.
  - **Where:** `backend/tests/test_evaluate.py:139-185`, with a docstring explaining the
    deviation from the plan.
  - **Discrimination check:** I temporarily changed the app's `>=` to `>`. M5-score-05
    then fails, as it should, and the app was restored.
- `test_logging.py::test_uvicorn_prints_detection_info_line` (M3-log-04).
  - **Cause:** `FileNotFoundError` on `frontend/public/samples/zidane.jpg`, which M5 removed
    on purpose (user-approved licence clean-up).
  - **Change:** the fix is the one the plan's Regression section prescribes:
    `ZIDANE = ASSETS / "zidane.jpg"` (`from ultralytics.utils import ASSETS`). I checked
    that it is 1280×720.
  - **Assertions:** all unchanged, including the `size=1280x720` regex.
  - **Where:** `backend/tests/test_logging.py:15,23-24`.

## Fixed — app bugs (B)
None. No application or script code was changed.

## Investigated, not reproduced
- `test_evaluate_integration.py::test_real_evaluation_reproduces_results_json` (M5-int-01).
  - **Runs:** it passed 18 out of 18 times:
    - 7× `-m integration` (11/11 each);
    - 3× alone;
    - 4× in the full suite;
    - the final full run plus a final `-m integration` run.
  - **Determinism probe:** I ran 9 fresh processes of `evaluate.run(1)` in the scratchpad,
    with various `OMP_NUM_THREADS` values. Every raw detection (confidence and IoU to 5
    decimals) and every per-image count was identical. Ultralytics pins torch to its own
    `NUM_THREADS` in `select_device`, so the thread setting doesn't cause variation.
  - **Isolation review:** I found no leak.
    - The module fixture saves and restores `DB_PATH`, `WARMUP_MODEL`,
      `CONFIDENCE_THRESHOLD` and `MODEL_PATH`.
    - It clears `dependency_overrides` and calls `get_detector.cache_clear()` before and
      after.
    - Every other config mutation in the suite uses `monkeypatch` or the `env` reload
      fixture, and `.env` holds the yolov8s/0.5 defaults.
    - CLI tests write only under a `tmp_path` `SAMPLES`.
  - **Likely explanation (unconfirmed):** `backend/samples/ground_truth.json` (23:27:43)
    and `results.json` (23:28:34) were rewritten during the OQ-6 app changes, around the
    generator's run. A run against data files that were mid-update would explain one
    mismatch. The generator's output wasn't captured, so this can't be proven.
  - **Verdict:** no flake and no non-determinism reproduced, so nothing changed. If it
    fails again, capture `-rA` output; the per-image assertion message names the file.
- `backend/detecto.db` was untouched (mtime 23:04:01, before this session's runs). The
  servers on :8000/:5173 weren't touched, and `/reset` was never called.
