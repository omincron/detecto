import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BoundingBoxOverlay from "./BoundingBoxOverlay.jsx";
import { D2 } from "../test/helpers.js";

const THIRD = { bbox: [0, 0, 128, 72], confidence: 0.55 };

const styleOf = (box) => [box.style.left, box.style.top, box.style.width, box.style.height];

function renderOverlay(props = {}) {
  return render(
    <BoundingBoxOverlay
      src="blob:mock/1"
      alt="zidane.jpg"
      frameWidth={1280}
      frameHeight={720}
      detections={D2.detections}
      {...props}
    />,
  );
}

describe("BoundingBoxOverlay", () => {
  it("M3-overlay-01: renders the image and one box per detection, in order", () => {
    renderOverlay({ detections: [...D2.detections, THIRD] });

    expect(screen.getByRole("img", { name: "zidane.jpg" })).toHaveAttribute("src", "blob:mock/1");
    const boxes = screen.getAllByTestId("bounding-box");
    expect(boxes).toHaveLength(3);
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Person 1, 91% confidence",
      "Person 2, 62% confidence",
      "Person 3, 55% confidence",
    ]);
  });

  it("M3-overlay-02: box position and size come from the frame props", () => {
    const single = [{ bbox: [640, 360, 1280, 720], confidence: 0.9 }];
    const { rerender } = renderOverlay({ detections: single });
    expect(styleOf(screen.getByTestId("bounding-box"))).toEqual(["50%", "50%", "50%", "50%"]);

    rerender(
      <BoundingBoxOverlay
        src="blob:mock/1"
        alt="zidane.jpg"
        frameWidth={2560}
        frameHeight={1440}
        detections={single}
      />,
    );
    expect(styleOf(screen.getByTestId("bounding-box"))).toEqual(["25%", "25%", "25%", "25%"]);

    rerender(
      <BoundingBoxOverlay
        src="blob:mock/1"
        alt="zidane.jpg"
        frameWidth={1280}
        frameHeight={720}
        detections={D2.detections}
      />,
    );
    expect(styleOf(screen.getAllByTestId("bounding-box")[0])).toEqual([
      "10%",
      "10%",
      "40%",
      "40%",
    ]);
  });

  it("M3-overlay-03: placement ignores the image's natural and displayed size", () => {
    const proto = HTMLImageElement.prototype;
    const overrides = {
      naturalWidth: 4000,
      naturalHeight: 3000,
      width: 400,
      clientWidth: 400,
      clientHeight: 300,
    };
    const saved = {};
    for (const [key, value] of Object.entries(overrides)) {
      saved[key] = Object.getOwnPropertyDescriptor(proto, key);
      Object.defineProperty(proto, key, { configurable: true, get: () => value });
    }
    try {
      renderOverlay({
        frameWidth: 1280,
        frameHeight: 960,
        detections: [{ bbox: [320, 240, 960, 720], confidence: 0.8 }],
      });
      const box = screen.getByTestId("bounding-box");
      expect(styleOf(box)).toEqual(["25%", "25%", "50%", "50%"]);

      fireEvent.load(screen.getByRole("img"));
      window.dispatchEvent(new Event("resize"));

      expect(styleOf(screen.getByTestId("bounding-box"))).toEqual(["25%", "25%", "50%", "50%"]);
    } finally {
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(proto, key, descriptor);
        else delete proto[key];
      }
    }
  });

  it("M3-overlay-04: labels each box with its number and confidence", () => {
    renderOverlay();

    const boxes = screen.getAllByTestId("bounding-box");
    expect(boxes[0].textContent).toBe("#1 · 91%");
    expect(boxes[1].textContent).toBe("#2 · 62%");
  });

  it("M3-overlay-05: showBoxes=false or no detections renders the image only", () => {
    const { unmount } = renderOverlay({ showBoxes: false });
    expect(screen.queryAllByTestId("bounding-box")).toHaveLength(0);
    expect(screen.getByRole("img")).toBeInTheDocument();
    unmount();

    renderOverlay({ detections: [] });
    expect(screen.queryAllByTestId("bounding-box")).toHaveLength(0);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("M3-overlay-06: highlights the given box and reports hover", async () => {
    const user = userEvent.setup();
    const onHighlight = vi.fn();
    renderOverlay({ detections: [...D2.detections, THIRD], highlightedIndex: 1, onHighlight });

    const boxes = screen.getAllByTestId("bounding-box");
    expect(boxes.map((b) => b.classList.contains("overlay__box--highlighted"))).toEqual([
      false,
      true,
      false,
    ]);

    await user.hover(boxes[2]);
    expect(onHighlight).toHaveBeenLastCalledWith(2);
    await user.unhover(boxes[2]);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });

  it("M3-overlay-07: many detections all render with finite percent positions", () => {
    const detections = Array.from({ length: 300 }, (_, i) => ({
      bbox: [i, i, i + 40, i + 80],
      confidence: 0.5 + i / 1000,
    }));
    const { rerender } = renderOverlay({ detections });

    const boxes = screen.getAllByTestId("bounding-box");
    expect(boxes).toHaveLength(300);
    for (const box of boxes) {
      for (const value of styleOf(box).map(parseFloat)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
    expect(boxes[299].textContent).toBe("#300 · 80%");

    rerender(
      <BoundingBoxOverlay
        src="blob:mock/1"
        alt="zidane.jpg"
        frameWidth={1280}
        frameHeight={720}
        detections={detections}
        highlightedIndex={150}
      />,
    );
    expect(document.querySelectorAll(".overlay__box--highlighted")).toHaveLength(1);
  });
});
