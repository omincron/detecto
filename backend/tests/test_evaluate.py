"""backend/scripts/evaluate.py: IoU, scoring, run() with a fake detector, Markdown, CLI.

run() mutates config globals: isolated_config restores DB_PATH/WARMUP_MODEL, and the
`samples` fixture monkeypatches MODEL_PATH/CONFIDENCE_THRESHOLD and evaluate.SAMPLES.
"""

import copy
import json
import sys
from pathlib import Path

import pytest

from backend import config
from backend.main import app
from backend.scripts import evaluate
from backend.scripts.evaluate import iou, markdown, score_image
from backend.services import detector as detector_module
from backend.services.detector import get_detector
from backend.services.storage import SQLiteStorage
from backend.tests.conftest import REAL_DB, FakeDetector
from backend.tests.helpers import jpeg_bytes

WARMUP_SHAPE = (640, 640)  # the lifespan warm-up frame (backend/main.py)


def det(bbox, confidence):
    return {"bbox": list(bbox), "confidence": confidence}


def score(dets, gt, min_visible_height=20, match_iou=0.5):
    return score_image(dets, gt, min_visible_height, match_iou)


def counts(result, *keys):
    return {k: result[k] for k in keys}


# --- iou -------------------------------------------------------------------------


def test_iou_identical_disjoint_touching_symmetric():
    """M5-iou-01"""
    assert iou([0, 0, 10, 10], [0, 0, 10, 10]) == 1.0
    assert iou([0, 0, 10, 10], [20, 20, 30, 30]) == 0.0
    assert iou([0, 0, 10, 10], [10, 0, 20, 10]) == 0.0
    a, b = [0, 0, 10, 10], [5, 5, 15, 15]
    assert iou(a, b) == iou(b, a)
    assert iou(a, b) == pytest.approx(25 / 175)


def test_iou_containment_and_degenerate_boxes():
    """M5-iou-02"""
    assert iou([0, 0, 10, 10], [0, 0, 10, 5]) == 0.5
    assert iou([5, 5, 5, 5], [5, 5, 5, 5]) == 0.0
    assert iou([0, 0, 0, 10], [0, 0, 10, 10]) == 0.0


# --- score_image -----------------------------------------------------------------

# (gt_xywh, detections, kwargs) for every score_image input in M5-score-01..10,
# reused by the consistency check M5-score-11.
SCORE_INPUTS = [
    ([[10, 10, 20, 40]], [det([10, 10, 30, 50], 0.9)], {}),
    ([[0, 0, 100, 100]], [det([0, 0, 100, 100], 0.6), det([0, 0, 100, 60], 0.9)], {}),
    ([[0, 0, 100, 100]], [det([0, 0, 100, 60], 0.9), det([0, 0, 100, 100], 0.6)], {}),
    ([[0, 0, 100, 100]], [det([0, 0, 100, 100], c) for c in (0.9, 0.8, 0.7)], {}),
    ([[0, 0, 100, 100], [50, 0, 100, 100]],
     [det([40, 0, 140, 100], 0.9), det([0, 0, 100, 100], 0.8)], {}),
    ([[0, 0, 100, 100], [50, 0, 100, 100]],
     [det([40, 0, 140, 100], 0.9), det([0, 0, 100, 100], 0.8), det([0, 0, 100, 100], 0.7)], {}),
    ([[0, 0, 10, 10]], [det([0, 0, 10, 5], 0.9)], {}),
    ([[0, 0, 10, 10]], [det([0, 0, 10, 4.9], 0.9)], {}),
    ([[0, 0, 10, 10]], [det([0, 0, 10, 5.1], 0.9)], {}),
    ([[0, 0, 10, 10]], [det([0, 0, 10, 6], 0.9)], {"match_iou": 0.5}),
    ([[0, 0, 10, 10]], [det([0, 0, 10, 6], 0.9)], {"match_iou": 0.7}),
    ([[0, 0, 50, 100], [200, 200, 10, 19.9]], [det([200, 200, 210, 219.9], 0.6)], {}),
    ([[0, 0, 50, 100], [200, 200, 10, 19.9]], [], {}),
    ([[0, 0, 50, 100], [200, 200, 10, 19.9]],
     [det([0, 0, 50, 100], 0.9), det([200, 200, 210, 219.9], 0.6)], {}),
    ([[0, 0, 10, 20]], [], {}),
    ([[0, 0, 10, 19.99]], [], {}),
    ([], [det([0, 0, 10, 10], 0.79), det([20, 20, 40, 40], 0.55)], {}),
    ([[0, 0, 10, 30], [20, 0, 10, 30], [40, 0, 10, 30]], [], {}),
    ([], [], {}),
]


