"""README.md claims match the data (results.json, compare-*.json, ground truth, config)."""

import importlib
import json
import re
from pathlib import Path

import dotenv
import pytest

from backend import config

ROOT = Path(config.PROJECT_ROOT)
SAMPLES = ROOT / "backend" / "samples"
README = (ROOT / "README.md").read_text()
RESULTS = json.loads((SAMPLES / "results.json").read_text())
SUMMARY = RESULTS["summary"]
IMAGES = RESULTS["images"]
TRUTH = json.loads((SAMPLES / "ground_truth.json").read_text())
INDEX = json.loads((ROOT / "frontend" / "public" / "samples" / "index.json").read_text())
FLAT = re.sub(r"\s+", " ", README.replace("**", ""))  # prose with bold and wrapping removed


def section(heading):
    """Text from a heading line (exact) up to the next heading of the same or higher level."""
    level = len(heading) - len(heading.lstrip("#"))
    lines = README.splitlines()
    start = lines.index(heading)
    end = len(lines)
    for i in range(start + 1, len(lines)):
        match = re.match(r"^(#+) ", lines[i])
        if match and len(match.group(1)) <= level:
            end = i
            break
    return "\n".join(lines[start + 1:end])


def table_rows(text, header):
    """Cells of each body row of the Markdown table whose header line is `header`."""
    lines = text.splitlines()
    start = lines.index(header)
    rows = []
    for line in lines[start + 2:]:
        if not line.startswith("|"):
            break
        rows.append([cell.strip() for cell in line.strip().strip("|").split("|")])
    return rows


def results_heading():
    (heading,) = [line for line in README.splitlines() if line.startswith("### Results")]
    return heading


def metric_rows():
    header = "| Metric | Description | Target | Automatic (IoU ≥ 0.5) | After manual review |"
    return {row[0].strip("*"): row for row in table_rows(section(results_heading()), header)}


def test_results_table_automatic_column_matches_results_json():
    """M5-readme-01"""
    rows = metric_rows()
    s = SUMMARY

    auto = rows["Detection accuracy"][3]
    assert auto == (
        f"**{s['detection_accuracy_pct']:.1f} %** ({s['correct_detections']}/{s['visible_persons']})"
    )
    auto = rows["False positives"][3]
    scored = s["correct_detections"] + s["false_positives"]
    assert auto == f"**{s['false_positive_pct']:.1f} %** ({s['false_positives']}/{scored})"
    auto = rows["Average inference time"][3]
    assert auto == (
        f"**{round(s['avg_inference_ms'])} ms** ({round(s['avg_round_trip_ms'])} ms round trip)"
    )
    assert rows["Average confidence"][3] == f"**{s['avg_confidence']:.3f}**"
    ok = sum(1 for r in IMAGES if r["status"] == 200)
    assert rows["System reliability"][3] == f"**{s['reliability_pct']:g} %** ({ok}/{s['images']})"


def test_results_heading_names_current_model_and_threshold():
    """M5-readme-02"""
    env = dotenv.dotenv_values(ROOT / ".env")
    assert SUMMARY["model"] == "yolov8s.pt"
    assert SUMMARY["confidence_threshold"] == 0.5
    assert SUMMARY["images"] == len(TRUTH["images"])
    assert SUMMARY["runs_per_image"] == 3
    assert "3 runs per" in FLAT

    heading = results_heading()
    assert "YOLOv8s" in heading
    assert "0.5" in heading
    assert SUMMARY["model"] == env["MODEL_PATH"]
    assert SUMMARY["confidence_threshold"] == float(env["CONFIDENCE_THRESHOLD"])


PER_IMAGE_HEADER = (
    "| Image | Scenario | Visible | Detected | Correct | Missed | False pos. | Model time |"
)


def per_image_rows():
    rows = table_rows(README, PER_IMAGE_HEADER)
    return [[cell.replace("†", "").replace("‡", "").strip() for cell in row] for row in rows]


def test_per_image_table_matches_results_json():
    """M5-readme-03"""
    rows = per_image_rows()

    assert [row[0] for row in rows] == [r["file"] for r in IMAGES]
    for row, r in zip(rows, IMAGES):
        _, _, visible, detected, correct, missed, false_pos, model_time = row
        assert [int(visible), int(detected), int(correct), int(missed), int(false_pos)] == [
            r["visible"], r["detected"], r["correct"], r["missed"], r["false_positives"],
        ], r["file"]
        assert model_time == f"{round(r['inference_ms'])} ms", r["file"]
    for r in IMAGES:
        assert r["status"] == 200, r["file"]
        assert r["detected"] == r["correct"] + r["false_positives"] + r["ignored_small"], r["file"]


