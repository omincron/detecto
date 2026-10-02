"""M5 evaluation/demo sample set: files, ground_truth.json, index.json, CREDITS.md."""

import hashlib
import json
import re
from collections import Counter
from pathlib import Path

import pytest
from PIL import Image

from backend import config

ROOT = Path(config.PROJECT_ROOT)
BACKEND_SAMPLES = ROOT / "backend" / "samples"
FRONTEND_SAMPLES = ROOT / "frontend" / "public" / "samples"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}

TRUTH = json.loads((BACKEND_SAMPLES / "ground_truth.json").read_text())
INDEX = json.loads((FRONTEND_SAMPLES / "index.json").read_text())
GT_FILES = [entry["file"] for entry in TRUTH["images"]]

LICENCES = {
    "http://creativecommons.org/licenses/by/2.0/": ("Attribution License", "CC BY 2.0"),
    "http://creativecommons.org/licenses/by-sa/2.0/": ("Attribution-ShareAlike License", "CC BY-SA 2.0"),
}
EXIF_ORIENTATION = 0x0112


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def image_files(folder):
    return {p.name for p in folder.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES}


def test_sets_have_at_least_ten_images():
    """M5-set-01"""
    assert len(TRUTH["images"]) >= 10
    assert len(INDEX) >= 10


def test_every_gt_file_in_both_folders_and_identical():
    """M5-set-02"""
    assert len(set(GT_FILES)) == len(GT_FILES)
    for file in GT_FILES:
        backend_copy, frontend_copy = BACKEND_SAMPLES / file, FRONTEND_SAMPLES / file
        assert backend_copy.is_file(), backend_copy
        assert frontend_copy.is_file(), frontend_copy
        assert sha256(backend_copy) == sha256(frontend_copy), file


def test_index_and_folders_match_ground_truth():
    """M5-set-03"""
    index_files = [entry["file"] for entry in INDEX]
    assert len(set(index_files)) == len(index_files)
    assert set(index_files) == set(GT_FILES)
    for entry in INDEX:
        assert isinstance(entry.get("label"), str) and entry["label"].strip(), entry

    assert image_files(FRONTEND_SAMPLES) == set(GT_FILES)
    assert "bus.jpg" not in image_files(FRONTEND_SAMPLES)
    assert "zidane.jpg" not in image_files(FRONTEND_SAMPLES)
    assert image_files(BACKEND_SAMPLES) == set(GT_FILES)


@pytest.mark.parametrize("entry", TRUTH["images"], ids=GT_FILES)
def test_gt_entry_consistent_with_image(entry):
    """M5-set-04"""
    with Image.open(BACKEND_SAMPLES / entry["file"]) as img:
        assert img.size == (entry["width"], entry["height"])
        assert img.getexif().get(EXIF_ORIENTATION, 1) == 1

    assert entry["file"] == f"coco-{entry['coco_id']}.jpg"
    for x, y, w, h in entry["persons_xywh"]:
        assert w > 0 and h > 0
        assert x >= -0.5 and y >= -0.5
        assert x + w <= entry["width"] + 0.5
        assert y + h <= entry["height"] + 0.5
    min_h = TRUTH["min_visible_height_px"]
    assert entry["visible_persons"] == sum(h >= min_h for *_, h in entry["persons_xywh"])
    assert isinstance(entry["scenario"], str) and entry["scenario"].strip()
    assert isinstance(entry["description"], str) and entry["description"].strip()


def test_set_totals_match_docs():
    """M5-set-05"""
    images = TRUTH["images"]
    assert sum(e["visible_persons"] for e in images) == 69
    assert sum(1 for e in images if e["persons_xywh"] == []) == 3
    assert {e["scenario"] for e in images} >= {
        "single", "small-group", "group", "crowd", "occlusion", "distant", "low-light", "negative",
    }
    assert TRUTH["match_iou"] == 0.5
    assert TRUTH["min_visible_height_px"] == 20


@pytest.mark.parametrize("entry", TRUTH["images"], ids=GT_FILES)
def test_images_are_cc_by_or_by_sa(entry):
    """M5-set-06"""
    assert entry["license_url"] in LICENCES
    assert entry["license"] == LICENCES[entry["license_url"]][0]
    assert entry["flickr_url"].startswith("http")


CREDIT_ROW = re.compile(
    r"^\| (?P<file>[^|]+?) \| (?P<id>\d+) \| \[(?P<text>[^\]]+)\]\((?P<licence>[^)]+)\) "
    r"\| \[Flickr\]\((?P<flickr>[^)]+)\) \|$"
)


def test_credits_files_identical_and_complete():
    """M5-set-07"""
    backend_credits = BACKEND_SAMPLES / "CREDITS.md"
    frontend_credits = FRONTEND_SAMPLES / "CREDITS.md"
    assert backend_credits.read_bytes() == frontend_credits.read_bytes()

    rows = [m for line in frontend_credits.read_text().splitlines() if (m := CREDIT_ROW.match(line))]
    files = [m["file"] for m in rows]
    assert Counter(files) == Counter(GT_FILES)
    assert len(rows) == len(TRUTH["images"])

    by_file = {e["file"]: e for e in TRUTH["images"]}
    for row in rows:
        entry = by_file[row["file"]]
        assert int(row["id"]) == entry["coco_id"], row["file"]
        assert row["licence"] == entry["license_url"], row["file"]
        assert row["flickr"] == entry["flickr_url"], row["file"]
        assert row["text"] == LICENCES[row["licence"]][1], row["file"]