def test_score_converts_xywh_ground_truth():
    """M5-score-01"""
    result = score([det([10, 10, 30, 50], 0.9)], [[10, 10, 20, 40]])

    assert result == {
        "visible": 1, "correct": 1, "missed": 0, "false_positives": 0,
        "ignored_small": 0, "correct_confidences": [0.9],
    }


def test_score_greedy_by_confidence_not_order_or_iou():
    """M5-score-02"""
    d1 = det([0, 0, 100, 100], 0.6)  # IoU 1.0
    d2 = det([0, 0, 100, 60], 0.9)  # IoU 0.6
    gt = [[0, 0, 100, 100]]

    result = score([d1, d2], gt)
    assert counts(result, "correct", "false_positives") == {"correct": 1, "false_positives": 1}
    assert result["correct_confidences"] == [0.9]
    assert score([d2, d1], gt) == result


def test_score_duplicate_on_matched_person_is_false_positive():
    """M5-score-03 [OQ-2: duplicates are false positives]"""
    dets = [det([0, 0, 100, 100], c) for c in (0.9, 0.8, 0.7)]

    result = score(dets, [[0, 0, 100, 100]])

    assert counts(result, "correct", "false_positives", "missed") == {
        "correct": 1, "false_positives": 2, "missed": 0,
    }
    assert result["correct_confidences"] == [0.9]


def test_score_takes_best_untaken_person():
    """M5-score-04"""
    gt = [[0, 0, 100, 100], [50, 0, 100, 100]]
    d1 = det([40, 0, 140, 100], 0.9)
    d2 = det([0, 0, 100, 100], 0.8)

    result = score([d1, d2], gt)
    assert counts(result, "correct", "false_positives", "missed") == {
        "correct": 2, "false_positives": 0, "missed": 0,
    }

    result = score([d1, d2, det([0, 0, 100, 100], 0.7)], gt)
    assert result["false_positives"] == 1
    assert result["correct"] == 2


def test_score_iou_threshold_is_inclusive():
    """M5-score-05

    The plan's GT [0,0,10,10] is 10 px tall, below min_visible_height=20, so the person
    would be ignored and the boundary never tested. Geometry is scaled x10 (IoU values
    unchanged: 0.5 exactly, 0.49, 0.51) so the person is visible under the default rule.
    """
    gt = [[0, 0, 100, 100]]

    exact = score([det([0, 0, 100, 50], 0.9)], gt)
    assert counts(exact, "visible", "correct", "false_positives") == {
        "visible": 1, "correct": 1, "false_positives": 0,
    }

    below = score([det([0, 0, 100, 49], 0.9)], gt)
    assert counts(below, "visible", "correct", "false_positives", "missed") == {
        "visible": 1, "correct": 0, "false_positives": 1, "missed": 1,
    }

    assert score([det([0, 0, 100, 51], 0.9)], gt)["correct"] == 1


