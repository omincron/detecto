import { describe, expect, it } from "vitest";
import { bboxToPercentRect, formatMs, formatPercent } from "./bbox.js";

const expectRect = (rect, expected) => {
  for (const key of ["left", "top", "width", "height"]) {
    expect(rect[key]).toBeCloseTo(expected[key], 6);
  }
};

describe("bboxToPercentRect", () => {
  it("M3-bbox-01: converts frame pixels to percent of the frame", () => {
    expect(bboxToPercentRect([128, 72, 640, 360], 1280, 720)).toEqual({
      left: 10,
      top: 10,
      width: 40,
      height: 40,
    });
    expect(bboxToPercentRect([0, 0, 1280, 720], 1280, 720)).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
  });

  it("M3-bbox-02: is relative to the processed frame passed in, not the upload", () => {
    // Correct call: the backend's processed frame (4000x3000 upload → 1280x960).
    expect(bboxToPercentRect([320, 240, 960, 720], 1280, 960)).toEqual({
      left: 25,
      top: 25,
      width: 50,
      height: 50,
    });
    // Same bbox against the original upload size gives a different (wrong) rect.
    expectRect(bboxToPercentRect([320, 240, 960, 720], 4000, 3000), {
      left: 8,
      top: 8,
      width: 16,
      height: 16,
    });
  });

  it("M3-bbox-03: keeps fractional coordinates without rounding", () => {
    expectRect(bboxToPercentRect([10.5, 20.2, 110.5, 220.2], 200, 400), {
      left: 5.25,
      top: 5.05,
      width: 50,
      height: 50,
    });
  });

  it("M3-bbox-04: clamps boxes that spill over the frame edges", () => {
    const full = bboxToPercentRect([-10, -5, 1300, 730], 1280, 720);
    expect(full).toEqual({ left: 0, top: 0, width: 100, height: 100 });

    const corner = bboxToPercentRect([1200, 700, 1300, 760], 1280, 720);
    expect(corner.left).toBeCloseTo(93.75, 6);
    expect(corner.width).toBeCloseTo(6.25, 6);
    expect(corner.top).toBeCloseTo(97.2222, 3);
    expect(corner.height).toBeCloseTo(2.7778, 3);

    for (const rect of [full, corner]) {
      for (const value of Object.values(rect)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
      expect(rect.left + rect.width).toBeLessThanOrEqual(100 + 1e-9);
      expect(rect.top + rect.height).toBeLessThanOrEqual(100 + 1e-9);
    }
  });

  it("M3-bbox-05: swapped corners give the ordered rectangle", () => {
    expect(bboxToPercentRect([640, 360, 128, 72], 1280, 720)).toEqual({
      left: 10,
      top: 10,
      width: 40,
      height: 40,
    });
  });

  it("M3-bbox-06: degenerate boxes are finite with zero size", () => {
    const point = bboxToPercentRect([100, 100, 100, 100], 200, 200);
    const outside = bboxToPercentRect([1300, 800, 1400, 900], 1280, 720);

    expect(point).toEqual({ left: 50, top: 50, width: 0, height: 0 });
    expect(outside).toEqual({ left: 100, top: 100, width: 0, height: 0 });
    for (const value of [...Object.values(point), ...Object.values(outside)]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("M3-bbox-07: handles extreme aspect-ratio frames", () => {
    expect(bboxToPercentRect([0, 0, 640, 1], 1280, 1)).toEqual({
      left: 0,
      top: 0,
      width: 50,
      height: 100,
    });
  });
});

describe("formatters", () => {
  it("M3-fmt-01: formatPercent renders a rounded whole percent", () => {
    expect(formatPercent(0.91)).toBe("91%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0.875)).toBe("88%");
    expect(formatPercent(0.504)).toBe("50%");
  });

  it("M3-fmt-02: formatMs uses ms below one second and seconds from one second up", () => {
    expect(formatMs(142.3)).toBe("142 ms");
    expect(formatMs(0)).toBe("0 ms");
    expect(formatMs(999.4)).toBe("999 ms");
    expect(formatMs(1000)).toBe("1.00 s");
    expect(formatMs(1534)).toBe("1.53 s");
  });

  it("M3-fmt-02 [OQ-4]: values that round to 1000 ms show as seconds", () => {
    expect(formatMs(999.6)).toBe("1.00 s");
  });
});