MANUAL = re.compile(r"\*\*([\d.]+) %\*\* \((\d+)/(\d+)\)")


def manual_cells():
    rows = metric_rows()
    accuracy = MANUAL.fullmatch(rows["Detection accuracy"][4])
    false_pos = MANUAL.fullmatch(rows["False positives"][4])
    assert accuracy and false_pos, (rows["Detection accuracy"][4], rows["False positives"][4])
    return accuracy, false_pos


def test_manual_review_column_is_consistent():
    """M5-readme-04"""
    accuracy, false_pos = manual_cells()
    pct, num, den = float(accuracy[1]), int(accuracy[2]), int(accuracy[3])
    assert (pct, num, den) == (87.0, 60, 69)
    assert f"{100 * num / den:.1f}" == accuracy[1]
    assert den == SUMMARY["visible_persons"]

    fp_pct, fp_num, fp_den = float(false_pos[1]), int(false_pos[2]), int(false_pos[3])
    assert (fp_pct, fp_num, fp_den) == (7.7, 5, 65)
    assert f"{100 * fp_num / fp_den:.1f}" == false_pos[1]
    assert fp_den == SUMMARY["correct_detections"] + SUMMARY["false_positives"]

    daggers = sum(1 for line in README.splitlines() if line.startswith("|") and "†" in line)
    assert num - SUMMARY["correct_detections"] == SUMMARY["false_positives"] - fp_num == daggers == 1


def test_manual_review_column_matches_results_json():
    """M5-readme-04 [OQ-6]: the README's manual-review numbers equal summary.manual_review"""
    accuracy, false_pos = manual_cells()
    manual = SUMMARY["manual_review"]

    assert int(accuracy[2]) == manual["correct"]
    assert accuracy[1] == f"{manual['detection_accuracy_pct']:.1f}"
    assert int(false_pos[2]) == manual["false_positives"]
    assert false_pos[1] == f"{manual['false_positive_pct']:.1f}"


COMPARE_HEADER = "| Model @ threshold | Accuracy | False positives | Avg confidence | Model time |"


def comparison_rows():
    rows = table_rows(section("### Model and threshold comparison"), COMPARE_HEADER)
    return {row[0].replace("**", ""): [c.replace("**", "") for c in row[1:]] for row in rows}


def expected_cells(summary):
    return [
        f"{summary['detection_accuracy_pct']:.1f} %",
        f"{summary['false_positive_pct']:.1f} %",
        f"{summary['avg_confidence']:.3f}",
        f"{round(summary['avg_inference_ms'])} ms",
    ]


def compare_file(model, threshold):
    return json.loads((SAMPLES / f"compare-{model}-{threshold}.json").read_text())["summary"]


@pytest.mark.parametrize("label, model, threshold", [
    ("YOLOv8n @ 0.35", "yolov8n.pt", 0.35),
    ("YOLOv8n @ 0.25", "yolov8n.pt", 0.25),
    ("YOLOv8s @ 0.35", "yolov8s.pt", 0.35),
    ("YOLOv8n @ 0.50 (original)", "yolov8n.pt", 0.5),  # [OQ-5] re-run file
])
def test_comparison_row_matches_its_file(label, model, threshold):
    """M5-readme-05 [OQ-5 for the v8n @ 0.50 row]"""
    rows = comparison_rows()
    summary = compare_file(model, threshold)

    assert summary["model"] == model
    assert summary["confidence_threshold"] == threshold
    assert rows[label] == expected_cells(summary)


def test_comparison_current_row_matches_results_json():
    """M5-readme-05 (current row quotes results.json)"""
    rows = comparison_rows()

    assert rows["YOLOv8s @ 0.50 (current)"] == expected_cells(SUMMARY)


def test_narrative_numbers_match_data():
    """M5-readme-06"""
    by_file = {r["file"]: r for r in IMAGES}

    assert "pick one of 16 sample images" in FLAT
    assert len(INDEX) == 16
    assert "69 visible people" in FLAT
    assert sum(r["visible"] for r in IMAGES) == 69
    assert "three images with no people" in FLAT
    assert sum(1 for e in TRUTH["images"] if e["persons_xywh"] == []) == 3

    assert "5 of 13 people missed" in FLAT
    assert (by_file["coco-441543.jpg"]["missed"], by_file["coco-441543.jpg"]["visible"]) == (5, 13)
    assert "8 of 9" in FLAT
    assert (by_file["coco-352684.jpg"]["correct"], by_file["coco-352684.jpg"]["visible"]) == (8, 9)
    assert "distant people (5/5)" in FLAT
    assert (by_file["coco-392722.jpg"]["correct"], by_file["coco-392722.jpg"]["visible"]) == (5, 5)
    assert "the beach group (all 13)" in FLAT
    assert (by_file["coco-274460.jpg"]["correct"], by_file["coco-274460.jpg"]["visible"]) == (13, 13)
    assert "one person missed in each" in FLAT
    for file in ("coco-23899.jpg", "coco-389109.jpg", "coco-538364.jpg"):
        assert by_file[file]["missed"] == 1, file
    assert "all 3 people found, plus one extra" in FLAT
    assert (by_file["coco-532690.jpg"]["correct"], by_file["coco-532690.jpg"]["false_positives"]) == (3, 1)
    assert "kitchen negative (0 detections)" in FLAT
    assert by_file["coco-34873.jpg"]["detected"] == 0