def test_score_honours_match_iou():
    """M5-score-06

    Geometry scaled x10 from the plan (GT 10 px tall would be ignored at
    min_visible_height=20); IoU is still exactly 0.6.
    """
    gt = [[0, 0, 100, 100]]
    dets = [det([0, 0, 100, 60], 0.9)]

    assert iou(dets[0]["bbox"], [0, 0, 100, 100]) == pytest.approx(0.6)
    loose = score(dets, gt, match_iou=0.5)
    assert counts(loose, "visible", "correct") == {"visible": 1, "correct": 1}
    strict = score(dets, gt, match_iou=0.7)
    assert counts(strict, "visible", "correct", "false_positives") == {
        "visible": 1, "correct": 0, "false_positives": 1,
    }


def test_score_small_people_are_ignored():
    """M5-score-07"""
    gt = [[0, 0, 50, 100], [200, 200, 10, 19.9]]
    big = det([0, 0, 50, 100], 0.9)
    small = det([200, 200, 210, 219.9], 0.6)

    assert score([small], gt) == {
        "visible": 1, "correct": 0, "missed": 1, "false_positives": 0,
        "ignored_small": 1, "correct_confidences": [],
    }

    none = score([], gt)
    assert counts(none, "visible", "missed", "ignored_small") == {
        "visible": 1, "missed": 1, "ignored_small": 0,
    }

    both = score([big, small], gt)
    assert counts(both, "correct", "ignored_small", "false_positives", "missed") == {
        "correct": 1, "ignored_small": 1, "false_positives": 0, "missed": 0,
    }


def test_score_visibility_boundary_is_inclusive():
    """M5-score-08"""
    tall = score([], [[0, 0, 10, 20]])
    assert counts(tall, "visible", "missed") == {"visible": 1, "missed": 1}

    short = score([], [[0, 0, 10, 19.99]])
    assert counts(short, "visible", "missed") == {"visible": 0, "missed": 0}


def test_score_no_ground_truth_all_false_positives():
    """M5-score-09"""
    result = score([det([0, 0, 10, 10], 0.79), det([20, 20, 40, 40], 0.55)], [])

    assert result == {
        "visible": 0, "correct": 0, "missed": 0, "false_positives": 2,
        "ignored_small": 0, "correct_confidences": [],
    }


def test_score_no_detections():
    """M5-score-10"""
    result = score([], [[0, 0, 10, 30], [20, 0, 10, 30], [40, 0, 10, 30]])
    assert counts(result, "visible", "correct", "missed", "false_positives") == {
        "visible": 3, "correct": 0, "missed": 3, "false_positives": 0,
    }
    assert result["correct_confidences"] == []

    assert score([], []) == {
        "visible": 0, "correct": 0, "missed": 0, "false_positives": 0,
        "ignored_small": 0, "correct_confidences": [],
    }


@pytest.mark.parametrize("gt, dets, kwargs", SCORE_INPUTS)
def test_score_counts_are_consistent(gt, dets, kwargs):
    """M5-score-11"""
    r = score(dets, gt, **kwargs)

    assert r["correct"] + r["false_positives"] + r["ignored_small"] == len(dets)
    assert r["correct"] + r["missed"] == r["visible"]
    assert len(r["correct_confidences"]) == r["correct"]


def test_score_does_not_mutate_inputs():
    """M5-score-12"""
    dets = [det([0, 0, 100, 100], 0.6), det([0, 0, 100, 60], 0.9)]
    gt = [[0, 0, 100, 100]]
    dets_copy, gt_copy = copy.deepcopy(dets), copy.deepcopy(gt)

    score(dets, gt)

    assert dets == dets_copy
    assert gt == gt_copy


# --- run(): fakes and a temp samples dir -----------------------------------------


class ShapeFake(FakeDetector):
    """Answers per received frame shape (h, w): a detection list or an exception.
    Unknown shapes (e.g. the warm-up frame) get no detections."""

    def __init__(self, by_shape, inference_time_ms=12.5):
        super().__init__(detections=[], inference_time_ms=inference_time_ms)
        self.by_shape = by_shape

    def detect(self, image):
        self.received.append(image)
        answer = self.by_shape.get(image.shape[:2], [])
        if isinstance(answer, Exception):
            raise answer
        if callable(answer):
            answer = answer(image)
        return list(answer), self.inference_time_ms


