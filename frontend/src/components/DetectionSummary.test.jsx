import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DetectionSummary from "./DetectionSummary.jsx";
import { D2_RESULT } from "../test/helpers.js";

const valueOf = (term) => screen.getByText(term).nextElementSibling;

describe("DetectionSummary", () => {
  it("M3-summary-01: shows count, average confidence, both timings and frame size", () => {
    render(<DetectionSummary result={D2_RESULT} roundTripMs={250.4} />);

    expect(screen.getByTestId("person-count")).toHaveTextContent(/^2$/);
    expect(valueOf("Average confidence").tagName).toBe("DD");
    expect(valueOf("Average confidence")).toHaveTextContent(/^77%$/);
    expect(valueOf("Model time")).toHaveTextContent(/^142 ms$/);
    expect(valueOf("Total time")).toHaveTextContent(/^250 ms$/);
    expect(screen.getByText("Processed at 1280 × 720 px")).toBeInTheDocument();
  });

  it("M3-summary-02: lists each person with their confidence", () => {
    render(<DetectionSummary result={D2_RESULT} roundTripMs={250.4} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Person #1")).toBeInTheDocument();
    expect(within(items[0]).getByText("91%")).toBeInTheDocument();
    expect(within(items[1]).getByText("Person #2")).toBeInTheDocument();
    expect(within(items[1]).getByText("62%")).toBeInTheDocument();
  });

  it("M3-summary-03: zero people shows an empty state and no average", () => {
    const empty = { ...D2_RESULT, count: 0, detections: [], averageConfidence: 0 };
    render(<DetectionSummary result={empty} roundTripMs={100} />);

    expect(screen.getByTestId("person-count")).toHaveTextContent(/^0$/);
    expect(valueOf("Average confidence")).toHaveTextContent(/^—$/);
    expect(screen.getByText("No people detected in this image.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("M3-summary-04: total time is shown only when measured", () => {
    render(<DetectionSummary result={D2_RESULT} roundTripMs={null} />);

    expect(screen.queryByText("Total time")).toBeNull();
    expect(valueOf("Model time")).toHaveTextContent(/^142 ms$/);
  });

  it("M3-summary-05: list hover reports the index; the highlighted entry is marked", async () => {
    const user = userEvent.setup();
    const onHighlight = vi.fn();
    render(
      <DetectionSummary
        result={D2_RESULT}
        roundTripMs={250.4}
        highlightedIndex={0}
        onHighlight={onHighlight}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveClass("is-highlighted");
    expect(items[1]).not.toHaveClass("is-highlighted");

    await user.hover(items[1]);
    expect(onHighlight).toHaveBeenLastCalledWith(1);
    await user.unhover(items[1]);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });
});