MAGIC = {".jpg": b"\xff\xd8\xff", ".jpeg": b"\xff\xd8\xff", ".png": b"\x89PNG\r\n\x1a\n"}


def test_image_links_resolve_and_two_or_three_screenshots():
    """M5-readme-07"""
    targets = re.findall(r"!\[[^\]]*\]\(([^)\s]+)\)", README)
    assert targets
    for target in targets:
        path = ROOT / target
        assert path.is_file(), target
        suffix = path.suffix.lower()
        assert suffix in MAGIC, target
        assert path.read_bytes().startswith(MAGIC[suffix]), target

    screenshots = {t for t in targets if t.startswith("docs/screenshots/")}
    assert 2 <= len(screenshots) <= 3
    on_disk = {f"docs/screenshots/{p.name}" for p in (ROOT / "docs" / "screenshots").iterdir()}
    assert on_disk <= screenshots


def github_slug(heading):
    slug = heading.strip().lower()
    slug = re.sub(r"[^\w\- ]", "", slug)
    return slug.replace(" ", "-")


def test_relative_links_and_contents_anchors_resolve():
    """M5-readme-08"""
    links = re.findall(r"(?<!!)\[[^\]]*\]\(([^)\s]+)\)", README)
    relative = [t for t in links if not re.match(r"https?://", t) and not t.startswith("#")]
    assert relative
    for target in relative:
        assert (ROOT / target.split("#")[0]).exists(), target
    for expected in ("ARCHITECTURE.md", "PROGRESS.md", "test-plans/", "frontend/public/samples/CREDITS.md"):
        assert expected in relative

    h2_slugs = {github_slug(m) for m in re.findall(r"^## (.+)$", README, re.M)}
    anchors = re.findall(r"\]\(#([^)]+)\)", section("## Contents"))
    assert anchors
    for anchor in anchors:
        assert anchor in h2_slugs, anchor


def test_required_sections_present():
    """M5-readme-09"""
    headings = {m.strip() for m in re.findall(r"^#+ (.+)$", README, re.M)}
    for name in (
        "Architecture", "Setup and run", "Backend", "Frontend", "Tests",
        "Evaluation: methodology and results", "Test cases and failures",
        "What worked, what could be improved",
    ):
        assert name in headings, name

    rows = metric_rows()
    for metric in ("Detection accuracy", "False positives", "Average inference time",
                   "Average confidence", "System reliability"):
        assert metric in rows, metric
    targets = [row[2] for row in rows.values()]
    for target in ("≥ 85 %", "≤ 10 %", "≤ 1.5 s", "≥ 0.7", "100 %"):
        assert target in targets, target


def settings_defaults():
    header = "| Variable | Default | Meaning |"
    return {row[0].strip("`"): row[1].strip("`") for row in table_rows(README, header)}


def test_settings_table_matches_config_defaults(env):
    """M5-readme-10"""
    env.setattr(dotenv, "load_dotenv", lambda *a, **k: False)
    for name in ("MODEL_PATH", "CONFIDENCE_THRESHOLD", "MAX_UPLOAD_BYTES", "WARMUP_MODEL",
                 "CORS_ORIGINS", "DB_PATH"):
        env.delenv(name, raising=False)
    importlib.reload(config)
    defaults = settings_defaults()

    assert defaults["MODEL_PATH"] == config.MODEL_PATH
    assert defaults["CONFIDENCE_THRESHOLD"] == str(config.CONFIDENCE_THRESHOLD)
    assert int(defaults["MAX_UPLOAD_BYTES"]) == config.MAX_UPLOAD_BYTES
    assert defaults["WARMUP_MODEL"] == "true"
    assert config.WARMUP_MODEL is True
    assert defaults["CORS_ORIGINS"] == config.CORS_ORIGINS[0]
    assert (ROOT / defaults["DB_PATH"]).resolve() == Path(config.DB_PATH).resolve()