def install(fake):
    app.dependency_overrides[get_detector] = lambda: fake
    return fake


@pytest.fixture
def samples(tmp_path, monkeypatch):
    """Returns write(images, ...) that builds a temp samples dir for run().

    images: [(file, (width, height), persons_xywh)]; each file is a black JPEG.
    """
    root = tmp_path / "samples"
    root.mkdir()
    monkeypatch.setattr(evaluate, "SAMPLES", root)
    monkeypatch.setattr(config, "MODEL_PATH", config.MODEL_PATH)
    monkeypatch.setattr(config, "CONFIDENCE_THRESHOLD", config.CONFIDENCE_THRESHOLD)

    def write(images, match_iou=0.5, min_visible_height_px=20, manual_review=None):
        entries = []
        for file, (width, height), persons in images:
            (root / file).write_bytes(jpeg_bytes(width, height))
            entries.append({
                "file": file, "scenario": "s", "description": "d",
                "width": width, "height": height,
                "visible_persons": sum(h >= min_visible_height_px for *_, h in persons),
                "persons_xywh": persons,
            })
        truth = {
            "match_iou": match_iou,
            "min_visible_height_px": min_visible_height_px,
            "images": entries,
        }
        if manual_review is not None:
            truth["manual_review"] = manual_review
        (root / "ground_truth.json").write_text(json.dumps(truth))
        return root

    return write


def test_run_rescales_boxes_to_original_image(samples):
    """M5-run-01"""
    samples([("big.jpg", (2560, 1440), [[200, 200, 200, 200]])])
    install(ShapeFake({(720, 1280): [det([100, 100, 200, 200], 0.9)]}))

    summary, results = evaluate.run(1)

    entry = results[0]
    assert entry["status"] == 200
    assert counts(entry, "correct", "false_positives", "missed") == {
        "correct": 1, "false_positives": 0, "missed": 0,
    }


def test_run_separate_x_and_y_scale(samples):
    """M5-run-02"""
    full = lambda img: [det([0, 0, img.shape[1], img.shape[0]], 0.9)]  # noqa: E731
    right_half = lambda img: [det([img.shape[1] / 2, 0, img.shape[1], img.shape[0]], 0.9)]  # noqa: E731

    samples([("wide.jpg", (3000, 1000), [[0, 0, 3000, 1000]])])
    fake = install(ShapeFake({}))
    fake.by_shape = _AnyNonWarmup(full)
    _, results = evaluate.run(1)
    assert results[0]["status"] == 200
    assert results[0]["correct"] == 1
    assert fake.received[-1].shape[1] == 1280

    samples([("wide.jpg", (3000, 1000), [[1500, 0, 1500, 1000]])])
    fake = install(ShapeFake({}))
    fake.by_shape = _AnyNonWarmup(right_half)
    _, results = evaluate.run(1)
    assert results[0]["correct"] == 1


class _AnyNonWarmup(dict):
    """by_shape mapping that answers every non-warm-up frame with `answer`."""

    def __init__(self, answer):
        super().__init__()
        self.answer = answer

    def get(self, shape, default=None):
        return default if tuple(shape) == WARMUP_SHAPE else self.answer


def test_run_small_images_not_rescaled(samples):
    """M5-run-03"""
    for match_iou in (0.5, 0.99):
        samples([("small.jpg", (640, 480), [[10, 10, 100, 200]])], match_iou=match_iou)
        install(ShapeFake({(480, 640): [det([10, 10, 110, 210], 0.9)]}))

        _, results = evaluate.run(1)

        assert results[0]["correct"] == 1, f"match_iou={match_iou}"


