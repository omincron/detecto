"""Milestone 5 evaluation: run the sample set through the real /detect pipeline and
score it against ground truth.

    backend/.venv/bin/python -m backend.scripts.evaluate [--runs 3] [--threshold 0.5]
        [--model yolov8s.pt] [--out results.json]

Uses the FastAPI app in-process (TestClient) with the real model (config.MODEL_PATH), a temporary
database (the real history is never touched) and startup warm-up, so timings exclude
model loading. Writes backend/samples/results.json and prints a Markdown summary.

Scoring (definitions from instructions.md "Testing & Validation"):
- A detection is *correct* if it overlaps a ground-truth person with IoU >= 0.5
  (greedy, highest-confidence detection first; each person matched at most once).
- Detections matching a person too small to be "visible" (see ground_truth.json) are
  ignored: neither correct nor false positives.
- Detection accuracy = correct / visible persons.
- False positives = unmatched detections / all scored detections.
- Average confidence = mean confidence of the correct detections.
- Average inference time = mean model time (inference_time_ms) over all runs.
- Reliability = images answered with HTTP 200 / images sent.
"""

import argparse
import json
import statistics
import tempfile
import time
from pathlib import Path

from fastapi.testclient import TestClient

from backend import config

SAMPLES = Path(__file__).resolve().parent.parent / "samples"


