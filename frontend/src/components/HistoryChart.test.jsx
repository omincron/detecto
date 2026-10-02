import { cloneElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pinTimeZone, R4, refFormat, toRecord } from "../test/helpers.js";

// Recharts draws no SVG in jsdom (ResponsiveContainer never gets a size): give it one.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => <div>{cloneElement(children, { width: 800, height: 240 })}</div>,
  };
});

const records = R4.map(toRecord);

/** One marker per plotted record, whether drawn as line dots or scatter symbols. */
const pointMarkers = (container) =>
  [...container.querySelectorAll(".recharts-line-dots circle, .recharts-scatter-symbol .recharts-symbols")];

/** A marker's centre: cx/cy attributes, else its translate(x, y) transform. */
function centre(el) {
  if (el.hasAttribute("cx")) return [Number(el.getAttribute("cx")), Number(el.getAttribute("cy"))];
  const [, x, y] = el.getAttribute("transform").match(/translate\(([-\d.]+)[ ,]+([-\d.]+)\)/);
  return [Number(x), Number(y)];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HistoryChart at America/New_York", () => {
  const m = pinTimeZone("America/New_York", async () => ({
    HistoryChart: (await import("./HistoryChart.jsx")).default,
  }));
  const F = (r) => refFormat(r.timestamp, "America/New_York");

  it("M4-chart-01: a text summary with count, local first and last times, and peak", () => {
    const { HistoryChart } = m;
    const { rerender } = render(<HistoryChart records={records} />);

    const section = screen.getByRole("region", { name: "People over time" });
    expect(within(section).getByRole("img")).toHaveAttribute(
      "aria-label",
      `People over time: 4 detections from ${F(records[0])} to ${F(records[3])}, peak 5.`,
    );

    rerender(<HistoryChart records={[]} />);
    expect(within(section).getByRole("img")).toHaveAttribute("aria-label", "No detections to chart.");
  });

  it("M4-chart-02: one point per record on a real time axis, with no connecting line [OQ-10]", () => {
    const { HistoryChart } = m;
    const { container } = render(<HistoryChart records={records} />);

    expect(container.querySelectorAll("svg.recharts-surface")).toHaveLength(1);
    const markers = pointMarkers(container);
    expect(markers).toHaveLength(4);
    // OQ-10 (app change agreed, not made yet): dots only, no line between snapshots.
    for (const curve of container.querySelectorAll(".recharts-line-curve")) {
      const stroke = curve.getAttribute("stroke");
      const width = curve.getAttribute("stroke-width");
      expect(stroke === "none" || width === "0", `connecting line drawn (stroke=${stroke}, stroke-width=${width})`).toBe(true);
    }

    const cx = markers.map((el) => centre(el)[0]);
    for (let i = 1; i < cx.length; i++) expect(cx[i]).toBeGreaterThan(cx[i - 1]);
    expect(Math.abs((cx[1] - cx[0]) / (cx[2] - cx[1]) - 1 / 9)).toBeLessThanOrEqual(0.02);
  });

  it("M4-chart-03: higher means more people; a zero-person frame is at the bottom", () => {
    const { HistoryChart } = m;
    const { container } = render(<HistoryChart records={records} />);

    const cy = pointMarkers(container).map((el) => centre(el)[1]);
    expect(cy).toHaveLength(4);
    expect(Math.max(...cy)).toBe(cy[1]);
    expect(Math.min(...cy)).toBe(cy[2]);
    const yTicks = [...container.querySelectorAll(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value")];
    expect(yTicks.length).toBeGreaterThan(0);
    for (const tick of yTicks) expect(tick.textContent).toMatch(/^\d+$/);
  });

  it("M4-chart-04: a single record renders one point without errors", () => {
    const { HistoryChart } = m;
    const consoleError = vi.spyOn(console, "error");
    const { container } = render(<HistoryChart records={[records[0]]} />);

    expect(consoleError).not.toHaveBeenCalled();
    expect(pointMarkers(container)).toHaveLength(1);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("peak 2");
  });

  it("M4-clear-10 (OQ-5, chart): the summary of one record says '1 detection'", () => {
    // OQ-5 (app change agreed, not made yet): singular wording in the chart summary too.
    const { HistoryChart } = m;
    render(<HistoryChart records={[records[0]]} />);

    const label = screen.getByRole("img").getAttribute("aria-label");
    expect(label).toMatch(/^People over time: 1 detection\b/);
    expect(label).not.toContain("1 detections");
  });
});