class TimedFake(ShapeFake):
    """Model time 10, 20, 30 on successive calls for each image (warm-up excluded)."""

    def __init__(self):
        super().__init__({})
        self.calls_per_shape = {}

    def detect(self, image):
        self.received.append(image)
        shape = image.shape[:2]
        if shape == WARMUP_SHAPE:
            return [], 0.0
        n = self.calls_per_shape.get(shape, 0)
        self.calls_per_shape[shape] = n + 1
        return [], [10.0, 20.0, 30.0][n % 3]


def test_run_repeats_and_averages_model_time(samples):
    """M5-run-04"""
    samples([("a.jpg", (100, 80), []), ("b.jpg", (120, 80), [])])
    fake = install(TimedFake())

    summary, results = evaluate.run(3)

    assert fake.detect_calls == 1 + 2 * 3
    for entry in results:
        assert entry["inference_ms"] == 20.0
        assert entry["round_trip_ms"] > 0
    assert summary["runs_per_image"] == 3
    assert summary["avg_inference_ms"] == 20.0


def test_run_summary_formulas(samples):
    """M5-run-05"""
    samples([
        ("a.jpg", (100, 200), [[0, 0, 50, 100], [50, 0, 50, 100]]),
        ("b.jpg", (120, 200), [[0, 0, 50, 100]]),
        ("c.jpg", (140, 200), []),
    ])
    install(ShapeFake({
        (200, 100): [det([0, 0, 50, 100], 0.8), det([0, 150, 20, 190], 0.6)],
        (200, 120): [det([0, 0, 50, 100], 0.9)],
        (200, 140): [],
    }))

    summary, _ = evaluate.run(1)

    assert counts(summary, "visible_persons", "correct_detections", "missed", "false_positives") == {
        "visible_persons": 3, "correct_detections": 2, "missed": 1, "false_positives": 1,
    }
    assert summary["detection_accuracy_pct"] == pytest.approx(66.667, abs=1e-3)
    assert summary["false_positive_pct"] == pytest.approx(33.333, abs=1e-3)
    assert summary["avg_confidence"] == pytest.approx(0.85)
    assert summary["reliability_pct"] == 100.0
    assert summary["images"] == 3


def test_run_false_positive_rate_excludes_ignored_small(samples):
    """M5-run-06 [OQ-1: denominator = correct + false positives]"""
    samples([("a.jpg", (300, 300), [[0, 0, 50, 100], [100, 100, 10, 10]])])
    install(ShapeFake({(300, 300): [
        det([0, 0, 50, 100], 0.9),  # correct
        det([100, 100, 110, 110], 0.8),  # on the 10 px person: ignored
        det([150, 150, 190, 190], 0.7),  # false positive
    ]}))

    summary, results = evaluate.run(1)

    assert results[0]["ignored_small"] == 1
    assert summary["false_positive_pct"] == 50.0


def test_run_failed_image_reported_and_excluded(samples):
    """M5-run-07"""
    samples([("ok.jpg", (100, 200), [[0, 0, 50, 100]]), ("bad.jpg", (120, 200), [[0, 0, 50, 100]])])
    install(ShapeFake({
        (200, 100): [det([0, 0, 50, 100], 0.9)],
        (200, 120): RuntimeError("boom"),
    }))

    summary, results = evaluate.run(1)

    assert results[1]["status"] == 500
    assert "visible" not in results[1] and "correct" not in results[1]
    assert results[0]["status"] == 200
    assert results[0]["correct"] == 1
    assert summary["reliability_pct"] == 50.0
    assert summary["visible_persons"] == 1
    assert summary["detection_accuracy_pct"] == 100.0
    assert summary["avg_confidence"] == pytest.approx(0.9)
    assert summary["avg_inference_ms"] == 12.5


class FailLaterFake(ShapeFake):
    """Warm-up and the first real detect succeed; every later call raises."""

    def __init__(self):
        super().__init__({})

    def detect(self, image):
        self.received.append(image)
        if image.shape[:2] != WARMUP_SHAPE and self.detect_calls > 2:
            raise RuntimeError("boom")
        return [], 12.5