def iou(a, b):
    """IoU of two [x1, y1, x2, y2] boxes."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def score_image(detections, gt_xywh, min_visible_height, match_iou):
    """Greedy IoU matching. Returns per-image counts and the correct confidences."""
    gt = [[x, y, x + w, y + h] for x, y, w, h in gt_xywh]
    visible = [h >= min_visible_height for _, _, _, h in gt_xywh]
    taken = [False] * len(gt)
    correct, false_pos, ignored, confidences = 0, 0, 0, []
    for det in sorted(detections, key=lambda d: d["confidence"], reverse=True):
        best, best_iou = None, match_iou
        for j, box in enumerate(gt):
            if not taken[j]:
                overlap = iou(det["bbox"], box)
                if overlap >= best_iou:
                    best, best_iou = j, overlap
        if best is None:
            false_pos += 1
        else:
            taken[best] = True
            if visible[best]:
                correct += 1
                confidences.append(det["confidence"])
            else:
                ignored += 1
    return {
        "visible": sum(visible),
        "correct": correct,
        "missed": sum(v and not t for v, t in zip(visible, taken)),
        "false_positives": false_pos,
        "ignored_small": ignored,
        "correct_confidences": confidences,
    }


def run(runs, threshold=None, model=None):
    truth = json.loads((SAMPLES / "ground_truth.json").read_text())
    with tempfile.TemporaryDirectory() as tmp_dir:  # removed when the run ends
        config.DB_PATH = str(Path(tmp_dir) / "eval.db")  # never write to the real history
        results = _run_images(truth, runs, threshold, model)
    summary = _summarize(truth, runs, results)
    return summary, results


def _run_images(truth, runs, threshold, model):
    config.WARMUP_MODEL = True
    # Overrides for comparison runs; set before the detector is first built.
    if threshold is not None:
        config.CONFIDENCE_THRESHOLD = threshold
    if model is not None:
        config.MODEL_PATH = model

    from backend.main import app  # imported after config is pointed at the temp DB

    results = []
    with TestClient(app, raise_server_exceptions=False) as client:
        for item in truth["images"]:
            data = (SAMPLES / item["file"]).read_bytes()
            times, round_trips, body, status = [], [], None, None
            for _ in range(runs):
                started = time.perf_counter()
                response = client.post("/detect", files={"image": (item["file"], data, "image/jpeg")})
                round_trips.append((time.perf_counter() - started) * 1000)
                status = response.status_code
                if status != 200:
                    break
                body = response.json()
                times.append(body["inference_time_ms"])
            entry = {k: item[k] for k in ("file", "scenario", "description")}
            entry["status"] = status
            if status == 200:
                # Boxes come back in the processed frame; scale to the original image.
                sx = item["width"] / body["image_width"]
                sy = item["height"] / body["image_height"]
                dets = [
                    {"bbox": [d["bbox"][0] * sx, d["bbox"][1] * sy, d["bbox"][2] * sx, d["bbox"][3] * sy],
                     "confidence": d["confidence"]}
                    for d in body["detections"]
                ]
                entry.update(score_image(dets, item["persons_xywh"], truth["min_visible_height_px"], truth["match_iou"]))
                entry.update(detected=body["count"], inference_ms=statistics.mean(times),
                             round_trip_ms=statistics.mean(round_trips))
            results.append(entry)
    return results


def _pct(part, whole):
    return 100 * part / whole if whole else None


def _manual_review(truth, results, correct, false_pos, visible):
    """Apply the human review calls in ground_truth.json["manual_review"]. Each
    "count_as_correct" entry turns one false positive + one miss on that image into one
    correct detection (an IoU artefact a human judges correct)."""
    applied = []
    by_file = {r["file"]: r for r in results}
    for entry in truth.get("manual_review", []):
        if entry.get("decision") != "count_as_correct":
            raise ValueError(f"unknown manual_review decision: {entry.get('decision')!r}")
        r = by_file.get(entry["file"])
        if r is None or r.get("status") != 200 or r["false_positives"] < 1 or r["missed"] < 1:
            raise ValueError(
                f"manual_review entry for {entry['file']} needs a scored image with at least "
                "one false positive and one miss"
            )
        correct += 1
        false_pos -= 1
        applied.append(entry["file"])
    scored_after = correct + false_pos
    return {
        "correct": correct,
        "false_positives": false_pos,
        "detection_accuracy_pct": _pct(correct, visible),
        "false_positive_pct": _pct(false_pos, scored_after) if scored_after else 0.0,
        "applied": applied,
    }


def _summarize(truth, runs, results):
    ok = [r for r in results if r["status"] == 200]
    visible = sum(r["visible"] for r in ok)
    correct = sum(r["correct"] for r in ok)
    scored = sum(r["correct"] + r["false_positives"] for r in ok)
    false_pos = sum(r["false_positives"] for r in ok)
    confs = [c for r in ok for c in r["correct_confidences"]]
    summary = {
        "images": len(results),
        "runs_per_image": runs,
        "visible_persons": visible,
        "correct_detections": correct,
        "missed": sum(r["missed"] for r in ok),
        "false_positives": false_pos,
        "detection_accuracy_pct": 100 * correct / visible if visible else None,
        "false_positive_pct": 100 * false_pos / scored if scored else 0.0,
        "avg_inference_ms": statistics.mean(r["inference_ms"] for r in ok) if ok else None,
        "avg_round_trip_ms": statistics.mean(r["round_trip_ms"] for r in ok) if ok else None,
        "avg_confidence": statistics.mean(confs) if confs else None,
        "reliability_pct": 100 * len(ok) / len(results),
        "confidence_threshold": config.CONFIDENCE_THRESHOLD,
        "model": config.MODEL_PATH,
    }
    summary["manual_review"] = _manual_review(truth, results, correct, false_pos, visible)
    return summary


def markdown(summary, results):
    lines = [
        "| Image | Scenario | Visible | Detected | Correct | Missed | False pos. | Model time |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    for r in results:
        if r["status"] != 200:
            lines.append(f"| {r['file']} | {r['scenario']} | — | HTTP {r['status']} | — | — | — | — |")
            continue
        lines.append(
            f"| {r['file']} | {r['scenario']} | {r['visible']} | {r['detected']} | {r['correct']} | "
            f"{r['missed']} | {r['false_positives']} | {r['inference_ms']:.0f} ms |"
        )
    s = summary

    def fmt(value, spec, suffix=""):
        return "n/a" if value is None else f"{value:{spec}}{suffix}"

    lines += [
        "",
        f"- Detection accuracy: {s['correct_detections']}/{s['visible_persons']} = {fmt(s['detection_accuracy_pct'], '.1f', '%')}",
        f"- False positives: {s['false_positives']} of {s['correct_detections'] + s['false_positives']} detections = {fmt(s['false_positive_pct'], '.1f', '%')}",
        f"- Average inference time: {fmt(s['avg_inference_ms'], '.0f', ' ms')} (round trip {fmt(s['avg_round_trip_ms'], '.0f', ' ms')})",
        f"- Average confidence (correct detections): {fmt(s['avg_confidence'], '.3f')}",
        f"- Reliability: {s['reliability_pct']:.0f}% ({s['images']} images)",
    ]
    review = s.get("manual_review")
    if review and review["applied"]:
        lines.append(
            f"- After manual review ({', '.join(review['applied'])}): accuracy "
            f"{review['correct']}/{s['visible_persons']} = {fmt(review['detection_accuracy_pct'], '.1f', '%')}, "
            f"false positives {review['false_positives']} = {fmt(review['false_positive_pct'], '.1f', '%')}"
        )
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--runs", type=int, default=3, help="requests per image (timing is averaged)")
    parser.add_argument("--threshold", type=float, help="override CONFIDENCE_THRESHOLD")
    parser.add_argument("--model", help="override MODEL_PATH, e.g. yolov8s.pt")
    parser.add_argument("--out", default="results.json", help="file name under backend/samples/")
    args = parser.parse_args()
    summary, results = run(args.runs, args.threshold, args.model)
    (SAMPLES / args.out).write_text(json.dumps({"summary": summary, "images": results}, indent=2))
    print(markdown(summary, results))


if __name__ == "__main__":
    main()