def test_run_failure_on_later_run_fails_image(samples):
    """M5-run-08"""
    samples([("a.jpg", (100, 200), [[0, 0, 50, 100]])])
    fake = install(FailLaterFake())

    summary, results = evaluate.run(3)

    assert results[0]["status"] == 500
    assert summary["reliability_pct"] == 0.0
    assert summary["avg_inference_ms"] is None
    assert summary["detection_accuracy_pct"] is None
    assert summary["avg_confidence"] is None
    assert fake.detect_calls == 3
    assert fake.received[0].shape[:2] == WARMUP_SHAPE
    assert all(img.shape[:2] == (200, 100) for img in fake.received[1:])


def test_run_edge_case_summary_values(samples):
    """M5-run-09"""
    samples([("empty.jpg", (100, 80), [])])
    install(ShapeFake({}))

    summary, _ = evaluate.run(1)

    assert summary["detection_accuracy_pct"] is None
    assert summary["false_positive_pct"] == 0.0
    assert summary["avg_confidence"] is None


class DbSpyFake(ShapeFake):
    """Records config.DB_PATH at each detect call."""

    def __init__(self):
        super().__init__({})
        self.db_paths = []

    def detect(self, image):
        self.db_paths.append(config.DB_PATH)
        return super().detect(image)


def _real_db_snapshot():
    if not REAL_DB.exists():
        return None
    stat = REAL_DB.stat()
    return (stat.st_size, stat.st_mtime_ns)


def test_run_uses_temp_db_never_real_history(samples, monkeypatch):
    """M5-run-10"""
    before = _real_db_snapshot()
    samples([("a.jpg", (100, 80), []), ("b.jpg", (120, 80), [])])
    fake = install(DbSpyFake())
    saves = []  # (db_path, records in that DB right after the save)
    original_save = SQLiteStorage.save

    def spy_save(self, record):
        saved = original_save(self, record)
        saves.append((self.db_path, len(self.list())))
        return saved

    monkeypatch.setattr(SQLiteStorage, "save", spy_save)

    evaluate.run(2)

    assert _real_db_snapshot() == before
    used = set(fake.db_paths)
    assert len(used) == 1
    (temp_db,) = used
    assert Path(temp_db) != REAL_DB
    assert temp_db != str(REAL_DB)
    assert [path for path, _ in saves] == [temp_db] * 4
    assert saves[-1][1] == 4


def test_run_temp_db_dir_removed_after_run(samples):
    """M5-run-10 [OQ-9: run() uses a self-cleaning temporary directory for its DB]"""
    samples([("a.jpg", (100, 80), [])])
    fake = install(DbSpyFake())

    evaluate.run(1)

    (temp_db,) = set(fake.db_paths)
    assert not Path(temp_db).parent.exists(), f"temp DB dir left behind: {Path(temp_db).parent}"


class StubDetector:
    """Replaces PersonDetector: records constructor args, finds nobody."""

    built = []

    def __init__(self, model_path, confidence_threshold):
        StubDetector.built.append((model_path, confidence_threshold))

    def detect(self, image):
        return [], 1.0

    def annotate(self, image, detections):
        return image.copy()


def test_run_threshold_and_model_overrides(samples, monkeypatch):
    """M5-run-11"""
    samples([("a.jpg", (100, 80), [])])
    monkeypatch.setattr(detector_module, "PersonDetector", StubDetector)
    StubDetector.built = []
    get_detector.cache_clear()
    try:
        summary, _ = evaluate.run(1, threshold=0.35, model="m.pt")
    finally:
        get_detector.cache_clear()

    assert StubDetector.built == [("m.pt", 0.35)]
    assert summary["model"] == "m.pt"
    assert summary["confidence_threshold"] == 0.35


def test_cli_writes_json_and_prints_markdown(samples, monkeypatch, capsys):
    """M5-cli-01"""
    root = samples([("a.jpg", (100, 200), [[0, 0, 50, 100]])])
    install(ShapeFake({(200, 100): [det([0, 0, 50, 100], 0.9)]}))
    monkeypatch.setattr(sys, "argv", ["evaluate", "--runs", "1", "--out", "x.json"])

    evaluate.main()

    out = json.loads((root / "x.json").read_text())
    assert set(out) == {"summary", "images"}
    assert out["images"][0]["file"] == "a.jpg"
    stdout = capsys.readouterr().out
    assert "| Image | Scenario |" in stdout
    assert "- Reliability: 100% (1 images)" in stdout
    assert not (root / "results.json").exists()


# --- markdown() ------------------------------------------------------------------


MD_SUMMARY = {
    "images": 2, "runs_per_image": 1, "visible_persons": 3, "correct_detections": 2,
    "missed": 1, "false_positives": 1, "detection_accuracy_pct": 66.6666,
    "false_positive_pct": 33.3333, "avg_inference_ms": 151.6, "avg_round_trip_ms": 170.4,
    "avg_confidence": 0.85, "reliability_pct": 50.0, "confidence_threshold": 0.5,
    "model": "yolov8s.pt",
}
MD_RESULTS = [
    {"file": "a.jpg", "scenario": "group", "description": "d", "status": 200, "visible": 3,
     "detected": 3, "correct": 2, "missed": 1, "false_positives": 1, "ignored_small": 0,
     "correct_confidences": [0.8, 0.9], "inference_ms": 151.6, "round_trip_ms": 170.4},
    {"file": "f.jpg", "scenario": "s", "description": "d", "status": 500},
]


def test_markdown_rows_and_metric_lines():
    """M5-md-01"""
    text = markdown(MD_SUMMARY, MD_RESULTS)
    lines = text.splitlines()

    assert "| f.jpg | s | — | HTTP 500 | — | — | — | — |" in lines
    assert "| a.jpg | group | 3 | 3 | 2 | 1 | 1 | 152 ms |" in lines
    assert "- Detection accuracy: 2/3 = 66.7%" in lines
    assert "- False positives: 1 of 3 detections = 33.3%" in lines
    assert "- Average inference time: 152 ms (round trip 170 ms)" in lines
    assert "- Average confidence (correct detections): 0.850" in lines
    assert "- Reliability: 50% (2 images)" in lines


@pytest.mark.parametrize("case", ["no visible persons", "every image failed"])
def test_markdown_handles_missing_metrics(case):
    """M5-md-02 [OQ-8: a None metric prints "n/a"]"""
    if case == "no visible persons":
        summary = {**MD_SUMMARY, "images": 1, "visible_persons": 0, "correct_detections": 0,
                   "missed": 0, "false_positives": 0, "detection_accuracy_pct": None,
                   "false_positive_pct": 0.0, "avg_confidence": None, "reliability_pct": 100.0}
        results = [{"file": "e.jpg", "scenario": "negative", "description": "d", "status": 200,
                    "visible": 0, "detected": 0, "correct": 0, "missed": 0,
                    "false_positives": 0, "ignored_small": 0, "correct_confidences": [],
                    "inference_ms": 10.0, "round_trip_ms": 12.0}]
    else:
        summary = {**MD_SUMMARY, "images": 1, "visible_persons": 0, "correct_detections": 0,
                   "missed": 0, "false_positives": 0, "detection_accuracy_pct": None,
                   "false_positive_pct": 0.0, "avg_inference_ms": None,
                   "avg_round_trip_ms": None, "avg_confidence": None, "reliability_pct": 0.0}
        results = [{"file": "f.jpg", "scenario": "s", "description": "d", "status": 500}]

    text = markdown(summary, results)

    assert isinstance(text, str)
    assert "n/a" in text
    assert "None" not in text


# --- manual review (OQ-6) ---------------------------------------------------------


REVIEW_IMAGES = [
    # a.jpg: 1 miss + 2 false positives (one box too loose: IoU 0.45, one stray box).
    ("a.jpg", (300, 300), [[0, 0, 100, 200]]),
    # b.jpg: 1 correct.
    ("b.jpg", (320, 300), [[0, 0, 100, 200]]),
    # c.jpg: no people, 1 false positive (no miss).
    ("c.jpg", (340, 300), []),
]
REVIEW_FAKE = {
    (300, 300): [det([0, 0, 100, 90], 0.8), det([200, 200, 250, 280], 0.6)],
    (300, 320): [det([0, 0, 100, 200], 0.9)],
    (300, 340): [det([10, 10, 60, 90], 0.7)],
}


def review(file):
    return {"file": file, "decision": "count_as_correct", "reason": "box shape differs"}


def test_manual_review_reclassifies_one_fp_and_one_miss(samples):
    """M5-review-01 [OQ-6]: arithmetic"""
    samples(REVIEW_IMAGES, manual_review=[review("a.jpg")])
    install(ShapeFake(REVIEW_FAKE))

    summary, _ = evaluate.run(1)

    # Automatic numbers are unchanged: 2 visible, 1 correct, 3 false positives of 4 scored.
    assert counts(summary, "visible_persons", "correct_detections", "false_positives") == {
        "visible_persons": 2, "correct_detections": 1, "false_positives": 3,
    }
    manual = summary["manual_review"]
    assert manual["correct"] == 2
    assert manual["false_positives"] == 2
    assert manual["detection_accuracy_pct"] == pytest.approx(100.0)
    assert manual["false_positive_pct"] == pytest.approx(50.0)
    assert manual["applied"] == ["a.jpg"]


@pytest.mark.parametrize("file", ["b.jpg", "c.jpg"], ids=["no false positive", "no miss"])
def test_manual_review_invalid_entry_raises(samples, file):
    """M5-review-01 [OQ-6]: an entry needs >= 1 false positive and >= 1 miss"""
    samples(REVIEW_IMAGES, manual_review=[review(file)])
    install(ShapeFake(REVIEW_FAKE))

    with pytest.raises(ValueError):
        evaluate.run(1)


def test_manual_review_no_entries_equals_automatic(samples):
    """M5-review-01 [OQ-6]: no entries"""
    samples(REVIEW_IMAGES, manual_review=[])
    install(ShapeFake(REVIEW_FAKE))

    summary, _ = evaluate.run(1)

    manual = summary["manual_review"]
    assert manual["correct"] == summary["correct_detections"]
    assert manual["false_positives"] == summary["false_positives"]
    assert manual["detection_accuracy_pct"] == pytest.approx(summary["detection_accuracy_pct"])
    assert manual["false_positive_pct"] == pytest.approx(summary["false_positive_pct"])
    assert manual["applied"] == []


def test_manual_review_real_data():
    """M5-review-01 [OQ-6]: ground_truth.json lists coco-96493; results.json holds 60/69, 5/65"""
    samples_dir = Path(config.PROJECT_ROOT) / "backend" / "samples"
    truth = json.loads((samples_dir / "ground_truth.json").read_text())
    summary = json.loads((samples_dir / "results.json").read_text())["summary"]

    entries = truth["manual_review"]
    assert [e["file"] for e in entries] == ["coco-96493.jpg"]
    assert entries[0]["decision"] == "count_as_correct"
    assert isinstance(entries[0]["reason"], str) and entries[0]["reason"].strip()

    manual = summary["manual_review"]
    assert manual["correct"] == 60
    assert manual["false_positives"] == 5
    assert summary["visible_persons"] == 69
    assert manual["detection_accuracy_pct"] == pytest.approx(100 * 60 / 69)
    assert manual["false_positive_pct"] == pytest.approx(100 * 5 / 65)
    assert manual["applied"] == ["coco-96493.jpg"]
